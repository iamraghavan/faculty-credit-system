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

// 👇 Trust proxy (for Nginx / Vercel / etc.)
app.set('trust proxy', 1);

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- ✅ CORS configuration ---
const allowedDomains = [
  'https://fcs.egspgroup.in', // main production site
  /\.cloudworkstations\.dev$/, // allow ANY subdomain of cloudworkstations.dev
];

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (e.g. curl, Postman)
    if (!origin) return callback(null, true);

    const isAllowed = allowedDomains.some((domain) => {
      if (typeof domain === 'string') return origin === domain;
      if (domain instanceof RegExp) return domain.test(origin);
      return false;
    });

    if (isAllowed) {
      return callback(null, true);
    } else {
      console.warn(`🚫 Blocked by CORS: ${origin}`);
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ✅ Important: handle preflight requests explicitly
app.options('*', cors());

// --- Security Middleware ---
app.use(helmet());
app.use(mongoSanitize());

// --- Logging (only in dev) ---
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// --- Health Route ---
app.use(healthRouter);

// --- Rate Limiting ---
app.use(rateLimitMiddleware);

// --- Root Redirect ---
app.get(['/', '/login'], (req, res) => {
  res.redirect('https://fcs.egspgroup.in/u/portal/auth?faculty_login');
});

// --- Health Check ---
app.get('/health', (req, res) =>
  res.status(200).json({ status: 'ok', uptime: process.uptime() })
);

// --- API Routes ---
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/credits', creditRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/conversations', conversationRoutes);
app.use('/api/v1/notifications', notificationRoutes);

// --- Global Error Handler ---
app.use(errorHandler);

module.exports = app;
