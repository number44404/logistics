const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const { randomUUID } = require('crypto');

let env = {};
fs.readFileSync('.env','utf8').split('\n').forEach(l => { const m = l.match(/^([^=]+)=(.*)$/); if(m) env[m[1].trim()]=m[2].trim(); });
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
    const token = randomUUID();
    const tag = 'CARDRMV-' + Date.now();

    const { data: sender, error: sErr } = await admin.from('senders')
        .insert([{ full_name: 'CardRemoval Sender', city: 'London', country: 'UK' }]).select().single();
    if (sErr) { console.error('sender:', sErr.message); process.exit(1); }

    const { data: ship, error: shErr } = await admin.from('shipments')
        .insert([{ sender_id: sender.id, tracking_number: tag, status: 'Pending',
                   is_draft: true, payment_status: 'unpaid', shipping_fee: 99,
                   estimated_delivery: '2026-09-30' }]).select().single();
    if (shErr) { console.error('shipment:', shErr.message); process.exit(1); }

    await admin.from('receiver_links').insert([{ shipment_id: ship.id, secure_token: token, status: 'pending' }]);
    console.log('[SETUP] token=' + token);

    // Pre-flight anon check
    const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { storageKey: 'receiver-auth', persistSession: false } });
    const { data: methods } = await anon.from('payment_methods').select('*').eq('is_active', true).order('created_at', { ascending: true });
    console.log('[PREFLIGHT] Active methods: ' + (methods ? methods.map(m => m.type).join(', ') : 'NONE'));
    console.log('[PREFLIGHT] Count: ' + (methods ? methods.length : 0));

    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
    const page = await browser.newPage();

    const logs = [], netHits = {};
    page.on('console', msg => {
        logs.push({ type: msg.type(), text: msg.text() });
        if (/PAYMENT DEBUG|returned row|Supabase error|ERROR/i.test(msg.text()))
            console.log('  [' + msg.type().toUpperCase() + '] ' + msg.text());
    });
    const pageErrors = [];
    page.on('pageerror', err => { pageErrors.push(err.message); });
    page.on('response', async resp => {
        const url = resp.url();
        if (url.includes('payment_methods')) {
            try { const b = await resp.text(); netHits.pm = { status: resp.status(), body: b.substring(0,500) }; } catch(e) {}
        }
        if (url.includes('payment-account')) {
            try { const b = await resp.text(); netHits.pa = { status: resp.status(), body: b.substring(0,200) }; } catch(e) {}
        }
    });
    await page.setRequestInterception(true);
    page.on('request', req => {
        const u = req.url();
        if (u.includes('fonts.googleapis') || u.includes('fonts.gstatic') ||
            u.includes('cdn.jsdelivr.net/npm/bootstrap') || u.includes('bootstrap@5')) {
            req.abort();
        } else { req.continue(); }
    });

    try {
        await page.goto('http://localhost:3000/receiver.html?token=' + token, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('#form-state:not(.d-none)', { timeout: 25000 });
        console.log('[TEST] Form visible');

        await page.type('#full_name',   'Card Removal Test');
        await page.type('#email',       'cardtest@example.com');
        await page.type('#phone',       '07900000000');
        await page.type('#address',     '1 Test Road');
        await page.type('#city',        'London');
        await page.type('#postal_code', 'EC1A 1BB');
        await page.type('#country',     'UK');
        await page.click('#submit-btn');

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
                bankVisible:  tabsText.includes('Bank Transfer'),
                giftVisible:  tabsText.includes('Gift Card'),
                cardVisible:  tabsText.includes('Credit Card'),
                emptyState:   cHTML.includes('No payment methods are currently available'),
                tabsText
            };
        });

        console.log('\n======================================================');
        console.log('CREDIT CARD REMOVAL — REAL BROWSER RESULTS');
        console.log('======================================================');
        console.log('Active methods returned:    ' + (methods ? methods.length : 0));
        console.log('Tab count rendered:         ' + res.tabCount);
        console.log('Bank Transfer visible:      ' + (res.bankVisible ? 'PASS' : 'FAIL'));
        console.log('Gift Card visible:          ' + (res.giftVisible ? 'PASS' : 'FAIL'));
        console.log('Credit Card visible:        ' + (res.cardVisible ? 'FAIL (still showing!)' : 'PASS — NOT visible'));
        console.log('Empty-state shown:          ' + (res.emptyState  ? 'YES (BAD)' : 'NO (GOOD)'));
        console.log('\nTabs text:\n' + (res.tabsText || '(empty)'));
        console.log('\nNetwork — payment_methods:  HTTP ' + (netHits.pm ? netHits.pm.status + ' — ' + netHits.pm.body.substring(0,200) : 'NOT CAPTURED'));
        console.log('Network — payment-account:  HTTP ' + (netHits.pa ? netHits.pa.status + ' — ' + netHits.pa.body : 'NOT CAPTURED'));
        const consoleErrors = logs.filter(l => l.type === 'error' && !l.text.includes('ERR_ABORTED') && !l.text.includes('ERR_FAILED'));
        console.log('\nConsole errors (non-CDN):  ' + (consoleErrors.length === 0 ? 'NONE' : consoleErrors.map(e => e.text).join('; ')));
        console.log('Page errors (uncaught JS): ' + (pageErrors.length === 0 ? 'NONE' : pageErrors.join('; ')));
        const pass = res.bankVisible && res.giftVisible && !res.cardVisible && !res.emptyState && res.tabCount === 2;
        console.log('\nOVERALL: ' + (pass ? 'PASS' : 'FAIL'));
        console.log('======================================================');

    } catch(err) {
        console.error('[FATAL]', err.constructor.name + ':', err.message);
        try { await page.screenshot({ path: '/tmp/cardrmv_fail.png', fullPage: true }); } catch(e) {}
        console.log('All logs:'); logs.forEach(l => console.log('  ['+l.type+'] '+l.text));
    } finally {
        await browser.close();
        try { await admin.from('tracking_events').delete().eq('shipment_id', ship.id); } catch(e) {}
        try { await admin.from('notifications_log').delete().eq('related_id', ship.id); } catch(e) {}
        try { await admin.from('payments').delete().eq('shipment_id', ship.id); } catch(e) {}
        try { await admin.from('receivers').delete().eq('email', 'cardtest@example.com'); } catch(e) {}
        try { await admin.from('receiver_links').delete().eq('secure_token', token); } catch(e) {}
        try { await admin.from('shipments').delete().eq('id', ship.id); } catch(e) {}
        try { await admin.from('senders').delete().eq('id', sender.id); } catch(e) {}
        console.log('[CLEANUP] Done.');
        process.exit(0);
    }
})();
