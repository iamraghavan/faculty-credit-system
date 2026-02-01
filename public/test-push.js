// HARDCODED VAPID PUBLIC KEY (Copied from .env output)
const PUBLIC_VAPID_KEY = 'BLrsFHmq1niUPGhfcviZiDTdf1Kc64jci92HlSno45R2BdbFuyKTMxh0H2OtH-iCP6ftG46dL5dssJaoeYg0bLc';

// Attach event listener to avoid CSP "unsafe-inline" error
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('subscribeBtn');
    if (btn) {
        btn.addEventListener('click', subscribeUser);
    }
});

function log(msg) {
    const logDiv = document.getElementById('log');
    logDiv.textContent += msg + '\n';
    console.log(msg);
}

function urlBase64ToUint8Array(base64String) {
    try {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    } catch (e) {
        log('ERROR converting VAPID key: ' + e.message);
        throw e;
    }
}

async function subscribeUser() {
    const btn = document.getElementById('subscribeBtn');
    btn.disabled = true;
    btn.textContent = 'Processing...';

    try {
        log('Starting subscription process...');

        // 1. Check Token
        const token = document.getElementById('token').value;
        if (!token) {
            throw new Error('Please enter a valid JWT token first.');
        }

        // 2. Check Browser Support
        if (!('serviceWorker' in navigator)) {
            throw new Error('Service Workers not supported in this browser.');
        }
        if (!('PushManager' in window)) {
            throw new Error('Push Messaging not supported in this browser.');
        }

        // 3. Register Service Worker
        log('Registering SW...');
        const register = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
        log('SW Registered with scope: ' + register.scope);

        // 4. Wait for SW to be active
        if (!register.active && register.installing) {
            log('SW installing... waiting...');
            await new Promise(resolve => {
                const worker = register.installing;
                worker.addEventListener('statechange', () => {
                    if (worker.state === 'activated') resolve();
                });
            });
        }

        // 5. Subscribe
        log('Requesting notification permission...');
        const subscription = await register.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
        });

        log('Got Subscription endpoint: ' + subscription.endpoint);
        log('Sending to backend...');

        // 6. Save to Backend
        const res = await fetch('/api/v1/notifications/subscribe', {
            method: 'POST',
            body: JSON.stringify(subscription),
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Backend error');

        log('SUCCESS: ' + data.message);
        alert('Notifications Enabled! You can now test from Postman.');

    } catch (err) {
        log('CRITICAL ERROR: ' + err.name + ' - ' + err.message);
        console.error(err);
        alert('Error: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Enable Notifications';
    }
}
