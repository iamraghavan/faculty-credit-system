// server.js - Express app configuration

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');

const rateLimitMiddleware = require('./Middleware/rateLimitMiddleware');
const { errorHandler } = require('./Middleware/errorMiddleware');

// Routes
const authRoutes = require('./Routes/authRoutes');
const userRoutes = require('./Routes/userRoutes');
const creditRoutes = require('./Routes/creditRoutes');
const adminRoutes = require('./Routes/adminRoutes');
const conversationRoutes = require('./Routes/conversations');
const notificationRoutes = require('./Routes/notificationRoutes');
const healthRouter = require('./Routes/health');
const analyticsRouter = require('./Routes/analyticsRoutes');

const app = express();

// 👇 Trust proxy for Vercel / other serverless providers
app.set('trust proxy', 1);

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security & sanitization
app.use(helmet());
app.use(cors());
// app.use(mongoSanitize());

// Logging
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Health route
app.use(healthRouter);

// Rate limiting
app.use(rateLimitMiddleware);

// Serve static files from 'public' directory
app.use(express.static('public'));

// Dynamic Service Worker to avoid exposing hardcoded keys
app.get('/firebase-messaging-sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`
    importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

    firebase.initializeApp({
      apiKey: "${process.env.GCP_API_KEY}",
      authDomain: "${process.env.FIREBASE_AUTH_DOMAIN}",
      projectId: "${process.env.FIREBASE_PROJECT_ID}",
      storageBucket: "${process.env.FIREBASE_STORAGE_BUCKET}",
      messagingSenderId: "${process.env.FIREBASE_MESSAGING_SENDER_ID}",
      appId: "${process.env.FIREBASE_APP_ID}"
    });

    const messaging = firebase.messaging();

    messaging.onBackgroundMessage((payload) => {
      console.log('[firebase-messaging-sw.js] Received background message ', payload);
      
      const notificationTitle = payload.notification?.title || 'New Notification';
      const notificationOptions = {
        body: payload.notification?.body || 'You have a new message from FCS.',
        icon: payload.notification?.icon || '/favicon.ico',
        badge: payload.notification?.icon || '/favicon.ico',
        data: payload.data || {}
      };

      return self.registration.showNotification(notificationTitle, notificationOptions);
    });
  `);
});

// Redirect root and /login routes
app.get(['/', '/login'], (req, res) => {
  res.redirect('https://fcs.egspgroup.in/u/portal/auth?faculty_login');
});

// API routes
// Shortener Redirect at root
const cdnController = require('./Controllers/cdnController');
app.get('/s/:id', cdnController.getShortUrl);

// API routes
app.get('/health', (req, res) =>
  res.status(200).json({ status: 'ok', uptime: process.uptime() })
);

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/credits', creditRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/conversations', conversationRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/analytics', analyticsRouter);

// CDN & Shortener Routes
const cdnRoutes = require('./Routes/cdnRoutes');
app.use('/cdn', cdnRoutes);
app.use('/api/v1/url', cdnRoutes);

// Catch-all 404 for debugging
app.use((req, res) => {
  console.log(`Unmatched route: ${req.method} ${req.url}`);
  res.status(404).json({
    success: false,
    message: `Route not found on Backend: ${req.method} ${req.url}`,
    hint: "If you are seeing this, the request REACHED the backend but didn't match any route."
  });
});

// Error handling middleware
app.use(errorHandler);

module.exports = app;
