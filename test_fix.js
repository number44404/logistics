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
    // We create a fresh shipment
    const { data: sender } = await supabase.from('senders').insert([{ full_name: 'Diag Sender' }]).select().single();
    const { data: shipment } = await supabase.from('shipments').insert([{
        sender_id: sender.id, tracking_number: 'FIX-' + Date.now(),
        status: 'Pending', is_draft: true, payment_status: 'unpaid', shipping_fee: 100
    }]).select().single();
    const token = 'fix-token-' + Date.now();
    await supabase.from('receiver_links').insert([{ shipment_id: shipment.id, secure_token: token, status: 'pending' }]);

    // Function to run a test
    async function runTest(withAuth) {
        const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
        const page = await browser.newPage();
        
        await page.goto('http://localhost:3000/receiver.html?token=' + token);
        
        if (withAuth) {
            // Inject a dummy authenticated session into localStorage
            await page.evaluate((url, key) => {
                const sessionStr = JSON.stringify({
                    access_token: 'fake-access-token',
                    token_type: 'bearer',
                    expires_in: 3600,
                    expires_at: Math.floor(Date.now() / 1000) + 3600,
                    refresh_token: 'fake-refresh-token',
                    user: { id: 'admin-123', role: 'authenticated' }
                });
                const storageKey = 'sb-' + url.split('.')[0].replace('https://', '') + '-auth-token';
                localStorage.setItem(storageKey, sessionStr);
            }, envConfig.SUPABASE_URL, envConfig.SUPABASE_ANON_KEY);
            // Reload page so it picks up the token (if it wasn't isolated)
            await page.reload();
        }

        await page.waitForSelector('#form-state:not(.d-none)', { timeout: 30000 });
        
        await page.type('#full_name', 'Fix Receiver');
        await page.type('#email', 'fix@test.com');
        await page.type('#phone', '1234');
        await page.type('#address', '123');
        await page.type('#city', 'City');
        await page.type('#postal_code', '123');
        await page.type('#country', 'Country');
        await page.click('#submit-btn');

        await page.waitForSelector('#payment-state:not(.d-none)', { timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000)); // allow rendering

        const result = await page.evaluate(() => {
            const tabs = document.getElementById('paymentTabs').innerText;
            const content = document.getElementById('paymentTabsContent').innerHTML;
            return {
                bank: tabs.includes('Bank Transfer'),
                card: tabs.includes('Credit Card'),
                gift: tabs.includes('Gift Card'),
                empty: content.includes('No payment methods are currently available')
            };
        });

        await browser.close();
        return result;
    }

    try {
        console.log("Testing Anonymous Session...");
        const resAnon = await runTest(false);
        console.log("Anon Result:", resAnon);

        console.log("Testing Authenticated Session...");
        const resAuth = await runTest(true);
        console.log("Auth Result:", resAuth);
        
        console.log("ALL TESTS FINISHED");
    } catch(e) {
        console.log("ERROR:", e);
    }

    // Cleanup
    await supabase.from('receiver_links').delete().eq('secure_token', token);
    await supabase.from('shipments').delete().eq('id', shipment.id);
    await supabase.from('senders').delete().eq('id', sender.id);
    process.exit(0);
})();
