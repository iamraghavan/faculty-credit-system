const axios = require('axios');
require('dotenv').config();

// TO TEST: Run with ADMIN_TOKEN="..." node test_broadcast_api.js
const token = process.env.ADMIN_TOKEN;
const API_URL = process.env.APP_URL || 'http://localhost:8000';

async function testBroadcast() {
  if (!token) {
    console.error('❌ Error: ADMIN_TOKEN environment variable is required.');
    console.log('Usage: ADMIN_TOKEN="your_jwt_here" node test_broadcast_api.js');
    return;
  }

  console.log(`--- Testing Broadcast Notification to ${API_URL} ---`);

  const payload = {
    title: 'Emergency Maintenance Alert',
    body: 'The Faculty Credit System will be undergoing brief maintenance at 11:00 PM tonight. Please save your work.',
    url: 'https://fcs.egspgroup.in/u/portal/dashboard',
    icon: '/icons/broadcast.png'
  };

  try {
    const response = await axios.post(`${API_URL}/api/v1/notifications/broadcast`, payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('\n✅ Success!');
    console.log('Status:', response.status);
    console.log('Data:', JSON.stringify(response.data, null, 2));

  } catch (error) {
    console.error('\n❌ Broadcast Test Failed:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error('Message:', error.message);
    }
  }
}

testBroadcast();
