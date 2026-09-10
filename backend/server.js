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

// TEST_MODE: provide an in-memory mock supabase client for local end-to-end simulation
const TEST_MODE = process.env.TEST_MODE === '1' || envConfig.TEST_MODE === '1';
if (TEST_MODE) {
    console.log('Starting in TEST_MODE: using in-memory mock Supabase');
    const mockData = {
        bank_account_requests: [],
        bank_accounts: [],
        payment_method_requests: [],
        payment_method_accounts: []
    };

    const makeChain = (table) => {
        const chain = {
            _table: table,
            _selectCols: null,
            _where: {},
            select(cols) { this._selectCols = cols; return this; },
            eq(field, val) { this._where[field] = val; return this; },
            async single() {
                const rows = mockData[this._table] || [];
                const found = rows.find(r => {
                    for (const k in this._where) {
                        if (String(r[k]) !== String(this._where[k])) return false;
                    }
                    return true;
                });
                if (!found) return { data: null, error: { message: 'Not found' } };
                return { data: found, error: null };
            },
            async update(payload) {
                const rows = mockData[this._table] || [];
                let updated = null;
                for (let i = 0; i < rows.length; i++) {
                    let match = true;
                    for (const k in this._where) if (String(rows[i][k]) !== String(this._where[k])) { match = false; break; }
                    if (match) { rows[i] = Object.assign({}, rows[i], payload); updated = rows[i]; }
                }
                return { data: updated ? [updated] : [], error: null };
            },
            async insert(payload) {
                const rows = mockData[this._table] || [];
                const raw = Array.isArray(payload) ? payload[0] : payload;
                const item = Object.assign({}, raw);
                if (!item.id) item.id = `${this._table.slice(0,3)}_${Date.now()}`;
                rows.push(item);
                mockData[this._table] = rows;
                return { data: [item], error: null };
            }
        };
        return chain;
    };

    supabase = {
        from(table) { return makeChain(table); },
        _mockData: mockData
    };

    // Test-only helper endpoints to create and assign requests
    app.post('/_test/create_payment_method_request', (req, res) => {
        const { id, shipment_id, method_type } = req.body || {};
        if (!id || !shipment_id || !method_type) return res.status(400).json({ error: 'Missing fields' });
        const record = { id, shipment_id, method_type, status: 'pending', created_at: new Date().toISOString() };
        supabase._mockData.payment_method_requests.push(record);
        res.json({ ok: true, record });
    });

    app.post('/_test/assign_payment_method', (req, res) => {
        const { request_id, label, account_value, instructions } = req.body || {};
        if (!request_id || !label || !account_value) return res.status(400).json({ error: 'Missing fields' });
        const accountId = `pma_${Date.now()}`;
        const account = { id: accountId, method_type: 'paypal_or_cash', label, account_value, instructions };
        supabase._mockData.payment_method_accounts.push(account);

        // attach to request
        const reqs = supabase._mockData.payment_method_requests;
        const p = reqs.find(r => String(r.id) === String(request_id));
        if (!p) return res.status(404).json({ error: 'Request not found' });
        p.assigned_payment_method_account_id = accountId;
        p.status = 'assigned';

        res.json({ ok: true, account, request: p });
    });

    app.get('/_test/debug', (req, res) => res.json(supabase._mockData));
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

app.get('/api/payment-method-assignment', async (req, res) => {
    const { request_id, shipment_id, method_type } = req.query;
    if (!request_id || !shipment_id || !method_type) {
        return res.status(400).json({ error: 'Missing request_id, shipment_id or method_type' });
    }

    if (!supabase) {
        return res.status(500).json({ error: 'Supabase client not initialized' });
    }

    try {
        const { data: request, error: reqError } = await supabase
            .from('payment_method_requests')
            .select('*')
            .eq('id', request_id)
            .eq('shipment_id', shipment_id)
            .eq('method_type', method_type)
            .single();

        if (reqError || !request) {
            return res.status(404).json({ error: 'Payment method request not found' });
        }

        if (request.status !== 'assigned' && request.status !== 'sent') {
            return res.status(403).json({ error: 'Payment method details not yet assigned' });
        }

        if (!request.assigned_value) {
            return res.status(404).json({ error: 'Assigned payment method value missing' });
        }

        res.json({ assigned_value: request.assigned_value, method_type: request.method_type });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// New endpoint: return structured payment method account details when request assigned
app.get('/api/payment-method-account', async (req, res) => {
    const { request_id, shipment_id, method_type } = req.query;
    if (!request_id || !shipment_id || !method_type) {
        return res.status(400).json({ error: 'Missing request_id, shipment_id or method_type' });
    }

    if (!supabase) return res.status(500).json({ error: 'Supabase client not initialized' });

    try {
        const { data: request, error: reqError } = await supabase
            .from('payment_method_requests')
            .select('assigned_payment_method_account_id, status')
            .eq('id', request_id)
            .eq('shipment_id', shipment_id)
            .eq('method_type', method_type)
            .single();

        if (reqError || !request) return res.status(404).json({ error: 'Payment method request not found' });

        if (request.status !== 'assigned' && request.status !== 'sent') {
            return res.status(403).json({ error: 'Payment method details not yet assigned' });
        }

        if (!request.assigned_payment_method_account_id) {
            return res.status(404).json({ error: 'Assigned payment method account missing' });
        }

        const { data: account, error: accError } = await supabase
            .from('payment_method_accounts')
            .select('method_type, label, account_value, instructions')
            .eq('id', request.assigned_payment_method_account_id)
            .single();

        if (accError || !account) return res.status(404).json({ error: 'Assigned account unavailable' });

        res.json(account);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Server-side creation endpoint to avoid RLS/anon limitations for receivers
// Expects: { shipment_id, receiver_id, method_type }
app.post('/api/create-payment-method-request', async (req, res) => {
    const { shipment_id, receiver_id, method_type } = req.body || {};
    if (!shipment_id || !receiver_id || !method_type) {
        return res.status(400).json({ error: 'Missing shipment_id, receiver_id or method_type' });
    }

    if (!supabase) return res.status(500).json({ error: 'Supabase client not initialized' });

    try {
        const payload = {
            shipment_id,
            receiver_id,
            method_type,
            status: 'pending',
            created_at: new Date().toISOString()
        };

        // Call insert() and normalize results for both real client and TEST_MODE mock
        const insertRes = await supabase.from('payment_method_requests').insert([payload]);
        let data = null;
        if (insertRes.error) {
            console.error('Create payment method request error:', insertRes.error);
            return res.status(500).json({ error: 'Failed to create request', detail: insertRes.error });
        }
        if (Array.isArray(insertRes.data)) data = insertRes.data[0];
        else data = insertRes.data;
        // Optionally log notification
        try {
            await supabase.from('notifications_log').insert([{
                title: `${method_type === 'paypal' ? 'PayPal' : 'Cash App'} Details Requested`,
                body: `Receiver requested ${method_type} account details for shipment ${shipment_id}.`,
                event_type: 'payment_method_requested',
                related_id: shipment_id,
                created_at: new Date().toISOString()
            }]);
        } catch (e) {
            // non-fatal
            console.warn('Notification insert failed (non-fatal):', e);
        }

        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Return payment method requests for a shipment and method_type
app.get('/api/payment-method-requests', async (req, res) => {
    const { shipment_id, method_type, request_id } = req.query;
    if (!shipment_id && !request_id) return res.status(400).json({ error: 'Missing shipment_id or request_id' });
    if (!supabase) return res.status(500).json({ error: 'Supabase client not initialized' });

    try {
        let query = supabase.from('payment_method_requests').select('*');
        if (request_id) query = query.eq('id', request_id);
        else query = query.eq('shipment_id', shipment_id).eq('method_type', method_type).in('status', ['pending', 'assigned', 'sent']).limit(1);

        const result = await query;
        if (result.error) return res.status(500).json({ error: 'Failed to query requests', detail: result.error });
        res.json(result.data);
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
