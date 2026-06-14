require('dotenv').config();
const { sendFcmNotification } = require('./utils/firebase');

async function testFcm() {
  const token = 'csXwxQxcTv-kePdkFSXQAT:APA91bE5W__5x2EXU4R5ffMxfpZf9MokeV-YkKH227Bqkz6_0MCtgeP9RbhFzKRfkzXuZCZaE5i-USfl9sbdt6Kd__iltDL_HKSdxsr5QSIB1tqclom-nnU';
  
  console.log('Sending test push notification to:', token);
  
  try {
    const result = await sendFcmNotification(token, {
      title: 'Success!',
      body: 'Your Firebase Push Notifications are working correctly!',
      data: {
        type: 'test',
        timestamp: new Date().toISOString()
      }
    });
    console.log('Result:', result);
  } catch (err) {
    console.error('Error:', err);
  }
  process.exit(0);
}

testFcm();
