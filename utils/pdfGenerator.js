const PDFDocument = require('pdfkit');

/**
 * Generate a PDF for a Remark Notification
 * @param {Object} data - { title, points, academicYear, notes, facultyName, facultyId, issuerName, date }
 * @returns {Promise<Buffer>}
 */
function generateRemarkPdf(data) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            const buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const pdfData = Buffer.concat(buffers);
                resolve(pdfData);
            });

            // --- Header ---
            doc
                .fillColor('#001b70')
                .fontSize(20)
                .text('E.G.S. Pillay Group of Institutions', { align: 'center' })
                .fontSize(10)
                .text('Nagapattinam - 611002', { align: 'center' })
                .moveDown();

            doc
                .moveTo(50, doc.y)
                .lineTo(550, doc.y)
                .strokeColor('#aaaaaa')
                .stroke();

            doc.moveDown(2);

            // --- Title ---
            doc
                .fillColor('#333333')
                .fontSize(16)
                .font('Helvetica-Bold')
                .text('OFFICIAL REMARK NOTIFICATION', { align: 'center' });

            doc.moveDown(1.5);

            // --- Meta Info ---
            doc.fontSize(12).font('Helvetica');
            const leftX = 50;
            const rightX = 300;
            const startY = doc.y;

            // Faculty Details
            doc.text(`Faculty Name: ${data.facultyName}`, leftX, startY);
            doc.text(`Faculty ID: ${data.facultyId || 'N/A'}`, rightX, startY);
            doc.moveDown(0.5);
            doc.text(`Date Issued: ${data.date}`, leftX);
            doc.text(`Issued By: ${data.issuerName || 'Administration'}`, rightX);

            doc.moveDown(2);

            // --- Remark Box ---
            const boxTop = doc.y;
            doc
                .rect(50, boxTop, 495, 120) // approx height
                .fillAndStroke('#f9fafb', '#e2e8f0');

            doc.fillColor('#000000');

            let textY = boxTop + 20;

            // Remark Title
            doc.fontSize(11).font('Helvetica-Bold').text('Subject / Title:', 70, textY);
            doc.font('Helvetica').text(data.title, 200, textY);
            textY += 25;

            // Points
            doc.font('Helvetica-Bold').text('Credit Points Impact:', 70, textY);
            doc.fillColor('#af005f').font('Helvetica-Bold').text(`${data.points}`, 200, textY);
            doc.fillColor('#000000');
            textY += 25;

            // Academic Year
            doc.font('Helvetica-Bold').text('Academic Year:', 70, textY);
            doc.font('Helvetica').text(data.academicYear, 200, textY);

            doc.moveDown(5); // Move cursor below the box

            // --- Notes Section ---
            doc.y = boxTop + 140;
            doc.fontSize(14).font('Helvetica-Bold').text('Detailed Notes & Comments');
            doc.moveDown(0.5);
            doc
                .fontSize(11)
                .font('Helvetica')
                .text(data.notes || 'No additional notes provided.', {
                    align: 'justify',
                    width: 495
                });

            doc.moveDown(4);

            // --- Footer / Disclaimer ---
            doc
                .fontSize(10)
                .fillColor('#666666')
                .text('This is a computer-generated document. No signature is required.', { align: 'center' });

            doc.end();

        } catch (err) {
            reject(err);
        }
    });
}

module.exports = { generateRemarkPdf };
