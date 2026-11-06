/**
 * Audit: input-validation schemas and small utilities.
 */
const { schemas } = require('../../../utils/validation');
const { policySchema } = require('../../../utils/creditPolicySchema');
const { professionalProfileSchema, employmentSchema } = require('../../../utils/facultyProfileSchema');
const { sanitizeUser } = require('../../../utils/sanitizeUser');
const { generateFacultyID, generateApiKey } = require('../../../utils/generateID');
const { evaluateCreditRule, evaluateCondition, policyHash } = require('../../../domain/policy/creditPolicyEngine');
const { createExportVerification, verifyExportToken, contentHash } = require('../../../utils/exportVerification');
const validate = require('../../../Middleware/validateMiddleware');

const ok = (schema, v) => expect(schema.validate(v).error).toBeUndefined();
const bad = (schema, v) => expect(schema.validate(v).error).toBeDefined();

describe('auth schemas', () => {
  const reg = schemas.auth.register;
  const good = { name: 'A', email: 'a@egspec.org', password: 'x'.repeat(12), college: 'C' };
  test('valid register', () => ok(reg, good));
  test('password shorter than 12 rejected', () => bad(reg, { ...good, password: 'x'.repeat(11) }));
  test('password longer than 128 rejected', () => bad(reg, { ...good, password: 'x'.repeat(129) }));
  test('role superadmin cannot be requested', () => bad(reg, { ...good, role: 'superadmin' }));
  test('unknown field rejected (Joi default)', () => bad(reg, { ...good, isAdmin: true }));
  test('login requires email + password', () => {
    bad(schemas.auth.login, { email: 'a@egspec.org' });
    bad(schemas.auth.login, { password: 'x' });
    ok(schemas.auth.login, { email: 'a@egspec.org', password: 'x' });
  });
  test('login email with uncommon TLD is rejected by Joi (e.g. .local / .internal)', () => {
    bad(schemas.auth.login, { email: 'a@college.internal', password: 'x' });
  });
});

describe('credit schemas', () => {
  test('credit title points must be integer', () => {
    bad(schemas.creditTitle.create, { title: 'Abc', points: 1.5 });
    ok(schemas.creditTitle.create, { title: 'Abc', points: 2 });
  });
  test('credit title allows negative and huge points (no range limit)', () => {
    ok(schemas.creditTitle.create, { title: 'Abc', points: -999999999 });
  });
  test('negative-credit schema requires facultyId, creditTitleId, academicYear', () => {
    bad(schemas.issueCredit.negative, { facultyId: 'a', academicYear: '2025-2026' });
    ok(schemas.issueCredit.negative, { facultyId: 'a', creditTitleId: 'b', academicYear: '2025-2026' });
  });
  test('academicYear has no format rule (any text accepted)', () => {
    ok(schemas.issueCredit.negative, { facultyId: 'a', creditTitleId: 'b', academicYear: '<script>' });
  });
});

describe('validate() middleware', () => {
  test('rejects invalid body with 400', () => {
    const res = {
      status(c) {
        this.c = c;
        return this;
      },
      json(b) {
        this.b = b;
        return this;
      },
    };
    validate(schemas.creditTitle.create)({ body: {} }, res, () => {});
    expect(res.c).toBe(400);
  });
  test('does NOT strip unknown fields from req.body (stripUnknown result is discarded)', () => {
    const req = { body: { title: 'Abcd', points: 1, role: 'admin' } };
    validate(schemas.creditTitle.create)(req, {}, () => {});
    expect(req.body.role).toBe('admin');
  });
});

describe('policy + profile schemas', () => {
  const rule = {
    ruleId: 'paper.journal',
    name: 'Journal paper',
    creditType: 'positive',
    calculation: { basePoints: 10 },
  };
  const policy = { name: 'Policy 1', effectiveFrom: '2025-06-01', effectiveTo: null, rules: [rule] };
  test('valid policy', () => ok(policySchema, policy));
  test('duplicate ruleIds rejected', () => bad(policySchema, { ...policy, rules: [rule, rule] }));
  test('effectiveTo before effectiveFrom rejected', () => bad(policySchema, { ...policy, effectiveTo: '2025-01-01' }));
  test('basePoints over 100000 rejected', () =>
    bad(policySchema, { ...policy, rules: [{ ...rule, calculation: { basePoints: 100001 } }] }));
  test('ORCID format', () => {
    ok(professionalProfileSchema, { researchIds: { orcid: '0000-0002-1825-009X' } });
    bad(professionalProfileSchema, { researchIds: { orcid: '1234' } });
  });
  test('profile links must be http(s) (no javascript: URLs)', () => {
    bad(professionalProfileSchema, { professionalLinks: { website: 'javascript:alert(1)' } });
  });
  test('employment requires all core fields', () => {
    bad(employmentSchema, { employeeId: 'E1' });
  });
});

describe('policy engine', () => {
  const policy = {
    status: 'published',
    rules: [
      {
        ruleId: 'r1',
        creditType: 'positive',
        eligibility: { all: [{ field: 'paper.indexed', operator: 'equals', value: true }] },
        requiredEvidence: [{ type: 'pdf', required: true }],
        calculation: {
          basePoints: 10,
          multiplierRules: [
            { when: { field: 'paper.q1', operator: 'equals', value: true }, multiplier: 2, label: 'Q1' },
          ],
          perEventCap: 15,
          periodCap: 30,
          roundingScale: 2,
        },
      },
      { ruleId: 'n1', creditType: 'negative', calculation: { basePoints: 3 } },
    ],
  };
  test('multiplier then per-event cap', () => {
    const r = evaluateCreditRule(policy, 'r1', { paper: { indexed: true, q1: true }, evidenceTypes: ['pdf'] });
    expect(r.calculation.signedImpact).toBe(15);
  });
  test('period cap limits remaining award', () => {
    const r = evaluateCreditRule(
      policy,
      'r1',
      { paper: { indexed: true }, evidenceTypes: ['pdf'] },
      { alreadyAwarded: 25 },
    );
    expect(r.calculation.magnitude).toBe(5);
  });
  test('missing evidence -> no calculation', () => {
    expect(evaluateCreditRule(policy, 'r1', { paper: { indexed: true } }).calculation).toBeNull();
  });
  test('negative rule yields negative impact', () => {
    expect(evaluateCreditRule(policy, 'n1', {}).calculation.signedImpact).toBe(-3);
  });
  test('draft policies refused unless allowDraft', () => {
    expect(() => evaluateCreditRule({ ...policy, status: 'draft' }, 'r1', {})).toThrow();
  });
  test('unknown operator is false', () => {
    expect(evaluateCondition({ field: 'a', operator: 'regex', value: '.*' }, { a: 'x' })).toBe(false);
  });
  test('policy hash ignores publish metadata', () => {
    expect(policyHash({ ...policy, publishedAt: 'x' })).toBe(policyHash(policy));
  });
});

describe('export signatures', () => {
  test('sign -> verify round trip, and tampering detected', async () => {
    const v = await createExportVerification({ documentType: 't', content: { a: 1 } });
    expect(verifyExportToken(v.token).valid).toBe(true);
    const [p, s] = v.token.split('.');
    expect(verifyExportToken(`${p}x.${s}`).valid).toBe(false);
    expect(verifyExportToken(`${p}.${s.slice(0, -2)}AA`).valid).toBe(false);
    expect(verifyExportToken('garbage').reason).toBe('malformed_token');
  });
  test('content hash is key-order independent', () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
  });
  test('short signing secret is refused', async () => {
    const old = process.env.EXPORT_SIGNING_SECRET;
    process.env.EXPORT_SIGNING_SECRET = 'short';
    await expect(createExportVerification({ documentType: 't', content: {} })).rejects.toThrow(/32 bytes/);
    process.env.EXPORT_SIGNING_SECRET = old;
  });
});

describe('utilities', () => {
  test('sanitizeUser removes every secret field', () => {
    const out = sanitizeUser({
      name: 'a',
      password: 'h',
      apiKey: 'k',
      mfaSecret: 's',
      mfaCode: '1',
      whatsappOtp: '2',
      resetPasswordToken: 't',
      fcmToken: 'f',
      mfaPendingSecret: 'pending',
    });
    expect(Object.keys(out)).toEqual(
      expect.not.arrayContaining([
        'password',
        'apiKey',
        'mfaSecret',
        'mfaCode',
        'whatsappOtp',
        'resetPasswordToken',
        'fcmToken',
      ]),
    );
  });
  test('sanitizeUser hides the MFA setup secret', () => {
    expect(sanitizeUser({ mfaPendingSecret: 'pending' })).not.toHaveProperty('mfaPendingSecret');
  });
  test.each([
    ['EGS Pillay Engineering College', 'EGSP/EC/'],
    ['Arts and Science', 'EGSP/ASC/'],
    ['Polytechnic', 'EGSP/PC/'],
    ['Nursing', 'EGSP/NUR/'],
    ['College of Education', 'EGSP/EDU/'],
    ['Pharmacy', 'EGSP/PHARM/'],
    ['Naturopathy', 'EGSP/NYS/'],
    ['', 'EGSP/GEN/'],
  ])('facultyID prefix for %p', (college, prefix) => {
    expect(generateFacultyID(college)).toMatch(new RegExp(`^${prefix.replace(/\//g, '\\/')}\\d{5}$`));
  });
  test.failing('[BUG] facultyID has only 90,000 values per college and no uniqueness check (collisions)', () => {
    // Force the random generator to repeat: two users get the same ID. Nothing in the app prevents this.
    const spy = jest.spyOn(Math, 'random').mockReturnValue(0.123);
    const a = generateFacultyID('Engineering');
    const b = generateFacultyID('Engineering');
    spy.mockRestore();
    expect(a).not.toBe(b);
  });
  test('api keys are unique and prefixed', () => {
    const a = generateApiKey();
    expect(a).toMatch(/^ak_[0-9a-f]{32}$/);
    expect(a).not.toBe(generateApiKey());
  });
});
