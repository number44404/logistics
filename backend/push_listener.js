const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let envConfig = {};
try {
    const envFile = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
    envFile.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) envConfig[match[1].trim()] = match[2].trim();
    });
} catch (e) { }

// Initialize Firebase Admin securely via stringified JSON in .env (or GOOGLE_APPLICATION_CREDENTIALS fallback)
try {
    const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT || envConfig.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountStr) {
        admin.initializeApp({
            credential: admin.cert(JSON.parse(serviceAccountStr))
        });
    } else {
        admin.initializeApp();
    }
    // Verify messaging can be obtained
    const { getMessaging } = require('firebase-admin/messaging');
    getMessaging();
    console.log("Firebase Admin initialization: PASS");
    console.log("Firebase Messaging initialization: PASS");
} catch (e) {
    console.error(`Firebase Admin initialization: FAIL — ${e.message}`);
}
const vapidPublicKey = 'BAIUqe8JsGAaxq2rpgOWaKH50Xvbzli0et9qUtEBauuOsK876DGxNHvAgzXD68cHMRrZd7LfmAs6wThDbkkh924';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || envConfig.VAPID_PRIVATE_KEY;
webpush.setVapidDetails('mailto:admin@ups-test.com', vapidPublicKey, vapidPrivateKey);



const SUPABASE_URL = process.env.SUPABASE_URL || envConfig.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || envConfig.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error("CRITICAL ERROR: SUPABASE_SERVICE_ROLE_KEY is missing from environment.");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function startListener() {
    

    console.log("Subscribing to notifications_log...");
    supabase
        .channel('backend-push-dispatcher')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'notifications_log' },
            async (payload) => {
                const log = payload.new;
                
                let targetRoles = [];
                let pushPayload = {};

                if (log.event_type === 'support_ticket_created') {
                    targetRoles = ['Admin', 'Customer Care Agent'];
                    pushPayload = {
                        title: 'Customer Support Request',
                        body: 'New support request requires attention.',
                        event_type: log.event_type,
                        related_id: log.related_id,
                        notification_id: log.id,
                        channel_id: 'customer_support'
                    };
                } else if (log.event_type === 'bank_account_requested') {
                    targetRoles = ['Admin', 'Customer Care Agent'];
                    pushPayload = {
                        title: log.title || 'Bank Account Requested',
                        body: log.body || 'Receiver requested bank account details.',
                        event_type: log.event_type,
                        related_id: log.related_id,
                        notification_id: log.id,
                        channel_id: 'payment_review'
                    };
                } else if (log.event_type === 'payment_submitted') {
                    targetRoles = ['Admin'];
                    pushPayload = {
                        title: 'Payment Requires Review',
                        body: 'A shipment payment requires staff verification.',
                        event_type: log.event_type,
                        related_id: log.related_id,
                        notification_id: log.id,
                        channel_id: 'payment_review'
                    };
                } else if (log.event_type === 'address_completed') {
                    targetRoles = ['Admin', 'Operations Staff'];
                    pushPayload = {
                        title: 'Shipment Update',
                        body: 'Receiver information has been completed.',
                        event_type: log.event_type,
                        related_id: log.related_id,
                        notification_id: log.id,
                        channel_id: 'general_ops'
                    };
                } else {
                    return; // Ignore other events
                }
                
                console.log(`Event detected: ${log.event_type}. Fetching authorized devices...`);
                
                // Get all authorized staff for this event
                const { data: staffList } = await supabase
                    .from('staff_users')
                    .select('id, role')
                    .in('role', targetRoles);
                    
                if (!staffList || staffList.length === 0) return;
                const staffIds = staffList.map(s => s.id);
                
                // Get devices for these staff members
                const { data: devices } = await supabase
                    .from('admin_devices')
                    .select('device_token, platform')
                    .in('admin_id', staffIds)
                    .eq('is_active', true);
                    
                if (!devices || devices.length === 0) {
                    console.log("No registered active devices found for target staff.");
                    return;
                }
                
                console.log(`Dispatching push to ${devices.length} devices...`);
                
                for (const row of devices) {
                    try {
                        if (row.platform === 'android') {
                            const { getMessaging } = require('firebase-admin/messaging');
                            const fcmPayload = {
                                notification: {
                                    title: pushPayload.title,
                                    body: pushPayload.body
                                },
                                android: {
                                    notification: {
                                        channelId: pushPayload.channel_id || 'general_ops'
                                    }
                                },
                                data: {
                                    event_type: pushPayload.event_type,
                                    related_id: pushPayload.related_id || '',
                                    notification_id: pushPayload.notification_id || ''
                                },
                                token: row.device_token
                            };
                            await getMessaging().send(fcmPayload);
                        } else {
                            // Legacy/PWA Web Push
                            const sub = JSON.parse(row.device_token);
                            await webpush.sendNotification(sub, JSON.stringify(pushPayload));
                        }
                    } catch (e) {
                        console.error("Failed to push to device:", e.statusCode || e.code || e.message);
                        
                        // Handle dead Web Push tokens
                        if (e.statusCode === 410 || e.statusCode === 404) {
                            await supabase.from('admin_devices').update({ is_active: false }).eq('device_token', row.device_token);
                        }
                        
                        // Handle dead Android FCM tokens
                        if (e.code === 'messaging/registration-token-not-registered' || e.code === 'messaging/invalid-registration-token') {
                            await supabase.from('admin_devices').update({ is_active: false }).eq('device_token', row.device_token);
                        }
                    }
                }
            }
        )
        .subscribe();
}

startListener();
