const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  previewJobs: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job'
  }],
  updatedAt: {
    type: Date,
    default: Date.now
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
});

module.exports = mongoose.model('Settings', settingsSchema); 