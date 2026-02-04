require('dotenv').config();
const { createMaskedUrl, createShortLink } = require('./utils/urlHelper');
const { connectDB } = require('./config/db');

async function test() {
    try {
        await connectDB();
        console.log('Connected to DB');

        const rawUrl = 'https://cdn.jsdelivr.net/gh/test/file.pdf';
        console.log('Testing createMaskedUrl with:', rawUrl);

        const masked = await createMaskedUrl(rawUrl, 'application/pdf');
        console.log('Masked URL Result:', masked);

        const short = await createShortLink(masked);
        console.log('Short URL Result:', short);

        if (masked.includes('/cdn/assets/v1/')) {
            console.log('SUCCESS: URL is masked correctly.');
        } else {
            console.log('FAILURE: URL is not masked.');
        }

        process.exit(0);
    } catch (err) {
        console.error('Test Failed:', err);
        process.exit(1);
    }
}

test();
