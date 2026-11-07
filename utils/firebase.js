const admin = require('firebase-admin');
require('dotenv').config();

let messaging = null;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch {
      serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8'));
    }
    const app = admin.apps.length
      ? admin.app()
      : admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    messaging = admin.messaging(app);
  } else {
    console.warn('FIREBASE_SERVICE_ACCOUNT is not configured. FCM delivery is disabled.');
  }
} catch (error) {
  console.error('Firebase Admin initialization failed:', error.message);
}

function webLink(value) {
  const origin = process.env.FRONTEND_URL;
  if (!origin) return null;
  try {
    const base = new URL(origin);
    if (base.protocol !== 'https:') return null;
    const candidate = new URL(value || '/u/portal/dashboard/notifications', base);
    if (candidate.origin !== base.origin || candidate.protocol !== 'https:') return null;
    return candidate.href;
  } catch {
    return null;
  }
}

async function sendFcmNotification(token, payload) {
  if (!messaging || !token) return null;
  const link = webLink(payload.url);
  const data = Object.fromEntries(Object.entries(payload.data || {}).map(([key, value]) => [key, String(value)]));
  const message = {
    token,
    notification: { title: String(payload.title || 'CreditWise'), body: String(payload.body || '') },
    data,
    android: { notification: { color: '#7e57c2', channelId: 'high_importance_channel' } },
    ...(link ? { webpush: { fcmOptions: { link } } } : {}),
  };
  try {
    return await messaging.send(message);
  } catch (error) {
    if (error.code === 'messaging/registration-token-not-registered') return 'INVALID_TOKEN';
    console.error('FCM delivery failed:', error.code || error.name || error.message);
    throw error;
  }
}

module.exports = { sendFcmNotification };
