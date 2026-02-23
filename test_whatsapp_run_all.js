require('dotenv').config();
const { sendWhatsAppMessage } = require('./utils/whatsapp');

async function runTests() {
  const phone = '919942502245'; // The number you mentioned
  
  console.log('--- RUNNING FINAL WHATSAPP TESTS ---');

  // Test 1: Negative Credit Alert
  console.log('\n[1/2] Testing Negative Credit Alert (fcs_negative_credit_alert_v1_m)...');
  const negResult = await sendWhatsAppMessage({
    phone: phone,
    templateName: 'fcs_negative_credit_alert_v1_m',
    language: 'en',
    textParams: [
      "Dr. John Doe",                     // text1: Name
      "2",                                // text2: Points
      "FAC1024",                          // text3: ID
      "Computer Science Department",      // text4: Dept
      "Missed scheduled invigilation",    // text5: Activity
      "Academic Compliance Office",       // text6: Issuer
      "Late reporting without notice",    // text7: Reason
      "98"                                // text8: Balance
    ],
    buttonParams: ["67bb3f4e2c1d0"]       // buttonURL1: ID
  });
  console.log('Result:', JSON.stringify(negResult, null, 2));

  // Test 2: Appeal Submission Alert
  console.log('\n[2/2] Testing Appeal Submission Alert (fcs_appeal_submission_alert_v1)...');
  const appealResult = await sendWhatsAppMessage({
    phone: phone,
    templateName: 'fcs_appeal_submission_alert_v1',
    language: 'en',
    textParams: [
      "Dr. John Doe",                     // text1: Name
      "FAC1024",                          // text2: ID
      "Computer Science Department",      // text3: Dept
      "123234",                           // text4: Ticket ID
      "Missed scheduled invigilation",    // text5: Activity
      "2",                                // text6: Penalty
      "Requesting reconsideration as prior leave was approved" // text7: Reason
    ],
    buttonParams: ["123234"]              // buttonURL1: ID
  });
  console.log('Result:', JSON.stringify(appealResult, null, 2));

  console.log('\n--- TESTS COMPLETED ---');
  process.exit(0);
}

runTests();
