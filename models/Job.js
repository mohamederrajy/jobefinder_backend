const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  company: {
    type: String,
    required: true,
    trim: true
  },
  logo: {
    type: String,
    default: ''
  },
  about: {
    type: String,
    required: true,
    trim: true
  },
  jobUrl: {
    type: String,
    trim: true
  },
  contactDetails: {
    name: String,
    email: String,
    phone: String
  },
  hourlyRate: {
    type: Number,
    required: true
  },
  address: {
    street: String,
    city: String,
    state: String,
    zipCode: String
  },
  tags: [{
    type: String,
    trim: true
  }],
  isUrgent: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
});

module.exports = mongoose.model('Job', jobSchema); 