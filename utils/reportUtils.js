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

/**
 * Generate HTML Report (Landing Page)
 * @param {Array} data - Array of credit objects
 * @param {Object} metadata - { level, title, date }
 * @param {Object} links - { pdf, excel }
 * @returns {string} - HTML string
 */
function createHtmlReport(data, metadata, links) {
  const rows = data.map(item => `
    <tr>
      <td>${new Date(item.createdAt).toLocaleDateString()}</td>
      <td>${item.facultySnapshot?.name || 'N/A'}<br><small>${item.facultySnapshot?.facultyID || 'N/A'}</small></td>
      <td>${item.title || 'N/A'}</td>
      <td class="type-${item.type}">${item.type?.toUpperCase() || 'N/A'}</td>
      <td><strong>${item.points || 0}</strong></td>
      <td><span class="status-${item.status}">${item.status?.toUpperCase() || 'N/A'}</span></td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${metadata.title}</title>
      <style>
        body { font-family: 'Inter', system-ui, -apple-system, sans-serif; line-height: 1.5; color: #1a202c; background: #f7fafc; margin: 0; padding: 2rem; }
        .container { max-width: 1000px; margin: 0 auto; background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
        header { border-bottom: 2px solid #edf2f7; margin-bottom: 2rem; padding-bottom: 1rem; display: flex; justify-content: space-between; align-items: flex-end; }
        h1 { margin: 0; color: #2d3748; font-size: 1.5rem; }
        .meta { color: #718096; font-size: 0.875rem; }
        .actions { display: flex; gap: 0.75rem; margin-bottom: 1.5rem; }
        .btn { padding: 0.5rem 1rem; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 0.875rem; transition: all 0.2s; border: 1px solid transparent; }
        .btn-pdf { background: #e53e3e; color: white; }
        .btn-pdf:hover { background: #c53030; }
        .btn-excel { background: #38a169; color: white; }
        .btn-excel:hover { background: #2f855a; }
        table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
        th { text-align: left; background: #edf2f7; padding: 0.75rem; font-size: 0.875rem; text-transform: uppercase; color: #4a5568; }
        td { padding: 10px; border-bottom: 1px solid #edf2f7; font-size: 0.9375rem; }
        .type-positive { color: #38a169; font-weight: bold; }
        .type-negative { color: #e53e3e; font-weight: bold; }
        .status-approved { background: #c6f6d5; color: #22543d; padding: 2px 8px; border-radius: 9999px; font-size: 0.75rem; }
        .status-pending { background: #feebc8; color: #744210; padding: 2px 8px; border-radius: 9999px; font-size: 0.75rem; }
        footer { margin-top: 2rem; text-align: center; color: #a0aec0; font-size: 0.75rem; }
        @media (max-width: 640px) { body { padding: 1rem; } .container { padding: 1rem; } header { flex-direction: column; align-items: flex-start; gap: 1rem; } }
      </style>
    </head>
    <body>
      <div class="container">
        <header>
          <div>
            <h1>${metadata.title}</h1>
            <div class="meta">Level: ${metadata.level} | Generated: ${metadata.date}</div>
          </div>
          <div class="actions">
            <a href="${links.pdf}" class="btn btn-pdf">Download PDF</a>
            <a href="${links.excel}" class="btn btn-excel">Download Excel</a>
          </div>
        </header>
        
        <div style="overflow-x: auto;">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Faculty</th>
                <th>Activity</th>
                <th>Type</th>
                <th>Pts</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>

        <footer>
          This is a live report generated from the Faculty Credit System. 
          The data shown is current as of the time of generation.
        </footer>
      </div>
    </body>
    </html>
  `;
}

module.exports = { createExcelReport, createPdfReport, createHtmlReport };
