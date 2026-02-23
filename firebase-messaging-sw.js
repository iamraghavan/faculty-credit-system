importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBCT1UJcwqjKdsXL-6N_7qqa3lZRdAsqoE",
  authDomain: "gitdrive-m4hfj.firebaseapp.com",
  projectId: "gitdrive-m4hfj",
  messagingSenderId: "471156925064",
  appId: "1:471156925064:web:0bd4f67ad521b9a3d9b53d"
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: payload.notification.icon || '/favicon.ico',
    badge: payload.notification.icon || '/favicon.ico',
    data: payload.data
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});
