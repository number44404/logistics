const fs = require('fs');

let code = fs.readFileSync('backend/push_listener.js', 'utf8');

const newBranch = `} else if (log.event_type === 'bank_account_requested') {
                    targetRoles = ['Admin', 'Customer Care Agent'];
                    pushPayload = {
                        title: log.title || 'Bank Account Requested',
                        body: log.body || 'Receiver requested bank account details.',
                        event_type: log.event_type,
                        related_id: log.related_id,
                        notification_id: log.id,
                        channel_id: 'payment_review'
                    };
                } else if (log.event_type === 'payment_submitted') {`;

code = code.replace(`} else if (log.event_type === 'payment_submitted') {`, newBranch);

fs.writeFileSync('backend/push_listener.js', code);
console.log('push_listener.js patched.');
