require('dotenv').config();
const { sendWhatsAppMessage } = require('./utils/whatsapp');

async function test(label, buttonValue) {
    const testPhone = '916382087377'; 
    console.log(`\n--- Testing [${label}] for ${testPhone} ---`);

    const params = {
        phone: testPhone,
        templateName: 'fcs_negative_credit_alert_v1',
        language: 'en',
        textParams: [
            'Test Faculty', // 1
            '5',           // 2
            'TEST001',      // 3
            'CSE',          // 4
            'Test Activity',// 5
            'Admin Tester', // 6
            'Manual API Test',// 7
            '95'            // 8
        ],
        buttonParams: [buttonValue]
    };

    const result = await sendWhatsAppMessage(params);
    console.log(`[${label}] Result:`, JSON.stringify(result, null, 2));
}

async function runTests() {
    // Test 1: Only the ID
    await test('ID ONLY', '690f46f676b006c978dd2de6');
    
    // Test 2: Full URL
    await test('FULL URL', 'https://fcs.egspgroup.in/u/credits?id=690f46f676b006c978dd2de6');

    process.exit(0);
}

runTests();
