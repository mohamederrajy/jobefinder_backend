import React, { useState, useEffect } from 'react';

const StripeSettings = () => {
  const [settings, setSettings] = useState({
    stripeSecretKey: '',
    stripePublishableKey: '',
    stripeWebhookSecret: '',
    stripePriceId: ''
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/admin/stripe-settings', {
        headers: {
          'x-auth-token': localStorage.getItem('token')
        }
      });
      const data = await response.json();
      setSettings(data);
    } catch (error) {
      console.error('Error fetching settings:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/admin/stripe-settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': localStorage.getItem('token')
        },
        body: JSON.stringify(settings)
      });
      const data = await response.json();
      alert(data.message);
    } catch (error) {
      console.error('Error updating settings:', error);
      alert('Error updating settings');
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4">Stripe Settings</h2>
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="block mb-2">Secret Key</label>
          <input
            type="password"
            value={settings.stripeSecretKey}
            onChange={(e) => setSettings({...settings, stripeSecretKey: e.target.value})}
            className="w-full p-2 border rounded"
          />
        </div>
        <div className="mb-4">
          <label className="block mb-2">Publishable Key</label>
          <input
            type="text"
            value={settings.stripePublishableKey}
            onChange={(e) => setSettings({...settings, stripePublishableKey: e.target.value})}
            className="w-full p-2 border rounded"
          />
        </div>
        <div className="mb-4">
          <label className="block mb-2">Webhook Secret</label>
          <input
            type="password"
            value={settings.stripeWebhookSecret}
            onChange={(e) => setSettings({...settings, stripeWebhookSecret: e.target.value})}
            className="w-full p-2 border rounded"
          />
        </div>
        <div className="mb-4">
          <label className="block mb-2">Price ID</label>
          <input
            type="text"
            value={settings.stripePriceId}
            onChange={(e) => setSettings({...settings, stripePriceId: e.target.value})}
            className="w-full p-2 border rounded"
          />
        </div>
        <button
          type="submit"
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Save Settings
        </button>
      </form>
    </div>
  );
};

export default StripeSettings; 