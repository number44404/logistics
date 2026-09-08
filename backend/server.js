const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Manually parse .env file (since we can't run npm install dotenv)
let envConfig = {};
try {
    const envPath = path.join(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
        const envFile = fs.readFileSync(envPath, 'utf8');
        envFile.split('\n').forEach(line => {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) envConfig[match[1].trim()] = match[2].trim();
        });
    }
} catch (e) {
    console.log('Could not read .env file');
}



// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.json());

// Block common WordPress/scanner paths so they do not hit the app shell.
const blockedPrefixes = ['/wp-admin', '/wp-login', '/xmlrpc.php', '/wp-json', '/wp-includes', '/wordpress'];
app.use((req, res, next) => {
    const pathName = req.path || '';
    if (blockedPrefixes.some(prefix => pathName === prefix || pathName.startsWith(prefix + '/'))) {
        return res.status(404).json({ error: 'Not found' });
    }
    next();
});

// Load push logic
const { dispatchPushForLog } = require('./push_listener');

// Webhook endpoint for Serverless deployments (like Vercel)
app.post('/api/webhook/push', async (req, res) => {
    try {
        const payload = req.body;
        // Supabase Database Webhooks send the new row in `record`
        const log = payload.record || payload; 
        
        if (log && log.event_type) {
            await dispatchPushForLog(log);
            res.status(200).send('Push dispatched');
        } else {
            res.status(400).send('Invalid payload');
        }
    } catch (e) {
        console.error('Webhook error:', e);
        res.status(500).send('Error processing webhook');
    }
});

// API Routes can go here
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL || envConfig.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || envConfig.SUPABASE_SERVICE_ROLE_KEY;

let supabase;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
} else {
    console.warn('Missing Supabase credentials for backend API.');
}

app.get('/api/payment-account', async (req, res) => {
    const { request_id, shipment_id } = req.query;
    if (!request_id || !shipment_id) {
        return res.status(400).json({ error: 'Missing request_id or shipment_id' });
    }

    if (!supabase) {
        return res.status(500).json({ error: 'Supabase client not initialized' });
    }
    try {
        // 1. & 2. Verify request exists and belongs to the requested shipment
        const { data: request, error: reqError } = await supabase
            .from('bank_account_requests')
            .select('*')
            .eq('id', request_id)
            .eq('shipment_id', shipment_id)
            .single();

        if (reqError || !request) {
            return res.status(404).json({ error: 'Bank account request not found' });
        }

        // 3. Verify request is assigned/sent
        if (request.status !== 'assigned' && request.status !== 'sent') {
            return res.status(403).json({ error: 'Bank account not yet assigned' });
        }

        if (!request.assigned_bank_account_id) {
            return res.status(404).json({ error: 'Assigned bank account ID missing' });
        }

        // 4. Verify assigned bank account exists
        const { data: account, error: accError } = await supabase
            .from('bank_accounts')
            .select('bank_name, account_name, account_number')
            .eq('id', request.assigned_bank_account_id)
            .single();

        if (accError || !account) {
            return res.status(404).json({ error: 'Assigned account unavailable' });
        }

        // 5. Return only the necessary payment information
        res.json(account);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/status', (req, res) => {
    res.json({ status: 'Backend is running!' });
});

// Serve the main index.html for the root route (or 404 fallback)
app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}

module.exports = app;
