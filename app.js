const express = require('express');
const app = express();

// Essential middleware - these MUST come before routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import routes
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const authRoutes = require('./routes/authRoutes');

// Webhook route must come BEFORE the general subscription routes
app.use('/api/subscriptions/webhook', express.raw({type: 'application/json'}));

console.log('Before mounting routes');

// Mount routes
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/auth', authRoutes);

// Log request tracking AFTER mounting routes
app.use((req, res, next) => {
  console.log('Request received:', req.method, req.url);
  next();
});

// Log all registered routes AFTER mounting them
console.log('Registered routes:', 
  app._router.stack
    .filter(layer => layer.route || (layer.name === 'router' && layer.handle.stack))
    .map(layer => {
      if (layer.route) {
        return {
          path: layer.route.path,
          methods: Object.keys(layer.route.methods)
        };
      }
      return {
        path: layer.regexp,
        methods: layer.handle.stack
          .filter(r => r.route)
          .map(r => ({
            path: r.route.path,
            methods: Object.keys(r.route.methods)
          }))
      };
    })
);

// Add error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something broke!' });
});

// Start server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log('Subscription routes mounted at /api/subscriptions');
});

module.exports = app; 