const fs = require('fs');
const path = require('path');
const { createPdf } = require('../Controllers/facultyLedgerController');
const { createExportVerification } = require('../utils/exportVerification');

async function main() {
  process.env.EXPORT_SIGNING_SECRET ||= 'local-render-only-signing-secret-with-at-least-32-bytes';
  process.env.PUBLIC_APP_URL ||= 'http://localhost:9002';

  const credits = Array.from({ length: 24 }, (_, index) => ({
    _id: `credit-${index + 1}`,
    createdAt: new Date(2026, 6 + (index % 2), 1 + index).toISOString(),
    academicYear: '2026-2027',
    type: index % 5 === 0 ? 'negative' : 'positive',
    title: index % 4 === 0
      ? 'Peer-reviewed international journal publication with an extended professional activity title'
      : `Professional development activity ${index + 1}`,
    points: index % 5 === 0 ? 2 : 4,
    status: index % 7 === 0 ? 'pending' : 'approved',
    categories: index % 2 ? ['Research', 'Publication'] : ['Professional Development'],
    proofUrl: index % 3 ? 'https://evidence.example/item' : '',
  }));
  const effective = credit => credit.type === 'positive'
    ? (credit.status === 'approved' ? Math.abs(credit.points) : 0)
    : (credit.status === 'approved' ? -Math.abs(credit.points) : 0);
  const ledger = {
    faculty: {
      id: 'faculty-sample', facultyID: 'EGSP-FAC-1042', prefix: 'Dr.', name: 'Ananya Raman',
      email: 'ananya@example.edu', college: 'E.G.S. Pillay Engineering College',
      department: 'Computer Science and Engineering', designation: 'Associate Professor',
      roleCategory: 'Teaching and Research', isActive: true, currentCredit: 54,
    },
    credits,
    summary: {
      totalRecords: credits.length,
      positivePoints: credits.filter(c => c.type === 'positive').reduce((sum, c) => sum + Math.abs(c.points), 0),
      negativePoints: credits.filter(c => c.type === 'negative').reduce((sum, c) => sum + Math.abs(c.points), 0),
      effectiveNet: credits.reduce((sum, c) => sum + effective(c), 0),
    },
    filters: { type: 'all', status: 'all', startDate: '2026-07-01', endDate: '2026-08-31' },
  };
  const verification = await createExportVerification({
    documentType: 'faculty_credit_ledger',
    subject: { facultyId: ledger.faculty.facultyID, facultyName: 'Dr. Ananya Raman' },
    totals: ledger.summary,
    content: ledger,
  });
  const buffer = await createPdf(ledger, 'Quality Assurance Preview', verification);
  const outputDir = path.resolve(__dirname, '../../output/pdf');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'faculty-credit-ledger-a4-preview.pdf');
  fs.writeFileSync(outputPath, buffer);
  console.log(outputPath);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
