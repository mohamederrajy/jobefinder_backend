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
  },
  stripeSettings: {
    secretKey: {
      type: String,
      default: ''
    },
    publishableKey: {
      type: String,
      default: ''
    },
    webhookSecret: {
      type: String,
      default: ''
    },
    prices: {
      monthly: {
        type: String,
        default: ''
      },
      quarterly: {
        type: String,
        default: ''
      },
      yearly: {
        type: String,
        default: ''
      }
    }
  }
});

module.exports = mongoose.model('Settings', settingsSchema); 