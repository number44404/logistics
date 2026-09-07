const webpush = require('web-push');

// Use the generated keys from earlier
const vapidPublicKey = 'BAIUqe8JsGAaxq2rpgOWaKH50Xvbzli0et9qUtEBauuOsK876DGxNHvAgzXD68cHMRrZd7LfmAs6wThDbkkh924';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

webpush.setVapidDetails(
    'mailto:admin@ups-test.com',
    vapidPublicKey,
    vapidPrivateKey
);

const testPayload = JSON.stringify({
    title: 'Development Test',
    body: 'This is a controlled push notification test.',
    event_type: 'test_event'
});

async function runTest() {
    console.log('Sending test push notification...');
    
    // Hardcoded subscription object for testing since we cannot easily retrieve a real one from DB without a browser interaction
    // The user will need to provide their own subscription object from the DB to fully execute it against their device.
    const dummySubscription = {
        endpoint: "https://fcm.googleapis.com/fcm/send/dummy",
        keys: {
            p256dh: "dummy_key",
            auth: "dummy_auth"
        }
    };

    try {
        await webpush.sendNotification(dummySubscription, testPayload);
        console.log('Push sent successfully (Note: Dummy subscription will fail in reality without a real token).');
    } catch (err) {
        console.error('Push Service Response:', err.statusCode, err.body || err.message);
    }
}

runTest();
