const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
let envConfig = {};
fs.readFileSync('.env', 'utf8').split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) envConfig[match[1].trim()] = match[2].trim();
});
const supabase = createClient(envConfig.SUPABASE_URL, envConfig.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
    const { data: sender } = await supabase.from('senders').insert([{ full_name: 'Debug5 Sender' }]).select().single();
    const { data: shipment } = await supabase.from('shipments').insert([{
        sender_id: sender.id, tracking_number: 'D5-' + Date.now(),
        status: 'Pending', is_draft: true, payment_status: 'unpaid', shipping_fee: 222
    }]).select().single();
    const token = '123e4567-e89b-12d3-a456-' + String(Date.now()).slice(-12);
    await supabase.from('receiver_links').insert([{ shipment_id: shipment.id, secure_token: token, status: 'pending' }]);
    fs.writeFileSync('dummy_receipt.pdf', 'dummy content');

    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();

    // Capture ALL console + errors after submit
    const logs = [];
    page.on('console', msg => logs.push('[' + msg.type() + '] ' + msg.text()));
    page.on('pageerror', err => logs.push('[PAGEERR] ' + err.message));
    page.on('response', async r => {
        const url = r.url();
        if (url.includes('supabase') || url.includes('localhost')) {
            let body = '';
            try { body = (await r.text()).substring(0, 200); } catch(e) {}
            logs.push('[HTTP ' + r.status() + '] ' + url.substring(0, 80) + (body ? ' | ' + body : ''));
        }
    });

    await page.setRequestInterception(true);
    page.on('request', req => {
        if (req.url().includes('fonts.gstatic') || req.url().includes('fonts.googleapis')) req.abort();
        else req.continue();
    });

    await page.goto('http://localhost:3000/receiver.html?token=' + token, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#form-state:not(.d-none)', { timeout: 30000 });

    await page.type('#full_name', 'Debug5 Receiver');
    await page.type('#email', 'debug5@test.com');
    await page.type('#phone', '1234567890');
    await page.type('#address', '123 Test St');
    await page.type('#city', 'Test City');
    await page.type('#postal_code', '12345');
    await page.type('#country', 'Test Country');
    await page.click('#submit-btn');
    await page.waitForSelector('#payment-state:not(.d-none)', { timeout: 60000 });
    await page.waitForSelector('#payment-form-bank', { timeout: 30000 });

    // Clear logs to focus on what happens after submit
    logs.length = 0;
    logs.push('--- SUBMIT START ---');

    const fileInput = await page.$('#payment_receipt');
    await fileInput.uploadFile('dummy_receipt.pdf');
    await page.click('#payment-form-bank button[type="submit"]');

    // Wait 20s for something to happen
    await new Promise(r => setTimeout(r, 20000));

    // Check final state
    const successVisible = await page.evaluate(() => !document.getElementById('success-state').classList.contains('d-none'));
    const errorVisible = await page.evaluate(() => !document.getElementById('payment-error').classList.contains('d-none'));
    const errorText = await page.evaluate(() => document.getElementById('payment-error').textContent);

    console.log('Success state visible:', successVisible);
    console.log('Error state visible:', errorVisible);
    console.log('Error text:', errorText);
    console.log('\n--- ALL LOGS AFTER SUBMIT ---');
    logs.forEach(l => console.log(l));

    await browser.close();
    fs.unlinkSync('dummy_receipt.pdf');
    await supabase.from('receiver_links').delete().eq('secure_token', token);
    await supabase.from('shipments').delete().eq('id', shipment.id);
    await supabase.from('senders').delete().eq('id', sender.id);
    process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
