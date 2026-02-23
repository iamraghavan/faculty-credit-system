const { sendFcmNotification } = require('./utils/firebase');
require('dotenv').config();

async function runTest() {
    console.log('--- Firebase FCM Test ---');
    
    // 1. Check if configured
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
        console.error('❌ Error: FIREBASE_SERVICE_ACCOUNT is missing in .env');
        return;
    }

    const testToken = process.argv[2];
    if (!testToken) {
        console.log('📝 Usage: node test_fcm_final.js <YOUR_DEVICE_TOKEN>');
        console.log('💡 Note: You can get a token from your frontend browser once integrated.');
        return;
    }

    console.log(`🚀 Sending test notification to: ${testToken.substring(0, 10)}...`);

    const payload = {
        title: 'FCS Test Notification',
        body: 'Great news! Your Firebase integration is working 🚀',
        url: 'https://fcs.egspgroup.in/u/credits',
        icon: 'https://fcs.egspgroup.in/favicon.ico'
    };

    try {
        const result = await sendFcmNotification(testToken, payload);
        if (result === 'INVALID_TOKEN') {
            console.error('❌ Failed: The token you provided is invalid or expired.');
        } else if (result) {
            console.log('✅ Success! Message ID:', result);
        } else {
            console.log('❌ Failed: No response from Firebase (check your credentials).');
        }
    } catch (error) {
        console.error('❌ Error occurred:', error.message);
    }
}

runTest();
