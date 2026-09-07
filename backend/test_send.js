const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

let envConfig = {};
try {
    const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    envFile.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) envConfig[match[1].trim()] = match[2].trim().replace(/^'|'$/g, '');
    });
} catch (e) { }

const sa = JSON.parse(envConfig.FIREBASE_SERVICE_ACCOUNT);
initializeApp({ credential: cert(sa) });

console.log("Auth success. Project:", sa.project_id);

const fcmPayload = {
    notification: { title: "Test", body: "Test body" },
    android: { notification: { channelId: 'critical_ops' } },
    token: "fmBzNoHPR-u9Dc0a-WhAbc:APA91bGHDdHGRJ2bFjhxl2-A0O5xTRZfsnTUxWVmaLUJN6pfl6ceCrfjGkiJiayOV_QRNZT0nMDd9zXqY0vlpM_x11qfHWbcM2fQUyR16Wx_PNeYL7SPBRo"
};

getMessaging().send(fcmPayload)
    .then(r => console.log("FCM send success:", r))
    .catch(e => console.error("FCM send error:", e.message));
