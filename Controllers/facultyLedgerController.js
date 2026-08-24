const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const crypto = require('crypto');
const path = require('path');
const Credit = require('../Models/Credit');
const User = require('../Models/User');
const { createExportVerification, addExcelVerificationSheet, addPdfVerification } = require('../utils/exportVerification');

function parseDateRange(startDate, endDate) {
  const start = startDate ? new Date(`${startDate}T00:00:00.000Z`) : null;
  const end = endDate ? new Date(`${endDate}T23:59:59.999Z`) : null;
  if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime()))) {
    const error = new Error('Invalid date range. Use YYYY-MM-DD.');
    error.status = 400;
    throw error;
  }
  if (start && end && start > end) {
    const error = new Error('startDate cannot be after endDate.');
    error.status = 400;
    throw error;
  }
  return { start, end };
}

function effectivePoints(credit) {
  const points = Math.abs(Number(credit.points) || 0);
  const status = String(credit.status || '').toLowerCase();
  const appealStatus = String(credit.appeal?.status || '').toLowerCase();
  if (credit.type === 'positive') return status === 'approved' ? points : 0;
  if (credit.type === 'negative') {
    const applies = appealStatus ? appealStatus === 'rejected' : status === 'approved';
    return applies ? -points : 0;
  }
  return 0;
}

function publicFaculty(user) {
  return {
    id: user._id,
    facultyID: user.facultyID || '',
    prefix: user.prefix || '',
    name: user.name || '',
    email: user.email || '',
    phone: user.phone || '',
    whatsappNumber: user.whatsappNumber || '',
    college: user.college || '',
    department: user.department || '',
    designation: user.designation || '',
    roleCategory: user.roleCategory || '',
    role: user.role || '',
    isActive: user.isActive !== false,
    joinedAt: user.createdAt || '',
    currentCredit: Number(user.currentCredit) || 0,
    creditsByYear: user.creditsByYear || {},
  };
}

async function loadLedger(facultyId, query) {
  const faculty = await User.findById(String(facultyId));
  if (!faculty) {
    const error = new Error('Faculty user not found');
    error.status = 404;
    throw error;
  }

  const type = String(query.type || 'all').toLowerCase();
  const status = String(query.status || 'all').toLowerCase();
  if (!['all', 'positive', 'negative'].includes(type)) {
    const error = new Error('type must be all, positive, or negative');
    error.status = 400;
    throw error;
  }
  const { start, end } = parseDateRange(query.startDate, query.endDate);
  let credits = await Credit.find({ faculty: String(facultyId) });
  credits = credits.filter((credit) => {
    if (type !== 'all' && String(credit.type).toLowerCase() !== type) return false;
    if (status !== 'all' && String(credit.status).toLowerCase() !== status) return false;
    const created = new Date(credit.createdAt);
    if (start && created < start) return false;
    if (end && created > end) return false;
    return true;
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const summary = credits.reduce((result, credit) => {
    const magnitude = Math.abs(Number(credit.points) || 0);
    const effective = effectivePoints(credit);
    if (credit.type === 'positive') {
      result.positiveRecords += 1;
      result.positivePoints += magnitude;
    } else if (credit.type === 'negative') {
      result.negativeRecords += 1;
      result.negativePoints += magnitude;
    }
    result.effectiveNet += effective;
    result.statusCounts[credit.status || 'unknown'] = (result.statusCounts[credit.status || 'unknown'] || 0) + 1;
    return result;
  }, { totalRecords: credits.length, positiveRecords: 0, negativeRecords: 0, positivePoints: 0, negativePoints: 0, effectiveNet: 0, statusCounts: {} });

  return { faculty: publicFaculty(faculty), summary, credits, filters: { type, status, startDate: query.startDate || null, endDate: query.endDate || null } };
}

async function getFacultyLedger(req, res, next) {
  try {
    const ledger = await loadLedger(req.params.facultyId, req.query);
    res.json({ success: true, data: ledger });
  } catch (error) {
    next(error);
  }
}

function validateRankingQuery(query) {
  const type = String(query.type || 'all').toLowerCase();
  const sort = String(query.sort || 'desc').toLowerCase();
  const groupBy = String(query.groupBy || 'institution').toLowerCase();
  if (!['all', 'positive', 'negative'].includes(type)) {
    const error = new Error('type must be all, positive, or negative'); error.status = 400; throw error;
  }
  if (!['asc', 'desc'].includes(sort)) {
    const error = new Error('sort must be asc or desc'); error.status = 400; throw error;
  }
  if (!['institution', 'college', 'department'].includes(groupBy)) {
    const error = new Error('groupBy must be institution, college, or department'); error.status = 400; throw error;
  }
  return { type, sort, groupBy, ...parseDateRange(query.startDate, query.endDate) };
}

async function loadFacultyRanking(query) {
  const { type, sort, groupBy, start, end } = validateRankingQuery(query);
  const college = String(query.college || '').trim();
  const department = String(query.department || '').trim();
  const faculty = (await User.find({ role: 'faculty' })).filter(user =>
    (!college || String(user.college || '') === college) &&
    (!department || String(user.department || '') === department));
  const facultyIds = new Set(faculty.map(user => String(user._id)));
  const credits = (await Credit.find()).filter(credit => {
    if (!facultyIds.has(String(credit.faculty))) return false;
    if (type !== 'all' && String(credit.type).toLowerCase() !== type) return false;
    const created = new Date(credit.createdAt);
    if (start && created < start) return false;
    if (end && created > end) return false;
    return true;
  });
  const totals = new Map(faculty.map(user => [String(user._id), {
    faculty: publicFaculty(user), positivePoints: 0, negativePoints: 0, netCredits: 0, records: 0,
  }]));
  credits.forEach(credit => {
    const row = totals.get(String(credit.faculty));
    if (!row) return;
    const magnitude = Math.abs(Number(credit.points) || 0);
    row.records += 1;
    if (credit.type === 'positive') row.positivePoints += magnitude;
    if (credit.type === 'negative') row.negativePoints += magnitude;
    row.netCredits += effectivePoints(credit);
  });
  const rows = [...totals.values()].sort((a, b) => {
    const difference = sort === 'asc' ? a.netCredits - b.netCredits : b.netCredits - a.netCredits;
    return difference || a.faculty.name.localeCompare(b.faculty.name);
  }).map((row, index) => ({ rank: index + 1, ...row }));
  const options = await User.find({ role: 'faculty' });
  return {
    rows,
    summary: rows.reduce((sum, row) => ({
      facultyCount: sum.facultyCount + 1,
      positivePoints: sum.positivePoints + row.positivePoints,
      negativePoints: sum.negativePoints + row.negativePoints,
      netCredits: sum.netCredits + row.netCredits,
    }), { facultyCount: 0, positivePoints: 0, negativePoints: 0, netCredits: 0 }),
    options: {
      colleges: [...new Set(options.map(user => user.college).filter(Boolean))].sort(),
      departments: [...new Set(options.filter(user => !college || user.college === college).map(user => user.department).filter(Boolean))].sort(),
    },
    filters: { type, sort, groupBy, college: college || null, department: department || null, startDate: query.startDate || null, endDate: query.endDate || null },
  };
}

async function getFacultyRanking(req, res, next) {
  try { res.json({ success: true, data: await loadFacultyRanking(req.query) }); }
  catch (error) { next(error); }
}

async function exportFacultyRanking(req, res, next) {
  try {
    const format = String(req.query.format || '').toLowerCase();
    if (!['pdf', 'excel'].includes(format)) return res.status(400).json({ success: false, message: 'format must be pdf or excel' });
    const report = await loadFacultyRanking(req.query);
    const title = 'Faculty Credit Ranking Ledger';
    let buffer;
    if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Faculty Ranking');
      sheet.addRow([title]);
      sheet.addRow(['Scope', report.filters.groupBy, 'College', report.filters.college || 'All', 'Department', report.filters.department || 'All']);
      sheet.addRow(['Credit type', report.filters.type, 'Date range', report.filters.startDate || 'Beginning', report.filters.endDate || 'Present']);
      sheet.addRow([]);
      sheet.addRow(['Rank', 'Faculty ID', 'Faculty Name', 'College', 'Department', 'Positive Credits', 'Negative Credits', 'Net Credits', 'Records']);
      report.rows.forEach(row => sheet.addRow([row.rank, row.faculty.facultyID, `${row.faculty.prefix} ${row.faculty.name}`.trim(), row.faculty.college, row.faculty.department, row.positivePoints, row.negativePoints, row.netCredits, row.records]));
      sheet.columns = [8, 18, 30, 30, 25, 18, 18, 15, 12].map(width => ({ width }));
      sheet.getRow(5).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF001B70' } };
      sheet.views = [{ state: 'frozen', ySplit: 5 }];
      buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    } else {
      buffer = await new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 }); const chunks = [];
        doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
        doc.font('Helvetica-Bold').fontSize(18).fillColor('#001B70').text(title);
        doc.font('Helvetica').fontSize(8).fillColor('#667085').text(`Scope: ${report.filters.groupBy} | College: ${report.filters.college || 'All'} | Department: ${report.filters.department || 'All'} | Credits: ${report.filters.type} | ${report.filters.startDate || 'Beginning'} to ${report.filters.endDate || 'Present'}`);
        doc.moveDown();
        const widths = [35, 75, 155, 120, 105, 65, 65, 60];
        const headers = ['Rank', 'Faculty ID', 'Faculty name', 'College', 'Department', 'Positive', 'Negative', 'Net'];
        const drawRow = (values, header = false) => { const y = doc.y; let x = 36; if (header) doc.rect(36, y - 3, 680, 18).fill('#001B70'); values.forEach((value, i) => { doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(7).fillColor(header ? '#FFFFFF' : '#172033').text(String(value ?? ''), x + 3, y, { width: widths[i] - 6, ellipsis: true }); x += widths[i]; }); doc.y = y + 19; };
        drawRow(headers, true);
        report.rows.forEach(row => { if (doc.y > 540) { doc.addPage(); drawRow(headers, true); } drawRow([row.rank, row.faculty.facultyID, `${row.faculty.prefix} ${row.faculty.name}`.trim(), row.faculty.college, row.faculty.department, row.positivePoints, row.negativePoints, row.netCredits]); });
        if (!report.rows.length) doc.text('No faculty records matched the selected filters.');
        doc.end();
      });
    }
    const ext = format === 'excel' ? 'xlsx' : 'pdf';
    res.setHeader('Content-Type', format === 'excel' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="EGSPGOI_Faculty_Ranking_${new Date().toISOString().slice(0, 10)}.${ext}"`);
    res.send(buffer);
  } catch (error) { next(error); }
}

async function createExcel(ledger, generatedBy, verification) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'EGSPGOI Faculty Credit System';
  workbook.created = new Date(verification.issuedAt);
  const f = ledger.faculty;
  const profile = [
    ['INDIVIDUAL FACULTY CREDIT LEDGER'], [],
    ['Faculty ID', f.facultyID], ['Name', `${f.prefix} ${f.name}`.trim()], ['Email', f.email],
    ['Phone', f.phone], ['WhatsApp Number', f.whatsappNumber], ['College / Institution', f.college],
    ['Department', f.department], ['Designation', f.designation], ['Professional Category', f.roleCategory],
    ['System Role', f.role], ['Employment Status', f.isActive ? 'Active' : 'Inactive'],
    ['Joined On', f.joinedAt ? new Date(f.joinedAt).toLocaleString('en-IN') : 'N/A'],
    ['Current Stored Credit Balance', f.currentCredit], ['Generated By', generatedBy],
    ['Generated At', new Date().toLocaleString('en-IN')]
  ];
  const profileSheet = workbook.addWorksheet('Faculty Profile');
  profile.forEach(row => profileSheet.addRow(row));
  profileSheet.columns = [{ width: 30 }, { width: 55 }];
  profileSheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF001B70' } };

  const summary = [
    ['Metric', 'Value'], ['Total Records', ledger.summary.totalRecords],
    ['Positive Records', ledger.summary.positiveRecords], ['Positive Points (recorded)', ledger.summary.positivePoints],
    ['Negative Records', ledger.summary.negativeRecords], ['Negative Points (deduction magnitude)', ledger.summary.negativePoints],
    ['Effective Net for Selected Range', ledger.summary.effectiveNet], [],
    ['Filter Type', ledger.filters.type], ['Filter Status', ledger.filters.status],
    ['From Date', ledger.filters.startDate || 'Complete history'], ['To Date', ledger.filters.endDate || 'Complete history']
  ];
  const summarySheet = workbook.addWorksheet('Credit Summary');
  summary.forEach(row => summarySheet.addRow(row));
  summarySheet.columns = [{ width: 38 }, { width: 25 }];
  summarySheet.getRow(1).font = { bold: true };

  const rows = ledger.credits.map((credit, index) => ({
    'S.No': index + 1, 'Credit ID': credit._id, 'Date': new Date(credit.createdAt).toLocaleString('en-IN'),
    'Academic Year': credit.academicYear || '', 'Type': String(credit.type || '').toUpperCase(),
    'Title / Professional Activity': credit.title || '', 'Stored Points': Number(credit.points) || 0,
    'Effective Points': effectivePoints(credit), 'Status': credit.status || '',
    'Categories': Array.isArray(credit.categories) ? credit.categories.join(', ') : '',
    'Notes / Professional Description': credit.notes || '', 'Issued By (User ID)': credit.issuedBy || '',
    'Proof URL': credit.proofUrl || '', 'Appeal Status': credit.appeal?.status || '',
    'Appeal Reason': credit.appeal?.reason || '', 'Created At (ISO)': credit.createdAt || '',
    'Updated At (ISO)': credit.updatedAt || ''
  }));
  const ledgerSheet = workbook.addWorksheet('Credit Ledger');
  if (rows.length) {
    ledgerSheet.columns = Object.keys(rows[0]).map((header, index) => ({
      header, key: header, width: [6, 26, 22, 16, 12, 40, 14, 16, 14, 28, 50, 26, 45, 16, 45, 26, 26][index] || 20,
    }));
    rows.forEach(row => ledgerSheet.addRow(row));
    ledgerSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ledgerSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF001B70' } };
    ledgerSheet.views = [{ state: 'frozen', ySplit: 1 }];
    ledgerSheet.autoFilter = { from: 'A1', to: ledgerSheet.getRow(1).getCell(ledgerSheet.columnCount).address };
  } else {
    ledgerSheet.addRow(['No credit records matched the selected filters.']);
  }
  await addExcelVerificationSheet(workbook, verification);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function createPdf(ledger, generatedBy, verification) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 34, right: 36, bottom: 52, left: 36 },
        bufferPages: true,
        info: {
          Title: 'Individual Faculty Credit Ledger',
          Author: 'E.G.S. Pillay Group of Institutions',
          Subject: `Official faculty credit ledger - ${verification.documentId}`,
          Keywords: 'faculty, credit ledger, EGSPGOI, verified export',
        },
      });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const f = ledger.faculty;
      const pageWidth = doc.page.width;
      const contentX = 36;
      const contentWidth = pageWidth - 72;
      const navy = '#001B70';
      const blue = '#174EA6';
      const magenta = '#AF005F';
      const green = '#087A55';
      const red = '#B42318';
      const ink = '#172033';
      const muted = '#667085';
      const border = '#D7DFEA';
      const soft = '#F5F7FB';
      const logoPath = path.join(__dirname, '../public/egs-pillay-group-logo-flat-dark.png');
      const issuedDate = new Date(verification.issuedAt);
      const facultyName = `${f.prefix || ''} ${f.name || ''}`.trim() || 'N/A';

      const fit = (value, fallback = 'N/A') => {
        const text = String(value || '').trim();
        return text || fallback;
      };

      const drawInstitutionHeader = (compact = false) => {
        const top = 28;
        if (!compact) {
          try { doc.image(logoPath, contentX, top, { fit: [92, 42], align: 'left', valign: 'center' }); }
          catch { doc.font('Helvetica-Bold').fontSize(13).fillColor(navy).text('EGSPGOI', contentX, top + 10); }
          doc.font('Helvetica-Bold').fontSize(15).fillColor(navy)
            .text('E.G.S. Pillay Group of Institutions', 142, top + 1, { width: 417, align: 'right' });
          doc.font('Helvetica').fontSize(7.5).fillColor(muted)
            .text('Faculty Credit System | Official Institutional Record', 142, top + 23, { width: 417, align: 'right' });
          doc.moveTo(contentX, 78).lineTo(contentX + contentWidth, 78).strokeColor(navy).lineWidth(2).stroke();
          doc.moveTo(contentX, 82).lineTo(contentX + contentWidth, 82).strokeColor(magenta).lineWidth(0.7).stroke();
          doc.y = 96;
        } else {
          doc.font('Helvetica-Bold').fontSize(9).fillColor(navy)
            .text('E.G.S. PILLAY GROUP OF INSTITUTIONS', contentX, top, { width: 300 });
          doc.font('Helvetica').fontSize(7).fillColor(muted)
            .text('INDIVIDUAL FACULTY CREDIT LEDGER', 336, top + 1, { width: 223, align: 'right' });
          doc.moveTo(contentX, 48).lineTo(contentX + contentWidth, 48).strokeColor(navy).lineWidth(1).stroke();
          doc.y = 60;
        }
      };

      const drawField = (label, value, x, y, width) => {
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor(muted).text(label.toUpperCase(), x, y, { width });
        doc.font('Helvetica').fontSize(8.5).fillColor(ink).text(fit(value), x, y + 11, { width, ellipsis: true, height: 14 });
      };

      const drawSummaryCard = (label, value, x, color) => {
        doc.roundedRect(x, doc.y, 122, 48, 4).fillAndStroke('#FFFFFF', border);
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor(muted).text(label.toUpperCase(), x + 10, y + 9, { width: 102 });
        doc.font('Helvetica-Bold').fontSize(16).fillColor(color).text(String(value), x + 10, y + 22, { width: 102 });
      };

      const columns = [
        { label: 'DATE', key: 'date', x: 36, width: 58, align: 'left' },
        { label: 'ACTIVITY / REFERENCE', key: 'activity', x: 94, width: 190, align: 'left' },
        { label: 'TYPE', key: 'type', x: 284, width: 50, align: 'center' },
        { label: 'STATUS', key: 'status', x: 334, width: 68, align: 'center' },
        { label: 'POINTS', key: 'points', x: 402, width: 65, align: 'right' },
        { label: 'EFFECTIVE', key: 'effective', x: 467, width: 92, align: 'right' },
      ];

      const drawTableHeader = () => {
        const y = doc.y;
        doc.rect(contentX, y, contentWidth, 24).fill(navy);
        columns.forEach(column => {
          doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#FFFFFF')
            .text(column.label, column.x + 6, y + 8, { width: column.width - 12, align: column.align });
        });
        doc.y = y + 24;
      };

      const addContinuationPage = () => {
        doc.addPage({ size: 'A4', margins: { top: 34, right: 36, bottom: 52, left: 36 } });
        drawInstitutionHeader(true);
        drawTableHeader();
      };

      drawInstitutionHeader(false);
      doc.font('Helvetica-Bold').fontSize(17).fillColor(ink).text('Individual Faculty Credit Ledger', contentX, doc.y, { width: 350 });
      doc.font('Helvetica-Bold').fontSize(7).fillColor(magenta)
        .text('VERIFIED OFFICIAL EXPORT', 406, doc.y - 15, { width: 153, align: 'right' });
      doc.font('Helvetica').fontSize(6.5).fillColor(muted)
        .text(`Document ID: ${verification.documentId}`, 320, doc.y - 1, { width: 239, align: 'right' });
      doc.moveDown(1.2);

      const profileY = doc.y;
      doc.roundedRect(contentX, profileY, contentWidth, 92, 5).fillAndStroke(soft, border);
      drawField('Faculty name', facultyName, 50, profileY + 13, 235);
      drawField('Faculty ID', f.facultyID, 300, profileY + 13, 110);
      drawField('Employment status', f.isActive ? 'Active' : 'Inactive', 425, profileY + 13, 120);
      drawField('Institution / College', f.college, 50, profileY + 49, 235);
      drawField('Department', f.department, 300, profileY + 49, 110);
      drawField('Designation', f.designation, 425, profileY + 49, 120);
      doc.y = profileY + 108;

      const summaryY = doc.y;
      drawSummaryCard('Positive credits', ledger.summary.positivePoints, 36, green);
      doc.y = summaryY;
      drawSummaryCard('Negative credits', ledger.summary.negativePoints, 169, red);
      doc.y = summaryY;
      drawSummaryCard('Effective net', ledger.summary.effectiveNet, 302, blue);
      doc.y = summaryY;
      drawSummaryCard('Records', ledger.summary.totalRecords, 435, ink);
      doc.y = summaryY + 61;

      doc.roundedRect(contentX, doc.y, contentWidth, 34, 3).fillAndStroke('#FFFFFF', border);
      const filterY = doc.y;
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(muted).text('REPORT SCOPE', 48, filterY + 7);
      doc.font('Helvetica').fontSize(7.5).fillColor(ink)
        .text(`${ledger.filters.startDate || 'Beginning'} to ${ledger.filters.endDate || 'Present'}  |  Type: ${String(ledger.filters.type).toUpperCase()}  |  Status: ${String(ledger.filters.status).toUpperCase()}`, 48, filterY + 18, { width: 360 });
      doc.font('Helvetica').fontSize(6.5).fillColor(muted)
        .text(`Issued ${issuedDate.toLocaleString('en-IN')}`, 410, filterY + 12, { width: 137, align: 'right' });
      doc.y = filterY + 48;

      doc.font('Helvetica-Bold').fontSize(9).fillColor(ink).text('Credit Transactions', contentX, doc.y);
      doc.moveDown(0.6);
      drawTableHeader();

      if (!ledger.credits.length) {
        doc.rect(contentX, doc.y, contentWidth, 46).fillAndStroke('#FFFFFF', border);
        doc.font('Helvetica').fontSize(8).fillColor(muted)
          .text('No credit records matched the selected filters.', contentX, doc.y + 17, { width: contentWidth, align: 'center' });
        doc.y += 46;
      }

      ledger.credits.forEach((credit, index) => {
        const title = `${index + 1}. ${fit(credit.title, 'Untitled activity')}`;
        const detail = [credit.academicYear, Array.isArray(credit.categories) ? credit.categories.join(', ') : null, credit.proofUrl ? 'Evidence attached' : null]
          .filter(Boolean).join(' | ');
        doc.font('Helvetica-Bold').fontSize(7.5);
        const titleHeight = doc.heightOfString(title, { width: 178 });
        doc.font('Helvetica').fontSize(6.5);
        const detailHeight = detail ? doc.heightOfString(detail, { width: 178 }) : 0;
        const rowHeight = Math.max(38, titleHeight + detailHeight + 17);
        if (doc.y + rowHeight > 770) addContinuationPage();
        const rowY = doc.y;
        doc.rect(contentX, rowY, contentWidth, rowHeight).fill(index % 2 === 0 ? '#FFFFFF' : '#F8FAFD');
        doc.moveTo(contentX, rowY + rowHeight).lineTo(contentX + contentWidth, rowY + rowHeight).strokeColor(border).lineWidth(0.35).stroke();

        const magnitude = Math.abs(Number(credit.points) || 0);
        const signValue = credit.type === 'positive' ? `+${magnitude}` : `-${magnitude}`;
        const effective = effectivePoints(credit);
        const date = credit.createdAt && !Number.isNaN(new Date(credit.createdAt).getTime())
          ? new Date(credit.createdAt).toLocaleDateString('en-IN') : 'N/A';

        doc.font('Helvetica').fontSize(7).fillColor(ink).text(date, 42, rowY + 11, { width: 46 });
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(ink).text(title, 100, rowY + 7, { width: 178 });
        if (detail) doc.font('Helvetica').fontSize(6.2).fillColor(muted).text(detail, 100, rowY + 9 + titleHeight, { width: 178 });
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor(credit.type === 'positive' ? green : red)
          .text(String(credit.type || 'N/A').toUpperCase(), 290, rowY + 12, { width: 38, align: 'center' });
        doc.font('Helvetica-Bold').fontSize(6.3).fillColor(ink)
          .text(String(credit.status || 'N/A').toUpperCase(), 340, rowY + 12, { width: 56, align: 'center' });
        doc.font('Helvetica-Bold').fontSize(8).fillColor(credit.type === 'positive' ? green : red)
          .text(signValue, 408, rowY + 11, { width: 53, align: 'right' });
        doc.font('Helvetica-Bold').fontSize(8).fillColor(effective >= 0 ? green : red)
          .text(`${effective > 0 ? '+' : ''}${effective}`, 473, rowY + 11, { width: 80, align: 'right' });
        doc.y = rowY + rowHeight;
      });

      if (doc.y > 600) {
        doc.addPage({ size: 'A4', margins: { top: 34, right: 36, bottom: 52, left: 36 } });
        drawInstitutionHeader(true);
        doc.font('Helvetica-Bold').fontSize(10).fillColor(ink).text('Document Verification', contentX, doc.y);
      }
      addPdfVerification(doc, verification);

      const pages = doc.bufferedPageRange();
      for (let i = pages.start; i < pages.start + pages.count; i += 1) {
        doc.switchToPage(i);
        // Keep footer inside PDFKit's A4 content boundary. Drawing below the
        // bottom margin can silently create an extra blank page.
        const footerY = 780;
        doc.moveTo(contentX, footerY - 7).lineTo(contentX + contentWidth, footerY - 7).strokeColor(border).lineWidth(0.45).stroke();
        doc.font('Helvetica').fontSize(6.5).fillColor(muted)
          .text(`Generated by ${generatedBy} | ${verification.documentId}`, contentX, footerY, { width: 390, align: 'left', lineBreak: false });
        doc.text(`Page ${i + 1} of ${pages.count}`, 426, footerY, { width: 133, align: 'right', lineBreak: false });
      }
      doc.end();
    } catch (error) { reject(error); }
  });
}

async function exportFacultyLedger(req, res, next) {
  try {
    const format = String(req.query.format || '').toLowerCase();
    if (!['pdf', 'excel'].includes(format)) return res.status(400).json({ success: false, message: 'format must be pdf or excel' });
    const ledger = await loadLedger(req.params.facultyId, req.query);
    const generatedBy = req.user?.name || 'Administrator';
    const verification = await createExportVerification({
      documentType: 'faculty_credit_ledger',
      subject: {
        facultyId: ledger.faculty.facultyID || ledger.faculty.id,
        facultyName: `${ledger.faculty.prefix} ${ledger.faculty.name}`.trim(),
      },
      totals: {
        records: ledger.summary.totalRecords,
        positive: ledger.summary.positivePoints,
        negative: ledger.summary.negativePoints,
        net: ledger.summary.effectiveNet,
      },
      content: { ledger, generatedBy },
    });
    const safeId = String(ledger.faculty.facultyID || ledger.faculty.id).replace(/[^a-z0-9_-]/gi, '_');
    const buffer = format === 'excel'
      ? await createExcel(ledger, generatedBy, verification)
      : await createPdf(ledger, generatedBy, verification);
    const ext = format === 'excel' ? 'xlsx' : 'pdf';
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomPart = crypto.randomBytes(5).toString('hex').toUpperCase();
    const fileName = `EGSPGOI_Faculty_Credit_Ledger_${safeId}_${datePart}_${randomPart}.${ext}`;
    res.setHeader('Content-Type', format === 'excel' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('X-FCS-Document-ID', verification.documentId);
    res.setHeader('X-FCS-Content-SHA256', verification.contentHash);
    res.send(buffer);
  } catch (error) { next(error); }
}

module.exports = { getFacultyLedger, exportFacultyLedger, getFacultyRanking, exportFacultyRanking, createPdf };
