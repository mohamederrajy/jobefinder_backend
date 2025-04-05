const express = require('express');
const router = express.Router();
const stripe = require('stripe');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Settings = require('../models/Settings');
const isAdmin = require('../middleware/isAdmin');
const Job = require('../models/Job');

console.log('Setting up subscription routes');

// Simple subscription creation endpoint
router.post('/', auth, async (req, res) => {
  try {
    // 1. Log and validate input
    const { duration, paymentMethodId } = req.body;
    console.log('⭐ New subscription request:', { duration, paymentMethodId });

    // 2. Validate duration
    const validDurations = ['monthly', 'quarterly', 'yearly'];
    if (!validDurations.includes(duration)) {
      return res.status(400).json({ 
        message: 'Invalid duration. Must be: monthly, quarterly, or yearly' 
      });
    }

    // 3. Get Stripe settings
    const settings = await Settings.findOne();
    if (!settings?.stripeSettings?.secretKey) {
      return res.status(400).json({ message: 'Stripe not configured' });
    }
    const stripe = require('stripe')(settings.stripeSettings.secretKey);

    // 4. Get price ID
    const priceId = settings.stripeSettings.prices[duration];
    if (!priceId) {
      return res.status(400).json({ message: `No price found for ${duration} plan` });
    }

    // 5. Get or create customer
    const user = await User.findById(req.user.id);
    let customerId = user.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        payment_method: paymentMethodId
      });
      customerId = customer.id;
    }

    // 6. Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      default_payment_method: paymentMethodId,
      payment_settings: {
        payment_method_types: ['card'],
        save_default_payment_method: 'on_subscription'
      }
    });

    console.log('✅ Stripe subscription created:', {
      id: subscription.id,
      status: subscription.status
    });

    // 7. Prepare subscription data with isPaid true when status is active
    const newSubscription = {
      status: subscription.status,
      plan: duration,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId,
      cancel_at_period_end: false,
      isPaid: subscription.status === 'active' // This will be true when subscription is active
    };

    // 8. Update user document with isPaid status
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { 
        $set: {
          stripeCustomerId: customerId,
          subscription: {
            ...newSubscription,
            isPaid: subscription.status === 'active' // Make sure isPaid is set
          }
        }
      },
      { 
        new: true,
        runValidators: true
      }
    );

    console.log('✅ User subscription updated:', {
      ...updatedUser.subscription,
      isPaid: updatedUser.subscription.isPaid // Log the isPaid status
    });

    // 9. Send response
    res.json({
      success: true,
      subscriptionId: subscription.id,
      status: subscription.status,
      plan: duration,
      customerId: customerId,
      subscription: {
        ...newSubscription,
        isPaid: subscription.status === 'active'
      },
      isPaid: subscription.status === 'active'
    });

  } catch (error) {
    console.error('❌ Subscription error:', error);
    res.status(400).json({ 
      success: false,
      message: error.message 
    });
  }
});

// Check subscription status (GET /api/subscriptions/status)
router.get('/status', auth, async (req, res) => {
  console.log('Status endpoint hit');
  try {
    const settings = await Settings.findOne();
    const stripe = require('stripe')(settings.stripeSettings.secretKey);
    const user = await User.findById(req.user.id);
    
    if (!user.stripeCustomerId) {
      // Update user with free subscription
      user.subscription = {
        status: 'free',
        plan: 'free',
        current_period_end: null,
        current_period_start: null,
        stripe_subscription_id: null,
        stripe_price_id: null,
        cancel_at_period_end: false,
        isPaid: false
      };
      await user.save();

      return res.json({
        isPaid: false,
        subscription: user.subscription
      });
    }

    // Check Stripe subscription
    const subscriptions = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      limit: 1,
      status: 'all'
    });

    const subscription = subscriptions.data[0];
    
    if (subscription) {
      // Get the plan from price ID
      const plan = await getPlanFromPriceId(subscription.items.data[0].price.id);
      
      // Update user's subscription in database
      user.subscription = {
        status: subscription.status,
        plan: plan,
        current_period_end: subscription.current_period_end,
        current_period_start: subscription.current_period_start,
        stripe_subscription_id: subscription.id,
        stripe_price_id: subscription.items.data[0].price.id,
        cancel_at_period_end: subscription.cancel_at_period_end,
        isPaid: subscription.status === 'active'
      };
      await user.save();

      console.log('Updated user subscription:', user.subscription);

      return res.json({
        isPaid: subscription.status === 'active',
        subscription: user.subscription
      });
    }

    // No subscription found, update user to free
    user.subscription = {
      status: 'free',
      plan: 'free',
      current_period_end: null,
      current_period_start: null,
      stripe_subscription_id: null,
      stripe_price_id: null,
      cancel_at_period_end: false,
      isPaid: false
    };
    await user.save();

    res.json({
      isPaid: false,
      subscription: user.subscription
    });

  } catch (error) {
    console.error('Status check error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Check if user has paid subscription (GET /api/subscriptions/check-payment)
router.get('/check-payment', auth, async (req, res) => {
  console.log('Check payment status endpoint hit');
  try {
    const settings = await Settings.findOne();
    const stripe = require('stripe')(settings.stripeSettings.secretKey);
    const user = await User.findById(req.user.id);
    
    // If no Stripe customer ID, user hasn't paid
    if (!user.stripeCustomerId) {
      return res.json({
        isPaid: false,
        plan: 'free',
        message: 'No subscription found'
      });
    }

    // Check Stripe subscription
    const subscriptions = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      limit: 1,
      status: 'all'
    });

    const subscription = subscriptions.data[0];
    
    if (subscription) {
      const isActive = subscription.status === 'active' || subscription.status === 'trialing';
      
      return res.json({
        isPaid: isActive,
        plan: isActive ? await getPlanFromPriceId(subscription.items.data[0].price.id) : 'free',
        subscriptionStatus: subscription.status,
        endDate: new Date(subscription.current_period_end * 1000),
        message: isActive ? 'Active subscription' : 'Subscription not active'
      });
    }

    // No subscription found
    return res.json({
      isPaid: false,
      plan: 'free',
      message: 'No active subscription'
    });

  } catch (error) {
    console.error('Payment check error:', error);
    res.status(400).json({ 
      isPaid: false,
      message: 'Error checking payment status'
    });
  }
});

// Helper function needs to be async to use await
async function getPlanFromPriceId(priceId) {
  try {
    const settings = await Settings.findOne();
    const prices = settings.stripeSettings.prices;
    
    if (priceId === prices.monthly) return 'monthly';
    if (priceId === prices.quarterly) return 'quarterly';
    if (priceId === prices.yearly) return 'yearly';
    return 'free';
  } catch (error) {
    console.error('Error in getPlanFromPriceId:', error);
    return 'free';
  }
}

// Cancel subscription (POST /api/subscriptions/cancel)
router.post('/cancel', auth, async (req, res) => {
  console.log('Cancel endpoint hit');
  try {
    const settings = await Settings.findOne();
    const stripeInstance = require('stripe')(settings.stripeSettings.secretKey);
    const user = await User.findById(req.user.id);
    
    if (!user.stripeCustomerId) {
      return res.status(400).json({ message: 'No active subscription found' });
    }

    const subscriptions = await stripeInstance.subscriptions.list({
      customer: user.stripeCustomerId,
      status: 'active',
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      return res.status(400).json({ message: 'No active subscription found' });
    }

    // Cancel at period end
    await stripeInstance.subscriptions.update(subscriptions.data[0].id, {
      cancel_at_period_end: true
    });

    res.json({ message: 'Subscription will be canceled at the end of the billing period' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Test route without auth
router.get('/test', (req, res) => {
  res.json({ message: 'Subscription test route working' });
});

// Update the webhook handler to handle payment success
router.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  try {
    const settings = await Settings.findOne();
    const stripeInstance = require('stripe')(settings.stripeSettings.secretKey);
    const sig = req.headers['stripe-signature'];
    
    console.log('Webhook received:', {
      signature: sig ? 'Present' : 'Missing',
      body: typeof req.body === 'string' ? 'String' : 'Object'
    });

    const event = stripeInstance.webhooks.constructEvent(
      req.body,
      sig,
      settings.stripeSettings.webhookSecret
    );

    console.log('Webhook event type:', event.type);

    switch (event.type) {
      case 'customer.subscription.updated':
      case 'customer.subscription.created':
      case 'invoice.paid':
        const subscription = event.data.object;
        console.log('Processing subscription:', subscription.id);
        
        const user = await User.findOne({ stripeCustomerId: subscription.customer });
        if (!user) {
          console.log('User not found for customer:', subscription.customer);
          break;
        }

        // Get subscription details
        const subscriptionDetails = await stripeInstance.subscriptions.retrieve(
          subscription.subscription || subscription.id
        );

        // Get the plan from price ID
        const plan = await getPlanFromPriceId(subscriptionDetails.items.data[0].price.id);

        // Update user subscription with correct plan value
        user.subscription = {
          status: subscriptionDetails.status,
          plan: plan,
          current_period_end: subscriptionDetails.current_period_end,
          current_period_start: subscriptionDetails.current_period_start,
          stripe_subscription_id: subscriptionDetails.id,
          stripe_price_id: subscriptionDetails.items.data[0].price.id,
          cancel_at_period_end: subscriptionDetails.cancel_at_period_end,
          isPaid: subscriptionDetails.status === 'active'
        };

        await user.save();
        console.log('User subscription updated successfully');
        break;

      default:
        console.log('Unhandled event type:', event.type);
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook Error:', err);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// Update subscription prices - Admin only
router.put('/prices', [auth, isAdmin], async (req, res) => {
  try {
    const { monthly, quarterly, yearly } = req.body;

    // Validate that at least one price is provided
    if (!monthly && !quarterly && !yearly) {
      return res.status(400).json({ message: 'At least one price ID must be provided' });
    }

    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings();
    }

    // Initialize stripeSettings if needed
    if (!settings.stripeSettings) {
      settings.stripeSettings = {};
    }

    // Initialize prices if needed
    if (!settings.stripeSettings.prices) {
      settings.stripeSettings.prices = {};
    }

    // Update the prices
    if (monthly) settings.stripeSettings.prices.monthly = monthly;
    if (quarterly) settings.stripeSettings.prices.quarterly = quarterly;
    if (yearly) settings.stripeSettings.prices.yearly = yearly;

    // Save settings
    await settings.save();

    // Log for debugging
    console.log('Updated settings:', {
      prices: settings.stripeSettings.prices,
      secretKey: settings.stripeSettings.secretKey,
      publishableKey: settings.stripeSettings.publishableKey
    });

    res.json({
      message: 'Subscription prices updated successfully',
      stripePriceIds: {
        monthly: settings.stripeSettings.prices.monthly || '',
        quarterly: settings.stripeSettings.prices.quarterly || '',
        yearly: settings.stripeSettings.prices.yearly || ''
      },
      stripePublishableKey: settings.stripeSettings.publishableKey,
      stripeSecretKey: settings.stripeSettings.secretKey,
      stripeWebhookSecret: settings.stripeSettings.webhookSecret
    });
  } catch (error) {
    console.error('Error updating prices:', error);
    res.status(500).json({ message: 'Error updating subscription prices' });
  }
});

// Get subscription prices - Admin only
router.get('/prices', [auth, isAdmin], async (req, res) => {
  try {
    const settings = await Settings.findOne();
    
    // Log for debugging
    console.log('Retrieved settings:', settings?.stripeSettings);

    // Match the frontend expected structure
    res.json({
      stripePriceIds: {
        monthly: settings?.stripeSettings?.prices?.monthly || '',
        quarterly: settings?.stripeSettings?.prices?.quarterly || '',
        yearly: settings?.stripeSettings?.prices?.yearly || ''
      },
      stripePublishableKey: settings?.stripeSettings?.publishableKey || '',
      stripeSecretKey: settings?.stripeSettings?.secretKey || '',
      stripeWebhookSecret: settings?.stripeSettings?.webhookSecret || ''
    });
  } catch (error) {
    console.error('Error fetching prices:', error);
    res.status(500).json({ message: 'Error fetching subscription prices' });
  }
});

// Update all Stripe settings - Admin only
router.put('/settings', [auth, isAdmin], async (req, res) => {
  try {
    const {
      stripeSecretKey,
      stripePublishableKey,
      stripeWebhookSecret,
      stripePriceIds
    } = req.body;

    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings();
    }

    // Initialize or update stripeSettings
    if (!settings.stripeSettings) {
      settings.stripeSettings = {};
    }

    // Update all settings at once
    settings.stripeSettings = {
      secretKey: stripeSecretKey || settings.stripeSettings.secretKey || '',
      publishableKey: stripePublishableKey || settings.stripeSettings.publishableKey || '',
      webhookSecret: stripeWebhookSecret || settings.stripeSettings.webhookSecret || '',
      prices: {
        monthly: stripePriceIds?.monthly || settings.stripeSettings.prices?.monthly || '',
        quarterly: stripePriceIds?.quarterly || settings.stripeSettings.prices?.quarterly || '',
        yearly: stripePriceIds?.yearly || settings.stripeSettings.prices?.yearly || ''
      }
    };

    await settings.save();

    // Log for debugging
    console.log('Updated all Stripe settings:', {
      prices: settings.stripeSettings.prices,
      hasSecretKey: !!settings.stripeSettings.secretKey,
      hasPublishableKey: !!settings.stripeSettings.publishableKey,
      hasWebhookSecret: !!settings.stripeSettings.webhookSecret
    });

    res.json({
      message: 'Stripe settings updated successfully',
      stripePriceIds: {
        monthly: settings.stripeSettings.prices.monthly || '',
        quarterly: settings.stripeSettings.prices.quarterly || '',
        yearly: settings.stripeSettings.prices.yearly || ''
      },
      stripePublishableKey: settings.stripeSettings.publishableKey || '',
      stripeSecretKey: settings.stripeSettings.secretKey || '',
      stripeWebhookSecret: settings.stripeSettings.webhookSecret || ''
    });
  } catch (error) {
    console.error('Error updating Stripe settings:', error);
    res.status(500).json({ message: 'Error updating Stripe settings' });
  }
});

// Get all Stripe settings - Admin only
router.get('/settings', [auth, isAdmin], async (req, res) => {
  try {
    const settings = await Settings.findOne();
    
    // Log for debugging
    console.log('Retrieved Stripe settings');

    // Return all settings with proper structure
    res.json({
      stripePriceIds: {
        monthly: settings?.stripeSettings?.prices?.monthly || '',
        quarterly: settings?.stripeSettings?.prices?.quarterly || '',
        yearly: settings?.stripeSettings?.prices?.yearly || ''
      },
      stripePublishableKey: settings?.stripeSettings?.publishableKey || '',
      stripeSecretKey: settings?.stripeSettings?.secretKey || '',
      stripeWebhookSecret: settings?.stripeSettings?.webhookSecret || ''
    });
  } catch (error) {
    console.error('Error fetching Stripe settings:', error);
    res.status(500).json({ message: 'Error fetching Stripe settings' });
  }
});

// Get subscription prices for users
router.get('/subscription-options', auth, async (req, res) => {
  try {
    const settings = await Settings.findOne();
    const stripe = require('stripe')(settings.stripeSettings.secretKey);

    // Get price details from Stripe
    const prices = {
      monthly: settings?.stripeSettings?.prices?.monthly,
      quarterly: settings?.stripeSettings?.prices?.quarterly,
      yearly: settings?.stripeSettings?.prices?.yearly
    };

    // Log for debugging
    console.log('Fetching prices:', prices);

    // Fetch actual price data from Stripe
    const priceData = await Promise.all(
      Object.entries(prices)
        .filter(([_, priceId]) => priceId) // Only fetch for existing price IDs
        .map(async ([duration, priceId]) => {
          const price = await stripe.prices.retrieve(priceId);
          return {
            duration,
            priceId: price.id,
            amount: price.unit_amount / 100, // Convert cents to dollars
            currency: price.currency,
            interval: price.recurring.interval,
            intervalCount: price.recurring.interval_count
          };
        })
    );

    const response = {
      prices: priceData.reduce((acc, price) => {
        acc[price.duration] = {
          priceId: price.priceId,
          amount: price.amount,
          currency: price.currency,
          interval: price.interval,
          intervalCount: price.intervalCount
        };
        return acc;
      }, {})
    };

    // Log response for debugging
    console.log('Sending response:', response);

    res.json(response);

  } catch (error) {
    console.error('Error fetching subscription options:', error);
    res.status(500).json({ message: 'Error fetching subscription options' });
  }
});

// Cancel subscription endpoint (Admin only)
router.post('/cancel/:userId', [auth, isAdmin], async (req, res) => {
  try {
    console.log('Cancel subscription request for user:', req.params.userId);

    // Get settings and initialize Stripe
    const settings = await Settings.findOne();
    const stripe = require('stripe')(settings.stripeSettings.secretKey);

    // Find user
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.subscription?.stripe_subscription_id) {
      return res.status(400).json({ message: 'No active subscription found' });
    }

    // Cancel subscription in Stripe
    const subscription = await stripe.subscriptions.update(
      user.subscription.stripe_subscription_id,
      {
        cancel_at_period_end: true
      }
    );

    console.log('Subscription cancelled in Stripe:', subscription.id);

    // Update user model
    user.subscription = {
      status: 'canceled',
      plan: 'free',
      current_period_end: subscription.current_period_end,
      current_period_start: subscription.current_period_start,
      stripe_subscription_id: subscription.id,
      stripe_price_id: null,
      cancel_at_period_end: true,
      isPaid: false
    };

    await user.save();
    console.log('User subscription updated:', user.subscription);

    res.json({
      success: true,
      message: 'Subscription cancelled successfully',
      subscription: user.subscription
    });

  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(400).json({ 
      success: false,
      message: error.message 
    });
  }
});

// Get all users with subscription info - Admin only
router.get('/users/subscriptions', [auth, isAdmin], async (req, res) => {
  try {
    console.log('Fetching all users subscription info');

    // Get all users with subscription info
    const users = await User.find({}, {
      email: 1,
      subscription: 1,
      stripeCustomerId: 1,
      'profile.firstName': 1,
      'profile.lastName': 1
    });

    // Format the response
    const usersWithSubscriptions = users.map(user => ({
      userId: user._id,
      email: user.email,
      name: `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim(),
      subscription: {
        status: user.subscription?.status || 'free',
        plan: user.subscription?.plan || 'free',
        isPaid: user.subscription?.isPaid || false,
        current_period_end: user.subscription?.current_period_end,
        current_period_start: user.subscription?.current_period_start,
        stripe_subscription_id: user.subscription?.stripe_subscription_id,
        cancel_at_period_end: user.subscription?.cancel_at_period_end
      },
      stripeCustomerId: user.stripeCustomerId
    }));

    console.log(`Found ${usersWithSubscriptions.length} users`);

    res.json({
      success: true,
      users: usersWithSubscriptions
    });

  } catch (error) {
    console.error('Error fetching users subscriptions:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching users subscriptions'
    });
  }
});

// Get all transactions - Admin only
router.get('/transactions', [auth, isAdmin], async (req, res) => {
  try {
    console.log('Fetching all transactions');

    // Get Stripe settings
    const settings = await Settings.findOne();
    const stripe = require('stripe')(settings.stripeSettings.secretKey);

    // Get all invoices from Stripe
    const invoices = await stripe.invoices.list({
      limit: 100, // Adjust this number as needed
      expand: ['data.customer', 'data.subscription']
    });

    // Get all payment intents
    const paymentIntents = await stripe.paymentIntents.list({
      limit: 100, // Adjust this number as needed
      expand: ['data.customer']
    });

    // Format invoice data
    const transactions = await Promise.all(invoices.data.map(async (invoice) => {
      // Find user by Stripe customer ID
      const user = await User.findOne({ stripeCustomerId: invoice.customer.id });

      return {
        id: invoice.id,
        type: 'invoice',
        amount: invoice.amount_paid / 100, // Convert cents to dollars
        currency: invoice.currency,
        status: invoice.status, // 'paid', 'open', 'void', 'uncollectible'
        date: new Date(invoice.created * 1000),
        customer: {
          id: invoice.customer.id,
          email: invoice.customer.email,
          userId: user?._id,
          name: user ? `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() : 'Unknown'
        },
        subscription: {
          id: invoice.subscription?.id,
          status: invoice.subscription?.status,
          plan: invoice.lines.data[0]?.price?.nickname || 'Unknown plan'
        },
        payment_intent: invoice.payment_intent,
        hosted_invoice_url: invoice.hosted_invoice_url,
        pdf_url: invoice.invoice_pdf,
        failure_reason: invoice.last_finalization_error?.message
      };
    }));

    // Format payment intent data
    const payments = paymentIntents.data.map((payment) => ({
      id: payment.id,
      type: 'payment',
      amount: payment.amount / 100,
      currency: payment.currency,
      status: payment.status, // 'succeeded', 'processing', 'requires_payment_method', 'canceled'
      date: new Date(payment.created * 1000),
      customer: {
        id: payment.customer,
        email: payment.receipt_email
      },
      payment_method: payment.payment_method_types[0],
      failure_reason: payment.last_payment_error?.message
    }));

    // Combine and sort all transactions by date
    const allTransactions = [...transactions, ...payments].sort((a, b) => 
      b.date.getTime() - a.date.getTime()
    );

    // Get summary statistics
    const summary = {
      total_transactions: allTransactions.length,
      successful_payments: allTransactions.filter(t => 
        (t.type === 'invoice' && t.status === 'paid') || 
        (t.type === 'payment' && t.status === 'succeeded')
      ).length,
      failed_payments: allTransactions.filter(t => 
        (t.type === 'invoice' && ['void', 'uncollectible'].includes(t.status)) || 
        (t.type === 'payment' && ['canceled', 'requires_payment_method'].includes(t.status))
      ).length,
      total_amount: allTransactions
        .filter(t => t.status === 'paid' || t.status === 'succeeded')
        .reduce((sum, t) => sum + t.amount, 0)
    };

    res.json({
      success: true,
      summary,
      transactions: allTransactions
    });

  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching transactions'
    });
  }
});

// Update admin statistics endpoint to include jobs
router.get('/admin/statistics', [auth, isAdmin], async (req, res) => {
  try {
    console.log('Fetching admin statistics');

    // Get all users and jobs
    const [users, jobs] = await Promise.all([
      User.find({}),
      Job.find({}).sort({ createdAt: -1 })
    ]);

    // Calculate user statistics
    const userStats = {
      totalUsers: users.length,
      totalAdmins: users.filter(user => user.isAdmin).length,
      totalRegularUsers: users.filter(user => !user.isAdmin).length,
      recentUsers: users
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5)
        .map(user => ({
          id: user._id,
          email: user.email,
          name: `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim(),
          joinDate: user.createdAt
        }))
    };

    // Calculate job statistics
    const jobStats = {
      totalJobs: jobs.length,
      activeJobs: jobs.filter(job => job.status === 'active').length,
      urgentJobs: jobs.filter(job => job.isUrgent).length,
      jobsByStatus: {
        active: jobs.filter(j => j.status === 'active').length,
        closed: jobs.filter(j => j.status === 'closed').length,
        draft: jobs.filter(j => j.status === 'draft').length
      },
      recentJobs: jobs
        .slice(0, 5)
        .map(job => ({
          id: job._id,
          title: job.title,
          company: job.company,
          status: job.status,
          postedDate: job.createdAt
        }))
    };

    // Initialize transaction statistics
    let transactionStats = {
      totalTransactions: 0,
      successfulPayments: 0,
      failedPayments: 0,
      totalRevenue: 0,
      recentTransactions: [],
      monthlyRevenue: []
    };

    // Try to get Stripe transactions
    try {
      const settings = await Settings.findOne();
      if (settings?.stripeSettings?.secretKey) {
        const stripe = require('stripe')(settings.stripeSettings.secretKey);
        
        // Get both invoices and payment intents
        const [invoices, paymentIntents] = await Promise.all([
          stripe.invoices.list({ limit: 100, expand: ['data.customer'] }),
          stripe.paymentIntents.list({ limit: 100 })
        ]);

        // Calculate total revenue and transaction counts
        const paidInvoices = invoices.data.filter(inv => inv.status === 'paid');
        const failedInvoices = invoices.data.filter(inv => ['void', 'uncollectible'].includes(inv.status));
        
        // Calculate monthly revenue for the last 6 months
        const monthlyData = new Map();
        const now = new Date();
        for (let i = 0; i < 6; i++) {
          const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const monthKey = date.toISOString().slice(0, 7); // YYYY-MM format
          monthlyData.set(monthKey, 0);
        }

        // Add up revenue by month
        paidInvoices.forEach(invoice => {
          const date = new Date(invoice.created * 1000);
          const monthKey = date.toISOString().slice(0, 7);
          if (monthlyData.has(monthKey)) {
            monthlyData.set(monthKey, monthlyData.get(monthKey) + invoice.amount_paid / 100);
          }
        });

        // Format recent transactions
        const recentTransactions = invoices.data
          .slice(0, 5)
          .map(inv => ({
            id: inv.id,
            amount: inv.amount_paid / 100,
            status: inv.status,
            date: new Date(inv.created * 1000),
            customerEmail: inv.customer?.email || 'Unknown',
            description: inv.description || 'Subscription payment'
          }));

        // Update transaction statistics
        transactionStats = {
          totalTransactions: invoices.data.length,
          successfulPayments: paidInvoices.length,
          failedPayments: failedInvoices.length,
          totalRevenue: paidInvoices.reduce((sum, inv) => sum + (inv.amount_paid / 100), 0),
          recentTransactions,
          monthlyRevenue: Array.from(monthlyData.entries())
            .map(([month, revenue]) => ({ month, revenue }))
            .sort((a, b) => a.month.localeCompare(b.month))
        };
      }
    } catch (stripeError) {
      console.error('Error fetching Stripe data:', stripeError);
      // Continue with default values
    }

    // Send response with all statistics
    res.json({
      success: true,
      userStats,
      jobStats,
      transactionStats
    });

  } catch (error) {
    console.error('Error fetching admin statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching statistics',
      error: error.message
    });
  }
});

console.log('Subscription routes defined');

module.exports = router; 