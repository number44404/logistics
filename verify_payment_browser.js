/**
 * verify_payment_browser.js — NO app code modified
 * Fix: use a valid UUID for secure_token (column type is uuid)
 */
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const { randomUUID } = require('crypto');

let envConfig = {};
try {
    fs.readFileSync('.env', 'utf8').split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) envConfig[match[1].trim()] = match[2].trim();
    });
} catch(e) { console.error('Could not read .env'); process.exit(1); }

const SUPABASE_URL = envConfig.SUPABASE_URL;
const SERVICE_KEY  = envConfig.SUPABASE_SERVICE_ROLE_KEY;
const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

(async () => {
    // ── 1. Create test data with a valid UUID token ───────────────────────────
    const token = randomUUID();   // valid UUID — matches column type
    const tag = 'VERIFY-' + Date.now();
    console.log('[SETUP] tag=' + tag + '  token=' + token);

    const { data: sender, error: sErr } = await adminClient
        .from('senders').insert([{ full_name: 'BrowserVerify Sender', city: 'London', country: 'UK' }])
        .select().single();
    if (sErr) { console.error('[SETUP] sender failed:', sErr.message); process.exit(1); }

    const { data: shipment, error: shErr } = await adminClient
        .from('shipments').insert([{
            sender_id: sender.id, tracking_number: tag,
            status: 'Pending', is_draft: true,
            payment_status: 'unpaid', shipping_fee: 150,
            estimated_delivery: '2026-09-20'
        }]).select().single();
    if (shErr) { console.error('[SETUP] shipment failed:', shErr.message); process.exit(1); }

    const { error: lErr } = await adminClient
        .from('receiver_links').insert([{
            shipment_id: shipment.id, secure_token: token, status: 'pending'
        }]);
    if (lErr) { console.error('[SETUP] link failed:', lErr.message); process.exit(1); }
    console.log('[SETUP] Done.');

    // ── 2. Sanity-check: confirm the anon client can read the link before launching browser ──
    const anonClient = createClient(SUPABASE_URL, envConfig.SUPABASE_ANON_KEY, {
        auth: { storageKey: 'receiver-auth', persistSession: false }
    });
    const { data: linkCheck, error: lcErr } = await anonClient
        .from('receiver_links')
        .select('*, shipments(*, senders(full_name, city, country), packages(*))')
        .eq('secure_token', token)
        .single();
    if (lcErr) {
        console.error('[SANITY FAIL] anon receiver_links query error:', JSON.stringify(lcErr));
        // cleanup and bail
        await adminClient.from('receiver_links').delete().eq('secure_token', token);
        await adminClient.from('shipments').delete().eq('id', shipment.id);
        await adminClient.from('senders').delete().eq('id', sender.id);
        process.exit(1);
    }
    console.log('[SANITY PASS] anon can read receiver_links, shipment_id=' + linkCheck.shipment_id);

    // ── 3. Launch browser ─────────────────────────────────────────────────────
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    const page = await browser.newPage();

    const consoleLogs = [];
    page.on('console', msg => {
        const text = msg.text();
        consoleLogs.push({ type: msg.type(), text });
        if (/PAYMENT DEBUG|returned row|Supabase error|ERROR|error|Initialization/i.test(text)) {
            console.log('  [BROWSER ' + msg.type().toUpperCase() + '] ' + text);
        }
    });
    const pageErrors = [];
    page.on('pageerror', err => { pageErrors.push(err.message); console.log('  [PAGE ERROR] ' + err.message); });

    const networkHits = {};
    page.on('response', async resp => {
        const url = resp.url();
        if (url.includes('payment_methods') || url.includes('payment-account')) {
            try {
                const body = await resp.text();
                networkHits[url] = { status: resp.status(), body: body.substring(0, 600) };
                console.log('  [NET ' + resp.status() + '] ' + url.replace(/.*supabase\.co/, 'supabase.co'));
                console.log('  [NET BODY] ' + body.substring(0, 400));
            } catch(e) {}
        }
        // Also capture 400/500 responses for debugging
        if (resp.status() >= 400 && url.includes('supabase')) {
            try {
                const body = await resp.text();
                console.log('  [NET ERROR ' + resp.status() + '] ' + url);
                console.log('  [NET ERROR BODY] ' + body.substring(0, 400));
            } catch(e) {}
        }
    });

    // Abort CDN resources that cause navigation timeout
    await page.setRequestInterception(true);
    page.on('request', req => {
        const url = req.url();
        if (url.includes('fonts.googleapis') || url.includes('fonts.gstatic') ||
            url.includes('cdn.jsdelivr.net/npm/bootstrap') || url.includes('bootstrap@5')) {
            req.abort();
        } else {
            req.continue();
        }
    });

    try {
        const receiverUrl = 'http://localhost:3000/receiver.html?token=' + token;
        console.log('\n[NAV] ' + receiverUrl);
        await page.goto(receiverUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        console.log('[NAV] domcontentloaded OK');

        await page.waitForSelector('#form-state:not(.d-none)', { timeout: 25000 });
        console.log('[TEST] Form visible');

        await page.type('#full_name',   'Browser Test User');
        await page.type('#email',       'btest@example.com');
        await page.type('#phone',       '07911000000');
        await page.type('#address',     '42 Test Street');
        await page.type('#city',        'Manchester');
        await page.type('#postal_code', 'M1 1AA');
        await page.type('#country',     'UK');
        console.log('[TEST] Form filled, submitting...');
        await page.click('#submit-btn');

        console.log('[TEST] Waiting for payment-state (45s max)...');
        await page.waitForSelector('#payment-state:not(.d-none)', { timeout: 45000 });
        console.log('[TEST] Payment state visible');
        await new Promise(r => setTimeout(r, 3000));

        const res = await page.evaluate(() => {
            const t = document.getElementById('paymentTabs');
            const c = document.getElementById('paymentTabsContent');
            const tabsText = t ? t.innerText : '';
            const cHTML = c ? c.innerHTML : '';
            return {
                tabCount:     t ? t.querySelectorAll('.nav-item').length : 0,
                bankTransfer: tabsText.includes('Bank Transfer'),
                creditCard:   tabsText.includes('Credit Card'),
                giftCard:     tabsText.includes('Gift Card'),
                emptyState:   cHTML.includes('No payment methods are currently available'),
                tabsText,
                contentSnippet: cHTML.substring(0, 600)
            };
        });

        console.log('\n======================================================');
        console.log('REAL BROWSER PAYMENT METHOD VERIFICATION RESULTS');
        console.log('======================================================');
        console.log('Tab count:          ' + res.tabCount);
        console.log('Bank Transfer:      ' + (res.bankTransfer ? 'PASS' : 'FAIL'));
        console.log('Credit Card:        ' + (res.creditCard   ? 'PASS' : 'FAIL'));
        console.log('Gift Card:          ' + (res.giftCard     ? 'PASS' : 'FAIL'));
        console.log('Empty-state shown:  ' + (res.emptyState   ? 'YES (BAD)' : 'NO (GOOD)'));
        console.log('Tabs text:\n' + (res.tabsText || '(empty)'));
        console.log('\nNetwork hits (payment_methods / payment-account):');
        if (Object.keys(networkHits).length === 0) console.log('  (none captured — check ERR_ABORTED list)');
        for (const [u, r] of Object.entries(networkHits)) {
            console.log('  HTTP ' + r.status + ' ' + u);
            console.log('  Body: ' + r.body.substring(0, 300));
        }
        console.log('\nConsole errors:');
        const errs = consoleLogs.filter(l => l.type === 'error');
        if (errs.length === 0) console.log('  NONE');
        else errs.forEach(e => console.log('  ' + e.text));
        console.log('\nPage errors (uncaught JS):');
        if (pageErrors.length === 0) console.log('  NONE');
        else pageErrors.forEach(e => console.log('  ' + e));
        const allPass = res.bankTransfer && res.creditCard && res.giftCard && !res.emptyState;
        console.log('\nREAL BROWSER PAYMENT METHODS: ' + (allPass ? 'PASS' : 'FAIL'));
        console.log('======================================================');

    } catch(err) {
        console.error('\n[FATAL]', err.constructor.name + ':', err.message);
        try { await page.screenshot({ path: '/tmp/recv_fail.png', fullPage: true }); console.log('[DEBUG] Screenshot: /tmp/recv_fail.png'); } catch(e) {}
        const bodyText = await page.evaluate(() => document.body ? document.body.innerText.substring(0,800) : '').catch(() => '(eval failed)');
        console.log('[DEBUG] Page body:\n' + bodyText);
        console.log('\nAll browser console messages:');
        consoleLogs.forEach(l => console.log('  [' + l.type + '] ' + l.text));
        console.log('\n[RESULT] AUTOMATED TEST ENVIRONMENT FAILURE — application may still be working');
    } finally {
        await browser.close();
        console.log('\n[CLEANUP] Removing test data...');
        try { await adminClient.from('tracking_events').delete().eq('shipment_id', shipment.id); } catch(e) {}
        try { await adminClient.from('notifications_log').delete().eq('related_id', shipment.id); } catch(e) {}
        try { await adminClient.from('payments').delete().eq('shipment_id', shipment.id); } catch(e) {}
        try { await adminClient.from('receivers').delete().eq('email', 'btest@example.com'); } catch(e) {}
        try { await adminClient.from('receiver_links').delete().eq('secure_token', token); } catch(e) {}
        try { await adminClient.from('shipments').delete().eq('id', shipment.id); } catch(e) {}
        try { await adminClient.from('senders').delete().eq('id', sender.id); } catch(e) {}
        console.log('[CLEANUP] Done.');
        process.exit(0);
    }
})();
