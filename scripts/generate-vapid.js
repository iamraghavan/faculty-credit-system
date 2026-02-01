const webpush = require('web-push');
const vapidKeys = webpush.generateVAPIDKeys();

console.log('PUBLIC_KEY=' + vapidKeys.publicKey);
console.log('PRIVATE_KEY=' + vapidKeys.privateKey);
