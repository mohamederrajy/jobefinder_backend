const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Manager = require('../models/Manager');

// Validation middleware
const validateSignup = [
  body('email').isEmail().withMessage('Please enter a valid email'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  body('zipCode')
    .matches(/^\d{5}(-\d{4})?$/)
    .withMessage('Please enter a valid ZIP code')
];

// Signup route
router.post('/signup', validateSignup, async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, zipCode } = req.body;

    // Check if manager already exists
    let manager = await Manager.findOne({ email });
    if (manager) {
      return res.status(400).json({ message: 'Manager already exists' });
    }

    // Create new manager
    manager = new Manager({
      email,
      password,
      zipCode
    });

    // Hash password
    const salt = await bcrypt.genSalt(10);
    manager.password = await bcrypt.hash(password, salt);

    // Save manager to database
    await manager.save();

    // Create JWT token
    const payload = {
      manager: {
        id: manager.id,
        email: manager.email,
        zipCode: manager.zipCode
      }
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: '24h' },
      (err, token) => {
        if (err) throw err;
        res.json({
          token,
          manager: {
            email: manager.email,
            zipCode: manager.zipCode
          }
        });
      }
    );
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router; 