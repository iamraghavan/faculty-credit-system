const { verifyExportToken } = require('../utils/exportVerification');
const ExcelJS = require('exceljs');
const { createExportVerification, addExcelVerificationSheet } = require('../utils/exportVerification');

const ALLOWED_EXPORTS = {
  good_works_submissions: { title: 'Good Works Submissions', sheetName: 'Submissions' },
};

function safeCellValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text = Array.isArray(value) ? value.join(', ') : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

async function createOfficialExcel(req, res, next) {
  try {
    const definition = ALLOWED_EXPORTS[req.body?.documentType];
    const rows = req.body?.rows;
    if (!definition) return res.status(400).json({ success: false, message: 'Unsupported official export type' });
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 10000) {
      return res.status(400).json({ success: false, message: 'rows must contain between 1 and 10000 records' });
    }
    if (rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
      return res.status(400).json({ success: false, message: 'Every row must be an object' });
    }

    const normalizedRows = rows.map(row => Object.fromEntries(
      Object.entries(row).slice(0, 50).map(([key, value]) => [String(key).slice(0, 100), safeCellValue(value)])
    ));
    const metadata = {
      generatedBy: req.user?.name || req.user?._id || 'Authorized user',
      generatedAt: new Date().toISOString(),
      recordCount: normalizedRows.length,
    };
    const verification = await createExportVerification({
      documentType: req.body.documentType,
      subject: { scope: definition.title },
      totals: { records: normalizedRows.length },
      content: { rows: normalizedRows, metadata },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'EGSPGOI Faculty Credit System';
    workbook.created = new Date(verification.issuedAt);
    const sheet = workbook.addWorksheet(definition.sheetName);
    const headers = [...new Set(normalizedRows.flatMap(row => Object.keys(row)))];
    sheet.columns = headers.map(header => ({ header, key: header, width: 24 }));
    normalizedRows.forEach(row => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF001B70' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    await addExcelVerificationSheet(workbook, verification);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${req.body.documentType}_${Date.now()}.xlsx"`);
    res.setHeader('X-FCS-Document-ID', verification.documentId);
    res.setHeader('X-FCS-Content-SHA256', verification.contentHash);
    return res.send(buffer);
  } catch (error) {
    next(error);
  }
}

function verifyExport(req, res, next) {
  try {
    const result = verifyExportToken(req.params.token);
    if (!result.valid) {
      return res.status(400).json({ success: false, valid: false, reason: result.reason });
    }
    return res.json({
      success: true,
      valid: true,
      document: result.payload,
      notice: 'The signature and exported content fingerprint are valid. Private export rows are not exposed by this endpoint.',
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { verifyExport, createOfficialExcel };
