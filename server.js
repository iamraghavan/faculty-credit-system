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

const app = express();

// 👇 Trust proxy for Vercel / other serverless providers
app.set('trust proxy', 1);

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security & sanitization
app.use(helmet());
// --- CORS configuration ---
const allowedDomains = [
  'https://fcs.egspgroup.in', // your main site
  /\.cloudworkstations\.dev$/, // allow any subdomain like *.cloudworkstations.dev
];

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);

    // Check if origin matches any allowed domain or pattern
    const isAllowed = allowedDomains.some((domain) => {
      if (typeof domain === 'string') return origin === domain;
      if (domain instanceof RegExp) return domain.test(origin);
      return false;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`🚫 Blocked by CORS: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(mongoSanitize());

// Logging
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Health route
app.use(healthRouter);

// Rate limiting
app.use(rateLimitMiddleware);

// Redirect root and /login routes
app.get(['/', '/login'], (req, res) => {
  res.redirect('https://fcs.egspgroup.in/u/portal/auth?faculty_login');
});

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

// Error handling middleware
app.use(errorHandler);

module.exports = app;
