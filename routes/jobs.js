const express = require('express');
const router = express.Router();
const Job = require('../models/Job');
const auth = require('../middleware/auth');
const { upload, uploadToCloudinary } = require('../utils/imageUpload');

// Create a new job with image upload
router.post('/', auth, upload.single('image'), async (req, res) => {
    try {
        const jobData = req.body;
        
        // If an image was uploaded, process it
        if (req.file) {
            const imageUrl = await uploadToCloudinary(req.file.buffer);
            jobData.imageUrl = imageUrl;
        }

        const job = new Job({
            ...jobData,
            manager: req.user.userId
        });

        await job.save();
        res.status(201).json(job);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Update a job with image upload
router.patch('/:id', auth, upload.single('image'), async (req, res) => {
    try {
        const updates = req.body;
        
        // If a new image was uploaded, process it
        if (req.file) {
            const imageUrl = await uploadToCloudinary(req.file.buffer);
            updates.imageUrl = imageUrl;
        }

        const job = await Job.findOne({ _id: req.params.id, manager: req.user.userId });
        if (!job) {
            return res.status(404).json({ message: 'Job not found' });
        }

        Object.keys(updates).forEach(update => job[update] = updates[update]);
        await job.save();
        
        res.json(job);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
}); 