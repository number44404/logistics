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
    // 1. Create a test shipment with shipping_fee = 222
    const { data: sender } = await supabase.from('senders').insert([{ full_name: 'Diag Sender' }]).select().single();
    const { data: shipment } = await supabase.from('shipments').insert([{
        sender_id: sender.id, tracking_number: 'DIAG-' + Date.now(),
        status: 'Pending', is_draft: true, payment_status: 'unpaid', shipping_fee: 222
    }]).select().single();
    const token = '123e4567-e89b-12d3-a456-' + String(Date.now()).slice(-12);
    await supabase.from('receiver_links').insert([{ shipment_id: shipment.id, secure_token: token, status: 'pending' }]);

    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();

    let paymentMethodsData = null;

    page.on('response', async r => {
        if (r.url().includes('payment_methods')) {
            try {
                paymentMethodsData = await r.json();
            } catch(e) {}
        }
    });

    await page.setRequestInterception(true);
    page.on('request', req => {
        if (req.url().includes('fonts.gstatic') || req.url().includes('fonts.googleapis')) req.abort();
        else req.continue();
    });

    await page.goto('http://localhost:3000/receiver.html?token=' + token, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#form-state:not(.d-none)', { timeout: 30000 });

    await page.type('#full_name', 'Diag Receiver');
    await page.type('#email', 'diag@test.com');
    await page.type('#phone', '1234567890');
    await page.type('#address', '123 Test St');
    await page.type('#city', 'Test City');
    await page.type('#postal_code', '12345');
    await page.type('#country', 'Test Country');
    await page.click('#submit-btn');

    await page.waitForSelector('#payment-state:not(.d-none)', { timeout: 60000 });

    const html = await page.evaluate(() => document.getElementById('paymentTabsContent').innerHTML);
    console.log('--- UI RENDERED CONTENT ---');
    console.log(html.substring(0, 300) + (html.length > 300 ? '...' : ''));
    console.log('--- NETWORK RESPONSE FOR PAYMENT METHODS ---');
    console.log(JSON.stringify(paymentMethodsData));

    await browser.close();
    await supabase.from('receiver_links').delete().eq('secure_token', token);
    await supabase.from('shipments').delete().eq('id', shipment.id);
    await supabase.from('senders').delete().eq('id', sender.id);
    process.exit(0);
})();
