const PDFDocument = require('pdfkit');
const XLSX = require('xlsx');

/**
 * Generate Excel Report Buffer
 * @param {Array} data - Array of credit objects
 * @param {Object} metadata - { level, title, generatedAt }
 * @returns {Buffer}
 */
function createExcelReport(data, metadata) {
  const wb = XLSX.utils.book_new();

  // 1. Summary Sheet
  const summaryData = [
    ['Report Title', metadata.title],
    ['Level', metadata.level.toUpperCase()],
    ['Generated At', metadata.date],
    ['Total Records', data.length],
    ['Total Points', data.reduce((sum, item) => sum + (item.points || 0), 0)],
    [],
    ['Note', 'This report is computer generated from the Faculty Credit System.']
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  // 2. Details Sheet
  const details = data.map(item => ({
    'Faculty ID': item.facultySnapshot?.facultyID || 'N/A',
    'Faculty Name': item.facultySnapshot?.name || 'N/A',
    'Department': item.facultySnapshot?.department || 'N/A',
    'Type': item.type?.toUpperCase() || 'N/A',
    'Title': item.title || 'N/A',
    'Points': item.points || 0,
    'Academic Year': item.academicYear || 'N/A',
    'Status': item.status || 'N/A',
    'Date': new Date(item.createdAt).toLocaleDateString()
  }));
  const detailsWs = XLSX.utils.json_to_sheet(details);
  XLSX.utils.book_append_sheet(wb, detailsWs, 'Details');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Generate PDF Report Buffer
 * @param {Array} data - Array of credit objects
 * @param {Object} metadata - { level, title, date }
 * @returns {Promise<Buffer>}
 */
function createPdfReport(data, metadata) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const buffers = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      // --- Header ---
      doc
        .fillColor('#001b70')
        .fontSize(20)
        .text('Faculty Credit System', { align: 'center' })
        .fontSize(10)
        .text('Detailed Credit Report', { align: 'center' })
        .moveDown();

      doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#aaaaaa').stroke().moveDown(1.5);

      // --- Meta ---
      doc.fillColor('#333333').fontSize(14).font('Helvetica-Bold').text(metadata.title, { align: 'left' });
      doc.fontSize(10).font('Helvetica').text(`Level: ${metadata.level.toUpperCase()} | Date: ${metadata.date}`, { align: 'left' });
      doc.moveDown();

      // --- Summary Stats ---
      const totalPoints = data.reduce((sum, item) => sum + (item.points || 0), 0);
      const positiveCount = data.filter(c => c.type === 'positive').length;
      const negativeCount = data.filter(c => c.type === 'negative').length;

      doc.fontSize(12).font('Helvetica-Bold').text('Overview Summary');
      doc.fontSize(10).font('Helvetica')
         .text(`• Total Activities: ${data.length}`)
         .text(`• Cumulative Points: ${totalPoints}`)
         .text(`• Positive Credits: ${positiveCount}`)
         .text(`• Negative Credits: ${negativeCount}`)
         .moveDown(2);

      // --- Table Header ---
      doc.fontSize(10).font('Helvetica-Bold');
      const startY = doc.y;
      doc.text('Date', 50, startY);
      doc.text('Faculty/ID', 120, startY);
      doc.text('Activity Title', 250, startY);
      doc.text('Type', 450, startY);
      doc.text('Points', 500, startY);
      
      doc.moveTo(50, doc.y + 12).lineTo(550, doc.y + 12).strokeColor('#eeeeee').stroke().moveDown(1);

      // --- Table Rows ---
      doc.fontSize(9).font('Helvetica');
      data.forEach((item, i) => {
        // Simple page breaking
        if (doc.y > 700) doc.addPage();
        
        const rowY = doc.y;
        doc.text(new Date(item.createdAt).toLocaleDateString(), 50, rowY);
        doc.text(`${item.facultySnapshot?.name || 'N/A'}\n(${item.facultySnapshot?.facultyID || 'N/A'})`, 120, rowY, { width: 120 });
        doc.text(item.title || 'N/A', 250, rowY, { width: 180 });
        doc.text(item.type?.toUpperCase() || 'N/A', 450, rowY);
        doc.text(String(item.points || 0), 500, rowY);
        
        doc.moveDown(1.5);
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { createExcelReport, createPdfReport };
