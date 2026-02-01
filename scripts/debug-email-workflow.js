const fs = require('fs');
const path = require('path');
const { generateRemarkPdf } = require('../utils/pdfGenerator');

(async () => {
    try {
        console.log('Testing PDF Generation...');
        const pdfBuffer = await generateRemarkPdf({
            title: 'Test Remark',
            points: -10,
            academicYear: '2025-26',
            notes: 'Test notes',
            facultyName: 'Test User',
            facultyId: 'FAC001',
            issuerName: 'Admin',
            date: '01 Feb 2026'
        });
        console.log('PDF Generated. Size:', pdfBuffer.length);

        console.log('Testing Email Template Read...');
        const templatePath = path.resolve(process.cwd(), 'email-templates', 'remark-notification.html');
        console.log('Reading from:', templatePath);

        if (fs.existsSync(templatePath)) {
            const content = fs.readFileSync(templatePath, 'utf8');
            console.log('Template read success. Length:', content.length);
        } else {
            console.error('CRITICAL: Template file not found at', templatePath);
        }

        console.log('Diagnostics passed.');
    } catch (err) {
        console.error('Debug script failed:', err);
    }
})();
