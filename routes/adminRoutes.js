const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const User = require('../models/User');
const Job = require('../models/Job');
const Settings = require('../models/Settings');

// Get all users - Admin only
router.get('/users', auth, isAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Create new user - Admin only
router.post('/users', 
  [
    auth,
    isAdmin,
    [
      body('email').isEmail().withMessage('Please enter a valid email'),
      body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
      body('zipCode').matches(/^\d{5}(-\d{4})?$/).withMessage('Please enter a valid ZIP code'),
      body('role').isIn(['user', 'admin']).withMessage('Invalid role')
    ]
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password, zipCode, role } = req.body;

      let user = await User.findOne({ email });
      if (user) {
        return res.status(400).json({ message: 'User already exists' });
      }

      user = new User({
        email,
        password,
        zipCode,
        role
      });

      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);

      await user.save();

      res.json({
        user: {
          id: user.id,
          email: user.email,
          zipCode: user.zipCode,
          role: user.role
        }
      });
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server error');
    }
  }
);

// Update user - Admin only
router.put('/users/:id', auth, isAdmin, async (req, res) => {
  try {
    const { email, zipCode, role } = req.body;
    const updateFields = {};
    if (email) updateFields.email = email;
    if (zipCode) updateFields.zipCode = zipCode;
    if (role) updateFields.role = role;

    let user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Delete user - Admin only
router.delete('/users/:id', auth, isAdmin, async (req, res) => {
  try {
    // First check if user exists
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if user has created jobs
    const userJobs = await Job.find({ createdBy: req.params.id });
    
    // If user has created jobs, either reassign them or delete them
    if (userJobs.length > 0) {
      // Option 1: Reassign jobs to admin
      await Job.updateMany(
        { createdBy: req.params.id },
        { $set: { createdBy: req.user.id } }
      );
      
      // Option 2 (alternative): Delete all jobs created by this user
      // await Job.deleteMany({ createdBy: req.params.id });
    }

    // Now delete the user
    await User.findByIdAndDelete(req.params.id);
    
    res.json({ 
      message: 'User removed',
      reassignedJobs: userJobs.length
    });
  } catch (err) {
    console.error('Error deleting user:', err.message, err.stack);
    res.status(500).json({ 
      message: 'Server error deleting user', 
      error: err.message 
    });
  }
});

// Get admin statistics
router.get('/statistics', [auth, isAdmin], async (req, res) => {
  try {
    // Get user statistics
    const userStats = {
      totalUsers: await User.countDocuments(),
      totalAdmins: await User.countDocuments({ role: 'admin' }),
      totalRegularUsers: await User.countDocuments({ role: 'user' }),
      recentUsers: await User.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .select('-password')
    };

    // Get job statistics
    const jobStats = {
      totalJobs: await Job.countDocuments(),
      urgentJobs: await Job.countDocuments({ isUrgent: true }),
      jobsByHourlyRate: {
        under15: await Job.countDocuments({ hourlyRate: { $lt: 15 } }),
        between15and25: await Job.countDocuments({ 
          hourlyRate: { $gte: 15, $lte: 25 } 
        }),
        over25: await Job.countDocuments({ hourlyRate: { $gt: 25 } })
      },
      recentJobs: await Job.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('createdBy', 'email')
    };

    // Get location statistics
    const locationStats = await Job.aggregate([
      {
        $group: {
          _id: "$address.city",
          count: { $sum: 1 },
          averageRate: { $avg: "$hourlyRate" }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    res.json({
      userStats,
      jobStats,
      locationStats
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Update preview jobs - Admin only
router.put('/settings/preview-jobs', [auth, isAdmin], async (req, res) => {
  try {
    const { jobIds } = req.body;

    // Validate jobIds array
    if (!Array.isArray(jobIds)) {
      return res.status(400).json({ 
        message: 'jobIds must be an array' 
      });
    }

    // Verify all jobs exist
    const jobs = await Job.find({ _id: { $in: jobIds } });
    if (jobs.length !== jobIds.length) {
      return res.status(400).json({ 
        message: 'One or more jobs not found' 
      });
    }

    // Find and update settings, create if doesn't exist
    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings();
    }

    settings.previewJobs = jobIds;
    settings.updatedAt = new Date();
    settings.updatedBy = req.user.id;
    await settings.save();

    // Return populated settings
    const updatedSettings = await Settings.findById(settings._id)
      .populate('previewJobs')
      .populate('updatedBy', 'email');

    res.json({
      message: 'Preview jobs updated successfully',
      settings: updatedSettings
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Get current settings - Admin only
router.get('/settings', [auth, isAdmin], async (req, res) => {
  try {
    let settings = await Settings.findOne()
      .populate('previewJobs')
      .populate('updatedBy', 'email');
    
    if (!settings) {
      settings = new Settings();
      await settings.save();
    }

    res.json(settings);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Cancel User Subscription - Admin only
router.put('/users/:userId/cancel-subscription', [auth, isAdmin], async (req, res) => {
  try {
    const userId = req.params.userId;
    
    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Update subscription to free/unpaid
    user.subscription = {
      isPaid: false,
      plan: 'free'
    };
    
    await user.save();
    
    res.json({
      message: 'Subscription cancelled successfully',
      user: {
        _id: user._id,
        email: user.email,
        subscription: user.subscription
      }
    });
  } catch (err) {
    console.error('Cancel subscription error:', err.message);
    res.status(500).json({ message: 'Server error cancelling subscription' });
  }
});

// Update User Subscription - Admin only
router.put('/users/:userId/subscription', [auth, isAdmin], async (req, res) => {
  try {
    const userId = req.params.userId;
    const { isPaid, plan, months } = req.body;
    
    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Update subscription
    const startDate = new Date();
    const endDate = new Date();
    if (months) {
      endDate.setMonth(endDate.getMonth() + parseInt(months));
    } else {
      endDate.setMonth(endDate.getMonth() + 1); // Default 1 month
    }
    
    user.subscription = {
      isPaid: isPaid === undefined ? true : isPaid,
      plan: plan || 'premium',
      startDate: startDate,
      endDate: endDate
    };
    
    await user.save();
    
    res.json({
      message: 'Subscription updated successfully',
      user: {
        _id: user._id,
        email: user.email,
        subscription: user.subscription
      }
    });
  } catch (err) {
    console.error('Update subscription error:', err.message);
    res.status(500).json({ message: 'Server error updating subscription' });
  }
});

// Get User Details - Admin only
router.get('/users/:userId', [auth, isAdmin], async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select('-password');
      
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router; 