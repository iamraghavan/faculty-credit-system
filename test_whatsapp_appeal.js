require('dotenv').config();
const { sendWhatsAppMessage } = require('./utils/whatsapp');

async function appealTest() {
    console.log('--- WhatsApp Appeal Submission Sync Test ---');
    console.log('Testing Template: fcs_appeal_submission_alert_v1');
    console.log('Testing Phone: 9942502245 (10-digit, utility will add 91)');

    const result = await sendWhatsAppMessage({
        phone: '9942502245',
        templateName: 'fcs_appeal_submission_alert_v1',
        language: 'en',
        textParams: [
            'Sanjay',                            // 1. Faculty Name
            'FAC1024',                          // 2. Faculty ID
            'Mechanical Engineering',           // 3. Department
            'TICKET-7890',                      // 4. Ticket ID (Credit ID)
            'In-house Seminar Presentation',     // 5. Activity Name
            '2',                                // 6. Negative Credits
            'The seminar was approved by HOD but records showed absent.' // 7. Appeal Reason
        ],
        buttonParams: ['690f46f676b006c978dd2de6'] // 1. Button ID (Button 1 dynamic URL)
    });

    console.log('\nAppeal Test Result:', JSON.stringify(result, null, 2));

    if (result.success && result.data.status === 'success') {
        console.log('\n✅ SUCCESS: Appeal notification accepted by the API!');
    } else {
        console.log('\n❌ FAILED: Check template name or parameters.');
    }
}

appealTest();
