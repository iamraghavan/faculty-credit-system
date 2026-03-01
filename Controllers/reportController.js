const Credit = require('../Models/Credit');
const User = require('../Models/User');
const { createExcelReport, createPdfReport, createHtmlReport } = require('../utils/reportUtils');
const { createShortLink } = require('../utils/urlHelper');

/**
 * Get Report Data (JSON)
 * Used to populate frontend tables with filters
 */
async function getReportData(req, res, next) {
  try {
    const { level, id, academicYear, startDate, endDate, type, status } = req.query;

    let filter = {};
    if (academicYear) filter.academicYear = academicYear;
    if (type) filter.type = type;
    if (status) filter.status = status;

    let credits = await Credit.find(filter);

    // Apply Level Filtering
    if (level === 'department' && id) {
      credits = credits.filter(c => c.facultySnapshot?.department === id);
    } else if (level === 'faculty' && id) {
      credits = credits.filter(c => c.faculty === id);
    }

    // Date filtering
    if (startDate || endDate) {
      credits = credits.filter(c => {
        const d = new Date(c.createdAt);
        if (startDate && d < new Date(startDate)) return false;
        if (endDate && d > new Date(endDate)) return false;
        return true;
      });
    }

    res.json({
      success: true,
      count: credits.length,
      data: credits
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Download Report (PDF/Excel)
 */
async function downloadReport(req, res, next) {
  try {
    const { level, id, format, academicYear, startDate, endDate, type, status, share } = req.query;

    if (!['pdf', 'excel', 'html'].includes(format)) {
      return res.status(400).json({ success: false, message: 'Invalid format. Use pdf, excel or html.' });
    }

    // Reuse filter logic (simplified for buffer generation)
    let filter = {};
    if (academicYear) filter.academicYear = academicYear;
    if (type) filter.type = type;
    if (status) filter.status = status;

    let credits = await Credit.find(filter);

    if (level === 'department' && id) {
      credits = credits.filter(c => c.facultySnapshot?.department === id);
    } else if (level === 'faculty' && id) {
      credits = credits.filter(c => c.faculty === id);
    }

    if (startDate || endDate) {
      credits = credits.filter(c => {
        const d = new Date(c.createdAt);
        if (startDate && d < new Date(startDate)) return false;
        if (endDate && d > new Date(endDate)) return false;
        return true;
      });
    }

    if (credits.length === 0) {
      return res.status(404).json({ success: false, message: 'No data to report' });
    }

    const metadata = {
      level: level || 'College',
      title: `${(level || 'College').toUpperCase()} Credit Report ${id ? `- ${id}` : ''}`,
      date: new Date().toLocaleString(),
      generatedBy: req.user?.name || 'Administrative System'
    };

    // Shareable Link logic
    if (share === 'true') {
      const queryParams = new URLSearchParams(req.query);
      queryParams.delete('share');
      // Set default format to html for shareable links
      queryParams.set('format', 'html');
      
      // Pass the current token so the link is authorized (simple solution for now)
      const currentToken = req.headers.authorization?.split(' ')[1] || req.query.token;
      if (currentToken) queryParams.set('token', currentToken);
      
      const downloadUrl = `${req.protocol}://${req.get('host')}/api/v1/reports/download?${queryParams.toString()}`;
      const shortUrl = await createShortLink(downloadUrl);
      return res.json({ success: true, shareLink: shortUrl });
    }

    let buffer;
    let contentType;
    let ext = format === 'excel' ? 'xlsx' : (format === 'html' ? 'html' : 'pdf');

    if (format === 'excel') {
      buffer = createExcelReport(credits, metadata);
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else if (format === 'html') {
      // Helper to build download links for buttons
      const baseUrl = `${req.protocol}://${req.get('host')}/api/v1/reports/download`;
      const q = new URLSearchParams(req.query);
      
      // Preserve token in the download buttons
      const currentToken = req.headers.authorization?.split(' ')[1] || req.query.token;
      if (currentToken) q.set('token', currentToken);

      q.set('format', 'pdf');
      const pdfUrl = `${baseUrl}?${q.toString()}`;
      
      q.set('format', 'excel');
      const excelUrl = `${baseUrl}?${q.toString()}`;

      const html = createHtmlReport(credits, metadata, { pdf: pdfUrl, excel: excelUrl });
      return res.send(html);
    } else {
      buffer = await createPdfReport(credits, metadata);
      contentType = 'application/pdf';
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="FCS_Report_${level || 'Global'}_${Date.now()}.${ext}"`);
    res.send(buffer);

  } catch (err) {
    next(err);
  }
}

module.exports = { getReportData, downloadReport };
