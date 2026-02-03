const axios = require('axios');

// Default config from env or fallback to user provided defaults for now
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || 'https://api.tryowbot.com/sender';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '0ifvM74inCFqoFm9Hqi2Gx4taWzAY6VZLwvuo6ur7a7f4030';

/**
 * Send WhatsApp Message via TryOwBot
 * @param {Object} params
 * @param {string} params.phone - Recipient phone number (with country code, e.g., '919942502245')
 * @param {string} params.templateName - Name of the template (e.g., 'egspgoi_faculty_credit_system_otp_verify')
 * @param {string[]} params.textParams - Array of text parameters [text1, text2, text3...]
 * @param {string[]} [params.buttonParams] - Array of button url parameters [buttonURL1...]
 * @param {string} [params.language='en_US'] - Template language
 */
async function sendWhatsAppMessage({ phone, templateName, textParams = [], buttonParams = [], language = 'en_US' }) {
    try {
        const payload = {
            token: WHATSAPP_TOKEN,
            phone: phone,
            template_name: templateName,
            template_language: language,
        };

        // Map textParams array to text1, text2, etc.
        textParams.forEach((text, index) => {
            payload[`text${index + 1}`] = text;
        });

        // Map buttonParams array to buttonURL1, buttonURL2, etc.
        buttonParams.forEach((btnVal, index) => {
            payload[`buttonURL${index + 1}`] = btnVal;
        });

        console.log(`Sending WhatsApp to ${phone} using template ${templateName}`);

        const response = await axios.post(WHATSAPP_API_URL, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        return { success: true, data: response.data };

    } catch (error) {
        console.error('WhatsApp Send Error:', error.response ? error.response.data : error.message);
        // Do not throw, return success: false to avoid breaking main flow
        return { success: false, error: error.message };
    }
}

module.exports = { sendWhatsAppMessage };
