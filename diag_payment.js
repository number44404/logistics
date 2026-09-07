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
    // We create a fresh shipment to test the exact flow
    const { data: sender } = await supabase.from('senders').insert([{ full_name: 'Diag Sender' }]).select().single();
    const { data: shipment } = await supabase.from('shipments').insert([{
        sender_id: sender.id, tracking_number: 'DIAG2-' + Date.now(),
        status: 'Pending', is_draft: true, payment_status: 'unpaid', shipping_fee: 150
    }]).select().single();
    
    const token = 'diag-token-' + Date.now();
    await supabase.from('receiver_links').insert([{ shipment_id: shipment.id, secure_token: token, status: 'pending' }]);

    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    
    let caughtLogs = [];
    page.on('console', msg => {
        const text = msg.text();
        if (text.includes('PAYMENT DEBUG') || text.includes('shippingFee') || text.includes('returned') || text.includes('Supabase') || text.includes('query') || text.includes('filter')) {
            caughtLogs.push(text);
        }
    });

    await page.setRequestInterception(true);
    page.on('request', req => {
        if (req.url().includes('fonts.gstatic') || req.url().includes('fonts.googleapis')) req.abort();
        else req.continue();
    });

    await page.goto('http://localhost:3000/receiver.html?token=' + token, { timeout: 60000 });
    await page.waitForSelector('#form-state:not(.d-none)', { timeout: 30000 });
    
    // Fill out form
    await page.type('#full_name', 'Test');
    await page.type('#email', 'test@test.com');
    await page.type('#phone', '1234');
    await page.type('#address', '123');
    await page.type('#city', 'City');
    await page.type('#postal_code', '123');
    await page.type('#country', 'Country');
    await page.click('#submit-btn');

    try {
        await page.waitForSelector('#payment-state:not(.d-none)', { timeout: 10000 });
    } catch(e) {}

    // Wait a bit to ensure all console logs are captured
    await new Promise(r => setTimeout(r, 2000));
    
    console.log("--- BROWSER CONSOLE ---");
    caughtLogs.forEach(l => console.log(l));
    console.log("--- END CONSOLE ---");

    // Check if the empty state is visible
    const contentHtml = await page.evaluate(() => {
        const c = document.getElementById('paymentTabsContent');
        return c ? c.innerHTML : '';
    });
    console.log("UI empty state triggered: " + (contentHtml.includes('No payment methods are currently available') ? 'YES' : 'NO'));

    await browser.close();
    await supabase.from('receiver_links').delete().eq('secure_token', token);
    await supabase.from('shipments').delete().eq('id', shipment.id);
    await supabase.from('senders').delete().eq('id', sender.id);
    process.exit(0);
})();
