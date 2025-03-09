const jwt = require('jsonwebtoken');

module.exports = function(req, res, next) {
  try {
    // Get token from header
    const token = req.header('x-auth-token');
    console.log('Auth middleware - token present:', !!token);

    // Check if no token
    if (!token) {
      console.log('No token provided');
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Token verified, user:', decoded.user);
    req.user = decoded.user;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    res.status(401).json({ message: 'Token is not valid' });
  }
}; 