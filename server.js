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



app.use(express.json({ limit: '10mb' })); // parse JSON body
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // parse URL-encoded


app.use(helmet()); // sets various HTTP headers for security
app.use(cors()); // enable CORS


if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}
app.use(healthRouter);

app.use(rateLimitMiddleware);


app.get('/health', (req, res) =>
  res.status(200).json({ status: 'ok', uptime: process.uptime() })
);


app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/credits', creditRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/conversations', conversationRoutes);
app.use('/api/v1/notifications', notificationRoutes);

app.use(errorHandler);
module.exports = app;
