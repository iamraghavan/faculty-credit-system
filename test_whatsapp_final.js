require('dotenv').config();
const { sendWhatsAppMessage } = require('./utils/whatsapp');

async function testNegative(phone) {
    console.log(`\n--- Testing Negative Credit [fcs_negative_credit_alert_v1_m] for ${phone} ---`);
    const params = {
        phone: phone,
        templateName: 'fcs_negative_credit_alert_v1_m',
        language: 'en',
        textParams: [
            'Raghavan',             // 1
            '5',                    // 2
            'FAC001',               // 3
            'CSE',                  // 4
            'Mobile Phone Usage',   // 5
            'Admin',                // 6
            'Observed in class',    // 7
            '95'                    // 8
        ],
        buttonParams: ['690f46f676b006c978dd2de6']
    };
    const result = await sendWhatsAppMessage(params);
    console.log('Result:', JSON.stringify(result, null, 2));
}

async function testAppeal(phone) {
    console.log(`\n--- Testing Appeal Submission [fcs_appeal_submission_alert_v1] for ${phone} ---`);
    const params = {
        phone: phone,
        templateName: 'fcs_appeal_submission_alert_v1',
        language: 'en',
        textParams: [
            'Raghavan',             // 1
            'FAC001',               // 2
            'CSE',                  // 3
            '67b1234567890',        // 4 (Ticket ID)
            'Mobile Phone Usage',   // 5
            '5',                    // 6
            'I was using it for educational purpose.' // 7
        ],
        buttonParams: ['67b1234567890'] // 8 (mapped to {{1}} in button)
    };
    const result = await sendWhatsAppMessage(params);
    console.log('Result:', JSON.stringify(result, null, 2));
}

async function run() {
    const target = '919942502245';
    await testNegative(target);
    await testAppeal(target);
    process.exit(0);
}

run();
