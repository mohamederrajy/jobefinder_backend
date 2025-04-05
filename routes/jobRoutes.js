const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');
const Job = require('../models/Job');
const User = require('../models/User');
const upload = require('../middleware/upload');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const Settings = require('../models/Settings');

// Validation middleware
const validateJob = [
  body('title').notEmpty().withMessage('Title is required'),
  body('company').notEmpty().withMessage('Company is required'),
  body('hourlyRate').isNumeric().withMessage('Hourly rate must be a number'),
  body('address.street').notEmpty().withMessage('Street address is required'),
  body('address.city').notEmpty().withMessage('City is required'),
  body('address.state').notEmpty().withMessage('State is required'),
  body('address.zipCode').matches(/^\d{5}(-\d{4})?$/).withMessage('Valid ZIP code is required'),
  body('tags').isArray().withMessage('Tags must be an array'),
  body('isUrgent').isBoolean().optional(),
  body('jobUrl').optional().isURL().withMessage('Job URL must be a valid URL'),
  body('contactDetails.email').optional().isEmail().withMessage('Contact email must be valid'),
  body('contactDetails.phone').optional().isMobilePhone().withMessage('Contact phone must be valid')
];

// Middleware to check subscription
const checkSubscription = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    
    // Admins bypass subscription check
    if (user.role === 'admin') {
      return next();
    }

    // Check if user has active paid subscription
    if (!user.subscription.isPaid || 
        (user.subscription.endDate && new Date() > user.subscription.endDate)) {
      return res.status(403).json({ 
        message: 'Please upgrade to a paid subscription to view full job details'
      });
    }
    next();
  } catch (err) {
    res.status(500).send('Server error');
  }
};

// Create job with logo and demo image upload - Admin only
router.post('/', [auth, isAdmin, upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'demoImage', maxCount: 1 }
])], async (req, res) => {
  try {
    const jobData = JSON.parse(req.body.jobData);
    
    // Add logo path if file was uploaded
    if (req.files.logo) {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      jobData.logo = `${baseUrl}/uploads/logos/${req.files.logo[0].filename}`;
    }

    // Add demo image path if file was uploaded
    if (req.files.demoImage) {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      jobData.imageUrl = `${baseUrl}/uploads/demos/${req.files.demoImage[0].filename}`;
    }

    const job = new Job({
      ...jobData,
      createdBy: req.user.id
    });

    await job.save();
    res.json(job);
  } catch (err) {
    // Delete uploaded files if job creation fails
    if (req.files) {
      Object.values(req.files).forEach(fileArray => {
        fileArray.forEach(file => {
          fs.unlinkSync(file.path);
        });
      });
    }
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Public route - Preview jobs selected by admin
router.get('/preview', async (req, res) => {
  try {
    // Get settings with selected preview jobs
    const settings = await Settings.findOne()
      .populate({
        path: 'previewJobs',
        select: 'title company logo imageUrl address hourlyRate tags isUrgent about jobUrl contactDetails createdAt'
      });

    let previewJobs;

    // If no settings or no preview jobs selected, get most recent jobs
    if (!settings || !settings.previewJobs.length) {
      previewJobs = await Job.find()
        .select('title company logo imageUrl address hourlyRate tags isUrgent about jobUrl contactDetails createdAt')
        .sort({ createdAt: -1 })
        .limit(4);
    } else {
      previewJobs = settings.previewJobs;
    }

    // Transform the response to show full details only for first job
    const transformedJobs = previewJobs.map((job, index) => {
      if (index === 0) {
        // First job - return all details
        return {
          _id: job._id,
          title: job.title,
          company: job.company,
          logo: job.logo,
          imageUrl: job.imageUrl,
          about: job.about,
          hourlyRate: job.hourlyRate,
          address: job.address, // Full address
          tags: job.tags,
          isUrgent: job.isUrgent,
          jobUrl: job.jobUrl,
          contactDetails: job.contactDetails,
          createdAt: job.createdAt
        };
      } else {
        // Other jobs - limited details
        return {
          _id: job._id,
          title: job.title,
          company: job.company,
          logo: job.logo,
          imageUrl: job.imageUrl,
          about: job.about,
          hourlyRate: job.hourlyRate,
          address: {
            city: job.address.city
          },
          tags: job.tags,
          isUrgent: job.isUrgent,
          createdAt: job.createdAt
        };
      }
    });

    res.json(transformedJobs);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Protected route - Full job details for paid users
router.get('/', [auth, checkSubscription], async (req, res) => {
  try {
    const { city, minHourlyRate, maxHourlyRate, tags, isUrgent, search } = req.query;

    // Build filter object
    const filter = {};

    // Add filters if they exist
    if (city) filter['address.city'] = new RegExp(city, 'i');
    if (minHourlyRate) filter.hourlyRate = { $gte: Number(minHourlyRate) };
    if (maxHourlyRate) {
      filter.hourlyRate = { ...filter.hourlyRate, $lte: Number(maxHourlyRate) };
    }
    if (tags) filter.tags = { $in: tags.split(',') };
    if (isUrgent === 'true') filter.isUrgent = true;
    if (search) {
      filter.$or = [
        { title: new RegExp(search, 'i') },
        { company: new RegExp(search, 'i') },
        { 'address.city': new RegExp(search, 'i') }
      ];
    }

    const jobs = await Job.find(filter)
      .sort({ createdAt: -1 })
      .populate('createdBy', 'email');

    res.json(jobs);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Get job by ID - Smart response based on subscription
router.get('/:id', async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate('createdBy', 'email');
    
    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    // Check if this job is the first preview job
    const settings = await Settings.findOne()
      .populate('previewJobs', '_id');
    
    const isFirstPreviewJob = settings?.previewJobs?.length > 0 && 
      settings.previewJobs[0]._id.toString() === job._id.toString();

    // If it's the first preview job, return full details
    if (isFirstPreviewJob) {
      return res.json(job);
    }

    // Check if user is authenticated and has subscription
    const token = req.header('x-auth-token');
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.user.id);
        
        // If admin or paid subscriber, return full details
        if (user && (user.role === 'admin' || 
            (user.subscription.isPaid && 
             (!user.subscription.endDate || new Date() < user.subscription.endDate)))) {
          return res.json(job);
        }
      } catch (err) {
        // Token verification failed - continue to limited response
      }
    }

    // For non-subscribers, return limited details
    const limitedJob = {
      _id: job._id,
      title: job.title,
      company: job.company,
      logo: job.logo,
      imageUrl: job.imageUrl,
      about: job.about,
      hourlyRate: job.hourlyRate,
      address: {
        city: job.address.city
      },
      tags: job.tags,
      isUrgent: job.isUrgent,
      createdAt: job.createdAt
    };

    res.json(limitedJob);
  } catch (err) {
    console.error(err.message);
    if (err.kind === 'ObjectId') {
      return res.status(404).json({ message: 'Job not found' });
    }
    res.status(500).send('Server error');
  }
});

// Update job - Admin only
router.put('/:id', [auth, isAdmin, upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'demoImage', maxCount: 1 }
])], async (req, res) => {
  try {
    let jobData;
    
    if (req.files && (req.files.logo || req.files.demoImage)) {
      jobData = JSON.parse(req.body.jobData || '{}');
      
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      
      // Add logo path if new logo was uploaded
      if (req.files.logo) {
        jobData.logo = `${baseUrl}/uploads/logos/${req.files.logo[0].filename}`;
      }
      
      // Add demo image path if new demo image was uploaded
      if (req.files.demoImage) {
        jobData.imageUrl = `${baseUrl}/uploads/demos/${req.files.demoImage[0].filename}`;
      }
    } else {
      jobData = req.body;
    }

    const job = await Job.findByIdAndUpdate(
      req.params.id,
      { $set: jobData },
      { new: true }
    );

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    res.json(job);
  } catch (err) {
    // Delete uploaded files if update failed
    if (req.files) {
      Object.values(req.files).forEach(fileArray => {
        fileArray.forEach(file => {
          try {
            fs.unlinkSync(file.path);
          } catch (unlinkErr) {
            console.error('Error deleting file:', unlinkErr);
          }
        });
      });
    }
    
    console.error('Update job error:', err.message, err.stack);
    res.status(500).json({ message: 'Server error updating job', error: err.message });
  }
});

// Delete job - Admin only
router.delete('/:id', [auth, isAdmin], async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    await Job.findByIdAndDelete(req.params.id);
    res.json({ message: 'Job removed' });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router; 