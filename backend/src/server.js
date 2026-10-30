// Load .env from the backend folder regardless of working directory
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const { requireAuth } = require('./middleware/auth');
const authRouter = require('./routes/auth');
const productsRouter = require('./routes/products');
const requestsRouter = require('./routes/requests');

const app = express();
const PORT = process.env.PORT || 5000;

// Normalize and parse allowed origins from FRONTEND_URL (supports comma-separated URLs)
// Always include localhost:5500 and 127.0.0.1:5500 for local development.
const defaultLocalOrigins = ['http://localhost:5500', 'http://127.0.0.1:5500'];
const configuredOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map(url => url.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([...defaultLocalOrigins, ...configuredOrigins]));

// Dynamic CORS origin validator: allows requests only from explicitly configured origins
app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g. mobile apps, curl, server-to-server, Render health check probes)
    if (!origin) {
      return callback(null, true);
    }
    const normalizedOrigin = origin.trim().replace(/\/+$/, '');
    if (allowedOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS policy rejection: Origin "${origin}" is not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Express body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Public health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'CampusSwap API is running'
  });
});

// Authentication routes (/api/auth/register, /api/auth/login)
app.use('/api/auth', authRouter);

// Product marketplace routes (/api/products)
app.use('/api/products', productsRouter);

// Buy and rental request routes (/api/requests)
app.use('/api/requests', requestsRouter);

// Protected user profile endpoint
app.get('/api/me', requireAuth, (req, res) => {
  // Returns authenticated user's ID, email, and full_name from metadata
  res.status(200).json({
    success: true,
    data: {
      id: req.user.id,
      email: req.user.email,
      full_name: req.user.user_metadata?.full_name || null
    }
  });
});

// 404 handler for unmatched routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Centralized error handling middleware
app.use((err, req, res, next) => {
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum allowed size is 5MB per image.'
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files uploaded. Maximum is 5 images per listing.'
      });
    }
    return res.status(400).json({
      success: false,
      message: `Image upload error: ${err.message}`
    });
  }

  if (err.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }

  console.error('Unhandled server error:', err.message || err);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

app.listen(PORT, () => {
  console.log(`CampusSwap backend server running on port ${PORT}`);
});
