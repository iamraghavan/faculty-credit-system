const jwt = require('jsonwebtoken');
const Credit = require('../Models/Credit');
const User = require('../Models/User');
const { createExcelReport, createPdfReport, createHtmlReport } = require('../utils/reportUtils');
const { createShortLink } = require('../utils/urlHelper');
const { createExportVerification } = require('../utils/exportVerification');

/**
 * Get Report Data (JSON)
 * Used to populate frontend tables with filters
 */
async function getReportData(req, res, next) {
  try {
    const { level, id, academicYear, startDate, endDate, type, status, view = 'transactions', sortBy = 'total', order = 'desc' } = req.query;

    let filter = {};
    if (academicYear && academicYear !== 'all') filter.academicYear = academicYear;
    if (type && type !== 'all') filter.type = type;
    if (status && status !== 'all') filter.status = status;

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

    if (view === 'ranking') {
      // Aggregate by faculty
      const facultyMap = {};
      credits.forEach(c => {
        const fId = c.faculty;
        if (!facultyMap[fId]) {
          facultyMap[fId] = {
            faculty: fId,
            facultyID: c.facultySnapshot?.facultyID || 'N/A',
            name: c.facultySnapshot?.name || 'Unknown',
            department: c.facultySnapshot?.department || 'N/A',
            college: c.facultySnapshot?.college || 'N/A',
            positive: 0,
            negative: 0,
            total: 0,
            count: 0
          };
        }
        const pts = Number(c.points) || 0;
        if (c.type === 'positive') facultyMap[fId].positive += pts;
        else if (c.type === 'negative') facultyMap[fId].negative += Math.abs(pts);
        
        facultyMap[fId].total += pts;
        facultyMap[fId].count += 1;
      });

      let ranking = Object.values(facultyMap);

      // Sorting
      ranking.sort((a, b) => {
        const valA = a[sortBy] || 0;
        const valB = b[sortBy] || 0;
        return order === 'asc' ? valA - valB : valB - valA;
      });

      return res.json({
        success: true,
        count: ranking.length,
        view: 'ranking',
        data: ranking
      });
    }

    // Default: Transactions view
    res.json({
      success: true,
      count: credits.length,
      view: 'transactions',
      data: credits
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Report share passes (SEC-04).
// A share link used to contain the admin's own login token. It now carries a
// separate signed pass that only opens the one report (with the filters that
// were chosen), is read-only, expires, and is signed with EXPORT_SIGNING_SECRET
// (never the login secret), so it can never be used to log in.
// ---------------------------------------------------------------------------
const SHARE_PURPOSE = 'report-share';
const REPORT_QUERY_KEYS = ['level', 'id', 'academicYear', 'startDate', 'endDate', 'type', 'status', 'view', 'sortBy', 'order'];

function shareSecret() {
  const secret = process.env.EXPORT_SIGNING_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    const error = new Error('Report sharing is not configured (EXPORT_SIGNING_SECRET must contain at least 32 bytes).');
    error.status = 503;
    throw error;
  }
  return secret;
}

function pickReportQuery(query) {
  return Object.fromEntries(REPORT_QUERY_KEYS.filter((k) => query[k] !== undefined && query[k] !== '').map((k) => [k, String(query[k])]));
}

function createSharePass(query, user, hours) {
  return jwt.sign(
    { purpose: SHARE_PURPOSE, q: pickReportQuery(query), by: String(user?._id || '') },
    shareSecret(),
    { expiresIn: `${hours}h`, algorithm: 'HS256' },
  );
}

function readSharePass(pass) {
  const payload = jwt.verify(String(pass || ''), shareSecret(), { algorithms: ['HS256'] });
  if (payload.purpose !== SHARE_PURPOSE || !payload.q) throw new Error('Not a report share pass');
  return payload;
}

function sharedReportUrl(req, pass, format) {
  return `${req.protocol}://${req.get('host')}/api/v1/reports/shared/${encodeURIComponent(pass)}?format=${format}`;
}

/**
 * Download Report (PDF/Excel/HTML) for a logged-in user with report.export.
 * With share=true it returns a short link to a read-only shared copy instead.
 */
async function downloadReport(req, res, next) {
  try {
    const { format, share } = req.query;
    if (!['pdf', 'excel', 'html'].includes(format)) {
      return res.status(400).json({ success: false, message: 'Invalid format. Use pdf, excel or html.' });
    }
    if (share === 'true') {
      const hours = Math.min(720, Math.max(1, Number(process.env.REPORT_SHARE_TTL_HOURS) || 168));
      const pass = createSharePass(req.query, req.user, hours);
      const shortUrl = await createShortLink(sharedReportUrl(req, pass, 'html'));
      return res.json({ success: true, shareLink: shortUrl, expiresInHours: hours });
    }
    // HTML view buttons (PDF/Excel) use a short-lived pass instead of the login token.
    const buttonPass = format === 'html' ? createSharePass(req.query, req.user, 1) : null;
    return await sendReport(req, res, { ...pickReportQuery(req.query), format }, req.user?.name, buttonPass);
  } catch (err) {
    next(err);
  }
}

/**
 * Public, read-only view of a shared report: GET /api/v1/reports/shared/:pass?format=html|pdf|excel
 */
async function downloadSharedReport(req, res, next) {
  try {
    const format = req.query.format || 'html';
    if (!['pdf', 'excel', 'html'].includes(format)) {
      return res.status(400).json({ success: false, message: 'Invalid format. Use pdf, excel or html.' });
    }
    let payload;
    try {
      payload = readSharePass(req.params.pass);
    } catch (error) {
      if (error.status === 503) throw error;
      return res.status(401).json({ success: false, message: 'This report link is invalid or has expired.' });
    }
    return await sendReport(req, res, { ...payload.q, format }, 'Shared report link', req.params.pass);
  } catch (err) {
    next(err);
  }
}

async function sendReport(req, res, query, generatedBy, buttonPass) {
  {
    const { level, id, format, academicYear, startDate, endDate, type, status, view = 'transactions', sortBy = 'total', order = 'desc' } = query;

    // Reuse filter logic
    let filter = {};
    if (academicYear && academicYear !== 'all') filter.academicYear = academicYear;
    if (type && type !== 'all') filter.type = type;
    if (status && status !== 'all') filter.status = status;

    let data = await Credit.find(filter);

    if (level === 'department' && id) {
      data = data.filter(c => c.facultySnapshot?.department === id);
    } else if (level === 'faculty' && id) {
      data = data.filter(c => c.faculty === id);
    }

    if (startDate || endDate) {
      data = data.filter(c => {
        const d = new Date(c.createdAt);
        if (startDate && d < new Date(startDate)) return false;
        if (endDate && d > new Date(endDate)) return false;
        return true;
      });
    }

    if (view === 'ranking') {
      const facultyMap = {};
      data.forEach(c => {
        const fId = c.faculty;
        if (!facultyMap[fId]) {
          facultyMap[fId] = {
            faculty: fId,
            facultyID: c.facultySnapshot?.facultyID || 'N/A',
            name: c.facultySnapshot?.name || 'Unknown',
            department: c.facultySnapshot?.department || 'N/A',
            college: c.facultySnapshot?.college || 'N/A',
            positive: 0,
            negative: 0,
            total: 0,
            count: 0
          };
        }
        const pts = Number(c.points) || 0;
        if (pts > 0) facultyMap[fId].positive += pts;
        else facultyMap[fId].negative += Math.abs(pts);
        facultyMap[fId].total += pts;
        facultyMap[fId].count += 1;
      });
      data = Object.values(facultyMap);
      data.sort((a, b) => {
        const valA = a[sortBy] || 0;
        const valB = b[sortBy] || 0;
        return order === 'asc' ? valA - valB : valB - valA;
      });
    }

    if (data.length === 0) {
      return res.status(404).json({ success: false, message: 'No data to report' });
    }

    const metadata = {
      level: level || 'College',
      title: `${(level || 'College').toUpperCase()} Credit Report ${id ? `- ${id}` : ''}`,
      date: new Date().toLocaleString(),
      generatedBy: generatedBy || 'Administrative System'
    };

    const verificationTotals = view === 'ranking'
      ? {
          faculty: data.length,
          positive: data.reduce((sum, item) => sum + (Number(item.positive) || 0), 0),
          negative: data.reduce((sum, item) => sum + (Number(item.negative) || 0), 0),
          net: data.reduce((sum, item) => sum + (Number(item.total) || 0), 0),
        }
      : {
          records: data.length,
          positive: data.filter(item => item.type === 'positive').reduce((sum, item) => sum + Math.abs(Number(item.points) || 0), 0),
          negative: data.filter(item => item.type === 'negative').reduce((sum, item) => sum + Math.abs(Number(item.points) || 0), 0),
        };

    let buffer;
    let contentType;
    let ext = format === 'excel' ? 'xlsx' : (format === 'html' ? 'html' : 'pdf');

    const verification = format === 'html' ? null : await createExportVerification({
      documentType: view === 'ranking' ? 'faculty_credit_ranking_report' : 'faculty_credit_transaction_report',
      subject: { scope: metadata.level, scopeId: id || null },
      totals: verificationTotals,
      content: { data, metadata, view },
    });

    if (format === 'excel') {
      buffer = await createExcelReport(data, metadata, view, verification);
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else if (format === 'html') {
      // Download buttons use the report pass (never the login token).
      const pdfUrl = buttonPass ? sharedReportUrl(req, buttonPass, 'pdf') : '#';
      const excelUrl = buttonPass ? sharedReportUrl(req, buttonPass, 'excel') : '#';

      const html = createHtmlReport(data, metadata, { pdf: pdfUrl, excel: excelUrl }, view);
      res.setHeader('Referrer-Policy', 'no-referrer');
      return res.send(html);
    } else {
      buffer = await createPdfReport(data, metadata, view, verification);
      contentType = 'application/pdf';
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="FCS_Report_${level || 'Global'}_${Date.now()}.${ext}"`);
    if (verification) {
      res.setHeader('X-FCS-Document-ID', verification.documentId);
      res.setHeader('X-FCS-Content-SHA256', verification.contentHash);
    }
    return res.send(buffer);
  }
}

module.exports = { getReportData, downloadReport, downloadSharedReport };
