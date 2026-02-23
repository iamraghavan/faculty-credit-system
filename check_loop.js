require('dotenv').config();
const ShortUrl = require('./Models/ShortUrl');
const { connectDB } = require('./config/db');

async function checkShortUrl(id) {
    try {
        await connectDB();
        console.log(`\n--- Checking Short URL ID: ${id} ---`);
        const result = await ShortUrl.findById(id);
        if (result) {
            console.log('Result:', JSON.stringify(result, null, 2));
        } else {
            console.log('NOT FOUND in DB.');
        }
    } catch (e) {
        console.error('Error:', e);
    } finally {
        process.exit(0);
    }
}

const id = process.argv[2] || '579270';
checkShortUrl(id);
