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

// 👇 Trust proxy (for Vercel / Nginx / etc.)
app.set('trust proxy', 1);

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- ✅ OPEN CORS CONFIGURATION (Allow everything) ---
app.use(cors({
  origin: true, // Reflects request origin automatically
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ✅ Preflight requests (use string '/.*' instead of '*' to avoid path-to-regexp error)
app.options('/api/*', cors());
app.options('/health', cors());

// --- Security Middleware ---
app.use(helmet());
app.use(mongoSanitize());

// --- Logging ---
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// --- Health Route ---
app.use(healthRouter);

// --- Rate Limiting ---
app.use(rateLimitMiddleware);

// --- Redirect root and /login ---
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

// --- Error Handler ---
app.use(errorHandler);

module.exports = app;
