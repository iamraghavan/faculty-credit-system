const axios = require('axios');

async function testWhatsApp() {
    const url = 'https://api.tryowbot.com/sender';

    const payload = {
        "token": "0ifvM74inCFqoFm9Hqi2Gx4taWzAY6VZLwvuo6ur7a7f4030",
        "phone": "919942502245",
        "template_name": "egspgoi_faculty_credit_system_otp_verify",
        "template_language": "en_US",

        // Body variables as requested
        "text1": "creating",
        "text2": "GoPay",
        "text3": "EGSPGOI Faculty Portal", // merchant_name?
        "text4": "482913", // OTP in body?
        "text5": "GoPay",

        // Critical for Auth templates with Copy Code button
        "buttonURL1": "482913"
    };

    try {
        console.log('Sending WhatsApp request...');
        console.log('URL:', url);
        console.log('Payload:', JSON.stringify(payload, null, 2));

        const response = await axios.post(url, payload, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log('\n✅ Success!');
        console.log('Status:', response.status);
        console.log('Data:', response.data);

    } catch (error) {
        console.error('\n❌ Error sending message:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        } else {
            console.error('Message:', error.message);
        }
    }
}

testWhatsApp();
