const ExcelJS = require('exceljs');

describe('signed export verification', () => {
  const originalSecret = process.env.EXPORT_SIGNING_SECRET;
  const originalPublicUrl = process.env.PUBLIC_APP_URL;

  beforeAll(() => {
    process.env.EXPORT_SIGNING_SECRET = 'test-only-export-signing-secret-at-least-32-bytes';
    process.env.PUBLIC_APP_URL = 'https://fcs.example.edu';
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.EXPORT_SIGNING_SECRET;
    else process.env.EXPORT_SIGNING_SECRET = originalSecret;
    if (originalPublicUrl === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = originalPublicUrl;
  });

  test('creates and verifies a privacy-limited signed token', async () => {
    const { createExportVerification, verifyExportToken } = require('../../utils/exportVerification');
    const verification = await createExportVerification({
      documentType: 'faculty_credit_ledger',
      subject: { facultyId: 'F-100', facultyName: 'Example Faculty' },
      totals: { positive: 4, negative: 1, net: 3 },
      content: { privateEvidence: 'not included in public token', rows: [{ points: 4 }] },
    });

    const result = verifyExportToken(verification.token);
    expect(result.valid).toBe(true);
    expect(result.payload.documentId).toMatch(/^FCS-/);
    expect(result.payload.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(verification.verificationUrl).toContain('/verify/');
    expect(verification.qrPng.subarray(1, 4).toString()).toBe('PNG');
    expect(verification.token).not.toContain('privateEvidence');
  });

  test('rejects a tampered signature', async () => {
    const { createExportVerification, verifyExportToken } = require('../../utils/exportVerification');
    const verification = await createExportVerification({
      documentType: 'report', content: { total: 1 },
    });
    const tampered = `${verification.token.slice(0, -1)}${verification.token.endsWith('a') ? 'b' : 'a'}`;
    expect(verifyExportToken(tampered)).toEqual({ valid: false, reason: 'invalid_signature' });
  });

  test('embeds a verification sheet and QR image in Excel reports', async () => {
    const { createExportVerification } = require('../../utils/exportVerification');
    const { createExcelReport } = require('../../utils/reportUtils');
    const data = [{ facultyID: 'F-100', name: 'Example Faculty', department: 'CSE', positive: 4, negative: 1, total: 3, count: 2 }];
    const metadata = { title: 'Test Report', level: 'faculty', date: 'now', generatedBy: 'Test' };
    const verification = await createExportVerification({ documentType: 'test_report', content: { data, metadata } });
    const buffer = await createExcelReport(data, metadata, 'ranking', verification);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    expect(workbook.getWorksheet('Verification')).toBeTruthy();
    expect(workbook.getWorksheet('Verification').getCell('B3').value).toBe(verification.documentId);
    expect(workbook.getWorksheet('Verification').getImages()).toHaveLength(1);
  });

  test('creates a protected operational export and neutralizes spreadsheet formulas', async () => {
    const { createOfficialExcel } = require('../../Controllers/exportVerificationController');
    let sentBuffer;
    const headers = {};
    const req = {
      user: { name: 'Admin User' },
      body: {
        documentType: 'good_works_submissions',
        rows: [{ title: '=HYPERLINK("https://example.invalid")', points: 2 }],
      },
    };
    const res = {
      setHeader(name, value) { headers[name] = value; },
      send(buffer) { sentBuffer = buffer; return this; },
      status(code) { this.statusCode = code; return this; },
      json(body) { throw new Error(`Unexpected response: ${this.statusCode} ${JSON.stringify(body)}`); },
    };
    await createOfficialExcel(req, res, error => { throw error; });
    expect(headers['X-FCS-Document-ID']).toMatch(/^FCS-/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(sentBuffer);
    expect(workbook.getWorksheet('Submissions').getCell('A2').value).toMatch(/^'/);
    expect(workbook.getWorksheet('Verification').getImages()).toHaveLength(1);
  });
});
