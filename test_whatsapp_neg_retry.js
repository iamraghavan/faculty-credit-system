require('dotenv').config();
const { sendWhatsAppMessage } = require('./utils/whatsapp');

async function test(label, lang) {
    const phone = '919942502245';
    console.log(`\n--- Testing [${label}] with [${lang}] for ${phone} ---`);
    const params = {
        phone: phone,
        templateName: 'fcs_negative_credit_alert_v1_m',
        language: lang,
        textParams: [
            'Raghavan', '5', 'FAC001', 'CSE', 'Mobile Phone Usage', 'Admin', 'Observed in class', '95'
        ],
        buttonParams: ['690f46f676b006c978dd2de6']
    };
    const result = await sendWhatsAppMessage(params);
    console.log('Result:', JSON.stringify(result, null, 2));
}

async function run() {
    await test('NEG - EN', 'en');
    await test('NEG - EN_US', 'en_US');
    process.exit(0);
}

run();
