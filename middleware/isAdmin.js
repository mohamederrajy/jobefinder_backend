module.exports = function(req, res, next) {
  // Check if user exists and is admin
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied. Admin only.' });
  }
  next();
}; 