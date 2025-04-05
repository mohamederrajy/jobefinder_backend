const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');
const Job = require('../models/Job');

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

// Validation middleware for login
const validateLogin = [
  body('email').isEmail().withMessage('Please enter a valid email'),
  body('password').exists().withMessage('Password is required')
];

// Signup route
router.post('/signup', validateSignup, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, zipCode, role } = req.body;

    // Check if user already exists
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create new user
    user = new User({
      email,
      password,
      zipCode,
      role: role || 'user'
    });

    // Hash password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);

    // Save user to database
    await user.save();

    // Create JWT token
    const payload = {
      user: {
        id: user.id,
        email: user.email,
        zipCode: user.zipCode,
        role: user.role
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
          user: {
            email: user.email,
            zipCode: user.zipCode,
            role: user.role
          }
        });
      }
    );
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Login route
router.post('/login', validateLogin, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Create JWT token
    const payload = {
      user: {
        id: user.id,
        email: user.email,
        zipCode: user.zipCode,
        role: user.role
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
          user: {
            email: user.email,
            zipCode: user.zipCode,
            role: user.role
          }
        });
      }
    );
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Update subscription
router.post('/subscribe', auth, async (req, res) => {
  try {
    const { plan, months } = req.body;
    
    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + months);

    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        subscription: {
          isPaid: true,
          startDate,
          endDate,
          plan
        }
      },
      { new: true }
    ).select('-password');

    res.json(user);
  } catch (err) {
    res.status(500).send('Server error');
  }
});

// Check subscription status
router.get('/subscription', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('subscription email');
    res.json(user);
  } catch (err) {
    res.status(500).send('Server error');
  }
});

// Save a job
router.post('/saved-jobs/:jobId', auth, async (req, res) => {
  try {
    console.log('Saving job, user ID:', req.user.id);
    console.log('Job ID to save:', req.params.jobId);

    // First find the user and job
    const user = await User.findById(req.user.id);
    console.log('Found user:', user ? 'yes' : 'no');

    const jobId = req.params.jobId;

    // Add error handling if user not found
    if (!user) {
      console.log('User not found');
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if job exists
    const job = await Job.findById(jobId);
    console.log('Found job:', job ? 'yes' : 'no');
    
    if (!job) {
      console.log('Job not found');
      return res.status(404).json({ message: 'Job not found' });
    }

    // Initialize savedJobs array if it doesn't exist
    if (!user.savedJobs) {
      console.log('Initializing savedJobs array');
      user.savedJobs = [];
    }

    // Check if job is already saved
    const isAlreadySaved = user.savedJobs.some(id => id.toString() === jobId);
    console.log('Job already saved:', isAlreadySaved);

    if (isAlreadySaved) {
      return res.status(400).json({ message: 'Job already saved' });
    }

    // Add job to saved jobs
    user.savedJobs.push(jobId);
    console.log('Saving user with new job');
    await user.save();

    // Return the updated saved jobs list
    const updatedUser = await User.findById(req.user.id)
      .populate({
        path: 'savedJobs',
        select: 'title company logo address hourlyRate tags isUrgent about createdAt'
      });

    console.log('Successfully saved job');
    res.json({
      message: 'Job saved successfully',
      savedJobs: updatedUser.savedJobs
    });

  } catch (err) {
    console.error('Save job error details:', {
      error: err.message,
      stack: err.stack,
      userId: req.user?.id,
      jobId: req.params.jobId
    });
    res.status(500).json({ 
      message: 'Server error saving job', 
      error: err.message,
      details: {
        userId: req.user?.id,
        jobId: req.params.jobId
      }
    });
  }
});

// Remove a saved job
router.delete('/saved-jobs/:jobId', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const jobId = req.params.jobId;

    // Add error handling if user not found
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Initialize savedJobs array if it doesn't exist
    if (!user.savedJobs) {
      user.savedJobs = [];
    }

    // Remove job from saved jobs
    user.savedJobs = user.savedJobs.filter(id => id.toString() !== jobId);
    await user.save();

    // Return the updated saved jobs list
    const updatedUser = await User.findById(req.user.id)
      .populate({
        path: 'savedJobs',
        select: 'title company logo address hourlyRate tags isUrgent about createdAt'
      });

    res.json({
      message: 'Job removed from saved jobs',
      savedJobs: updatedUser.savedJobs
    });

  } catch (err) {
    console.error('Remove saved job error:', err.message);
    res.status(500).json({ message: 'Server error removing job', error: err.message });
  }
});

// Get all saved jobs
router.get('/saved-jobs', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate({
        path: 'savedJobs',
        select: 'title company logo address hourlyRate tags isUrgent about createdAt'
      });

    res.json(user.savedJobs);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Get current user profile
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Update user profile
router.put('/profile', auth, async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      professionalTitle,
      location,
      phoneNumber,
      professionalSummary,
      skills,
      experience,
      education
    } = req.body;

    // Build profile object
    const profileFields = {};
    if (firstName) profileFields.firstName = firstName;
    if (lastName) profileFields.lastName = lastName;
    if (professionalTitle) profileFields.professionalTitle = professionalTitle;
    if (location) profileFields.location = location;
    if (phoneNumber) profileFields.phoneNumber = phoneNumber;
    if (professionalSummary) profileFields.professionalSummary = professionalSummary;
    if (skills) {
      profileFields.skills = Array.isArray(skills) 
        ? skills 
        : skills.split(',').map(skill => skill.trim());
    }

    // Update user profile
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { profile: profileFields } },
      { new: true }
    ).select('-password');

    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Add experience to profile
router.put('/profile/experience', auth, async (req, res) => {
  try {
    const {
      title,
      company,
      location,
      from,
      to,
      current,
      description
    } = req.body;

    const newExp = {
      title,
      company,
      location,
      from,
      to,
      current,
      description
    };

    // Add to experience array
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $push: { 'profile.experience': newExp } },
      { new: true }
    ).select('-password');

    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Delete experience from profile
router.delete('/profile/experience/:exp_id', auth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $pull: { 'profile.experience': { _id: req.params.exp_id } } },
      { new: true }
    ).select('-password');

    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Add education to profile
router.put('/profile/education', auth, async (req, res) => {
  try {
    const {
      school,
      degree,
      fieldOfStudy,
      from,
      to,
      current,
      description
    } = req.body;

    const newEdu = {
      school,
      degree,
      fieldOfStudy,
      from,
      to,
      current,
      description
    };

    // Add to education array
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $push: { 'profile.education': newEdu } },
      { new: true }
    ).select('-password');

    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Delete education from profile
router.delete('/profile/education/:edu_id', auth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $pull: { 'profile.education': { _id: req.params.edu_id } } },
      { new: true }
    ).select('-password');

    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router; 