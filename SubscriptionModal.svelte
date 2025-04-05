const handleSubmit = async () => {
  try {
    console.log('Making subscription request');
    const response = await fetch('/api/subscriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': userToken // Make sure this exists
      },
      body: JSON.stringify({}) // Add any required data
    });

    console.log('Response status:', response.status);
    const data = await response.json();
    console.log('Response data:', data);
  } catch (error) {
    console.error('Subscription error:', error);
  }
}; 