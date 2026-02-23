const admin = require('firebase-admin');
require('dotenv').config();

let messaging = null;

try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        let serviceAccount;
        try {
            // Attempt to parse as JSON first
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        } catch (e) {
            // If not JSON, assume it's a Base64 encoded string
            const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8');
            serviceAccount = JSON.parse(decoded);
        }

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        
        messaging = admin.messaging();
        console.log('✅ Firebase Admin initialized successfully.');
    } else {
        console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT not found in environment variables. FCM will be disabled.');
    }
} catch (error) {
    console.error('❌ Failed to initialize Firebase Admin:', error.message);
}

/**
 * Send a notification to a specific FCM token
 * @param {string} token - The FCM registration token
 * @param {Object} payload - Notification data { title, body, data, icon }
 */
async function sendFcmNotification(token, payload) {
    if (!messaging) {
        console.warn('FCM ignored: Firebase not initialized.');
        return null;
    }

    if (!token) return null;

    const message = {
        token: token,
        notification: {
            title: payload.title,
            body: payload.body,
        },
        data: payload.data || {},
        android: {
            notification: {
                icon: payload.icon || 'stock_ticker_update',
                color: '#7e57c2'
            }
        },
        webpush: {
            fcmOptions: {
                link: payload.url || '/'
            }
        }
    };

    try {
        const response = await messaging.send(message);
        console.log('Successfully sent FCM message:', response);
        return response;
    } catch (error) {
        console.error('Error sending FCM message:', error);
        if (error.code === 'messaging/registration-token-not-registered') {
             // Token is invalid, should be cleaned up in the database if possible
             return 'INVALID_TOKEN';
        }
        throw error;
    }
}

module.exports = { sendFcmNotification };
