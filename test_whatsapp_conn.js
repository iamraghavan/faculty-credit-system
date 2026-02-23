require('dotenv').config();
const { sendWhatsAppMessage } = require('./utils/whatsapp');

async function testConnection() {
    const testPhone = '916382087377'; 
    console.log(`\n--- Testing OTP Template for ${testPhone} ---`);

    const params = {
        phone: testPhone,
        templateName: 'egspgoi_faculty_credit_system_otp_verify',
        language: 'en_US',
        textParams: ['creating', 'Faculty Portal', 'EGSPGOI', '123456', 'Faculty Portal'],
        buttonParams: ['123456']
    };

    const result = await sendWhatsAppMessage(params);
    console.log('OTP Result:', JSON.stringify(result, null, 2));
    process.exit(0);
}

testConnection();
