const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  zipCode: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  profile: {
    firstName: {
      type: String,
      trim: true
    },
    lastName: {
      type: String,
      trim: true
    },
    professionalTitle: {
      type: String,
      trim: true
    },
    location: {
      type: String,
      trim: true
    },
    phoneNumber: {
      type: String,
      trim: true
    },
    professionalSummary: {
      type: String,
      trim: true
    },
    skills: [{
      type: String,
      trim: true
    }],
    experience: [{
      title: {
        type: String,
        trim: true
      },
      company: {
        type: String,
        trim: true
      },
      location: {
        type: String,
        trim: true
      },
      from: Date,
      to: Date,
      current: {
        type: Boolean,
        default: false
      },
      description: {
        type: String,
        trim: true
      }
    }],
    education: [{
      school: {
        type: String,
        trim: true
      },
      degree: {
        type: String,
        trim: true
      },
      fieldOfStudy: {
        type: String,
        trim: true
      },
      from: Date,
      to: Date,
      current: {
        type: Boolean,
        default: false
      },
      description: {
        type: String,
        trim: true
      }
    }]
  },
  savedJobs: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job'
  }],
  stripeCustomerId: {
    type: String,
    default: null
  },
  subscription: {
    status: {
      type: String,
      enum: ['active', 'incomplete', 'incomplete_expired', 'trialing', 'past_due', 'canceled', 'unpaid', 'free'],
      default: 'free'
    },
    plan: {
      type: String,
      enum: ['free', 'monthly', 'quarterly', 'yearly'],
      default: 'free'
    },
    current_period_start: Number,
    current_period_end: Number,
    stripe_subscription_id: String,
    stripe_price_id: String,
    cancel_at_period_end: {
      type: Boolean,
      default: false
    },
    isPaid: {
      type: Boolean,
      default: false
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('User', userSchema); 