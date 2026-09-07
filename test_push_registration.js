const puppeteer = require('puppeteer');

(async () => {
    console.log("Starting Push Registration Test...");
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-features=PushMessaging']
    });
    
    const context = browser.defaultBrowserContext();
    // Grant notifications permission
    await context.overridePermissions('http://localhost:3000', ['notifications']);
    
    const page = await browser.newPage();
    
    console.log("1. Login...");
    await page.goto('http://localhost:3000/mobile.html');
    
    // Wait for login form
    await page.waitForSelector('#email');
    await page.type('#email', 'david@example.com'); // I need a valid staff login
    await page.type('#password', 'password'); // Dummy password?
    // Wait, I don't know a valid staff email/password! 
    
    await browser.close();
})();
