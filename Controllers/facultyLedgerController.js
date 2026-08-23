const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
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
      const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const f = ledger.faculty;
      doc.font('Helvetica-Bold').fontSize(18).fillColor('#001b70').text('E.G.S. Pillay Group of Institutions', { align: 'center' });
      doc.fontSize(14).fillColor('#222').text('Individual Faculty Credit Ledger', { align: 'center' }).moveDown();
      doc.font('Helvetica').fontSize(9);
      const details = [
        `Faculty: ${`${f.prefix} ${f.name}`.trim()} (${f.facultyID || 'N/A'})`, `Email: ${f.email || 'N/A'}`,
        `College: ${f.college || 'N/A'}`, `Department: ${f.department || 'N/A'}`,
        `Designation: ${f.designation || 'N/A'}`, `Professional Category: ${f.roleCategory || 'N/A'}`,
        `Status: ${f.isActive ? 'Active' : 'Inactive'}`, `Current stored balance: ${f.currentCredit}`
      ];
      details.forEach(value => doc.text(value));
      doc.moveDown().font('Helvetica-Bold').text(`Selected range: ${ledger.filters.startDate || 'Beginning'} to ${ledger.filters.endDate || 'Present'}`);
      doc.text(`Records: ${ledger.summary.totalRecords} | Positive: ${ledger.summary.positivePoints} | Negative: ${ledger.summary.negativePoints} | Effective net: ${ledger.summary.effectiveNet}`);
      doc.moveDown();
      ledger.credits.forEach((credit, index) => {
        if (doc.y > 735) doc.addPage();
        const signValue = credit.type === 'positive' ? `+${Math.abs(Number(credit.points) || 0)}` : `-${Math.abs(Number(credit.points) || 0)}`;
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#111').text(`${index + 1}. ${credit.title || 'Untitled'}  [${signValue}]`);
        doc.font('Helvetica').fontSize(8).fillColor('#444').text(`${new Date(credit.createdAt).toLocaleDateString('en-IN')} | ${credit.academicYear || 'N/A'} | ${String(credit.type || '').toUpperCase()} | ${String(credit.status || '').toUpperCase()} | Effective: ${effectivePoints(credit)}`);
        if (credit.notes) doc.text(`Details: ${credit.notes}`);
        if (credit.proofUrl) doc.text(`Proof: ${credit.proofUrl}`);
        doc.moveDown(0.6);
      });
      addPdfVerification(doc, verification);
      const pages = doc.bufferedPageRange();
      for (let i = pages.start; i < pages.start + pages.count; i += 1) {
        doc.switchToPage(i);
        doc.fontSize(7).fillColor('#777').text(`Generated by ${generatedBy} | ${new Date().toLocaleString('en-IN')} | Page ${i + 1}`, 36, 806, { width: 523, align: 'center' });
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
    res.setHeader('Content-Type', format === 'excel' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Faculty_Credit_Ledger_${safeId}.${ext}"`);
    res.setHeader('X-FCS-Document-ID', verification.documentId);
    res.setHeader('X-FCS-Content-SHA256', verification.contentHash);
    res.send(buffer);
  } catch (error) { next(error); }
}

module.exports = { getFacultyLedger, exportFacultyLedger };
