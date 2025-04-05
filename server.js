const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const subscriptionRoutes = require('./routes/subscriptionRoutes');

dotenv.config();
const app = express();

// More flexible CORS configuration for development
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow any localhost origin
    if (origin.startsWith('http://localhost:')) {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'x-auth-token',
    'authorization'
  ],
  exposedHeaders: ['Content-Type'],  // Allow image content type headers
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Webhook route must come BEFORE other routes
app.use('/api/subscriptions/webhook', express.raw({type: 'application/json'}));

// Routes
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/jobs', require('./routes/jobRoutes'));
app.use('/api/subscriptions', subscriptionRoutes);

// Add this before the static middleware
app.use((req, res, next) => {
  if (req.url.startsWith('/uploads')) {
    console.log('Image request:', req.url);
  }
  next();
});

// Update the static middleware
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: function(res, path) {
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Access-Control-Allow-Origin', '*');
  }
}));

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, 'uploads/logos');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 