const crypto = require('crypto');
const QRCode = require('qrcode');

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function signingSecret() {
  const secret = process.env.EXPORT_SIGNING_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    const error = new Error('Official export signing is not configured. EXPORT_SIGNING_SECRET must contain at least 32 bytes.');
    error.status = 503;
    throw error;
  }
  return secret;
}

function contentHash(content) {
  return crypto.createHash('sha256').update(canonicalJson(content)).digest('hex');
}

function encode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function signatureFor(encodedPayload) {
  return crypto.createHmac('sha256', signingSecret()).update(encodedPayload).digest('base64url');
}

function normalizeBaseUrl(baseUrl) {
  const configured = baseUrl || process.env.PUBLIC_APP_URL;
  if (!configured) {
    const error = new Error('PUBLIC_APP_URL is required for signed export QR links.');
    error.status = 503;
    throw error;
  }
  return configured.replace(/\/$/, '');
}

async function createExportVerification({ documentType, subject, totals, content, baseUrl }) {
  const payload = {
    v: 1,
    documentId: `FCS-${crypto.randomUUID()}`,
    issuedAt: new Date().toISOString(),
    documentType,
    subject: subject || null,
    totals: totals || null,
    contentHash: contentHash(content),
    algorithm: 'HMAC-SHA256',
  };
  const encodedPayload = encode(canonicalJson(payload));
  const signature = signatureFor(encodedPayload);
  const token = `${encodedPayload}.${signature}`;
  const verificationUrl = `${normalizeBaseUrl(baseUrl)}/verify/${token}`;
  const qrPng = await QRCode.toBuffer(verificationUrl, {
    type: 'png', width: 220, margin: 1, errorCorrectionLevel: 'M',
  });
  return { ...payload, signature, token, verificationUrl, qrPng };
}

function verifyExportToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return { valid: false, reason: 'malformed_token' };
  const [encodedPayload, suppliedSignature] = parts;
  const expectedSignature = signatureFor(encodedPayload);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return { valid: false, reason: 'invalid_signature' };
  }
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (payload.v !== 1 || !payload.documentId || !payload.issuedAt || !payload.contentHash) {
      return { valid: false, reason: 'invalid_payload' };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: 'invalid_payload' };
  }
}

function verificationLines(v) {
  return [
    ['Document ID', v.documentId],
    ['Issued At (ISO)', v.issuedAt],
    ['Document Type', v.documentType],
    ['Content SHA-256', v.contentHash],
    ['Signature Algorithm', v.algorithm],
    ['Digital Signature', v.signature],
    ['Verification URL', v.verificationUrl],
  ];
}

async function addExcelVerificationSheet(workbook, verification) {
  const sheet = workbook.addWorksheet('Verification', { properties: { tabColor: { argb: 'FF001B70' } } });
  sheet.columns = [{ width: 24 }, { width: 92 }];
  sheet.mergeCells('A1:B1');
  sheet.getCell('A1').value = 'SIGNED EXPORT VERIFICATION';
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF001B70' } };
  sheet.getCell('A1').alignment = { horizontal: 'center' };
  verificationLines(verification).forEach(([label, value], index) => {
    const row = index + 3;
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 1).font = { bold: true };
    sheet.getCell(row, 2).value = value;
    sheet.getCell(row, 2).alignment = { wrapText: true, vertical: 'top' };
  });
  sheet.getCell('A12').value = 'Scan the QR code or open the verification URL to validate this export.';
  sheet.getCell('A12').alignment = { wrapText: true };
  sheet.mergeCells('A12:B12');
  const imageId = workbook.addImage({ buffer: verification.qrPng, extension: 'png' });
  sheet.addImage(imageId, { tl: { col: 0.5, row: 12.5 }, ext: { width: 190, height: 190 } });
  sheet.getRow(13).height = 145;
  sheet.views = [{ state: 'frozen', ySplit: 2 }];
}

function addPdfVerification(doc, verification, options = {}) {
  if (doc.y > 610) doc.addPage();
  const y = Math.max(doc.y + 12, options.y || 0);
  doc.moveTo(36, y).lineTo(doc.page.width - 36, y).strokeColor('#d7dce5').lineWidth(0.5).stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#001b70').text('Digital Verification', 36, y + 10);
  doc.image(verification.qrPng, 36, y + 28, { width: 82, height: 82 });
  doc.font('Helvetica').fontSize(7).fillColor('#333').text(`Document ID: ${verification.documentId}`, 128, y + 30, { width: 420 });
  doc.text(`Issued: ${verification.issuedAt}`, 128, y + 42, { width: 420 });
  doc.text(`Content SHA-256: ${verification.contentHash}`, 128, y + 54, { width: 420 });
  doc.text(`Signature (${verification.algorithm}): ${verification.signature}`, 128, y + 66, { width: 420 });
  doc.fillColor('#001b70').text(verification.verificationUrl, 128, y + 88, { width: 420, link: verification.verificationUrl, underline: true });
  doc.y = y + 122;
}

module.exports = {
  canonicalJson,
  contentHash,
  createExportVerification,
  verifyExportToken,
  verificationLines,
  addExcelVerificationSheet,
  addPdfVerification,
};
