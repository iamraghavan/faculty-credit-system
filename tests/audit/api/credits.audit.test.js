/**
 * Audit: credit workflows - submission, review, negative remarks, appeals,
 * OA ownership, and score consistency (real app + DynamoDB Local).
 */
const crypto = require('crypto');
const { setupApp, teardownApp, tokens, api, auth } = require('../../helpers/app');
const db = require('../../helpers/db');
const { processCredits } = require('../../../utils/calculateCredits');

const { ID, TITLE, CREDIT } = db;
const C = '/api/v1/credits';
const A = '/api/v1/admin';
const newId = () => crypto.randomBytes(12).toString('hex');
let T;

beforeAll(async () => { await setupApp(); T = await tokens(); });
afterAll(() => teardownApp());

/** The cached total on the user must always equal a fresh recalculation. */
async function expectConsistentTotal(facultyId) {
  const credits = (await db.scan('credits')).filter((c) => c.faculty === facultyId);
  const user = await db.get('users', facultyId);
  expect(user.currentCredit).toBe(processCredits(credits).runningTotal);
  return user.currentCredit;
}
async function addCredit(faculty, type, points, status, extra = {}) {
  const id = newId();
  await db.put('credits', db.credit(id, faculty, type, points, status, extra));
  return id;
}

describe('faculty submits a positive credit (good work)', () => {
  const submit = (t, body) => api().post(`${C}/credits/positive`).set(auth(t)).send(body);
  const body = { title: 'Published IEEE paper', points: 10, academicYear: '2025-2026' };

  test('valid submission -> 201 pending, no score change yet', async () => {
    const res = await submit(T.faculty, body);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'pending', type: 'positive', faculty: ID.faculty1, points: 10 });
    await expectConsistentTotal(ID.faculty1);
  });

  test.each([
    [{ points: 10, academicYear: '2025-2026' }, 'missing title'],
    [{ title: 'x', academicYear: '2025-2026' }, 'missing points'],
    [{ title: 'x', points: 10 }, 'missing academicYear'],
    [{ ...body, points: 0 }, 'zero points'],
    [{ ...body, points: -5 }, 'negative points'],
    [{ ...body, points: 'abc' }, 'non-numeric points'],
    [{ ...body, categories: ['does-not-exist'] }, 'unknown category id'],
  ])('rejects %j (%s) with 400', async (b) => {
    expect((await submit(T.faculty, b)).status).toBe(400);
  });

  test('[FIXED] no upper limit: faculty can claim 1,000,000,000 points', async () => {
    expect((await submit(T.faculty, { ...body, points: 1e9 })).status).toBe(400);
  });

  test.failing('[BUG] title/notes/academicYear have no length or format limits (100 KB title accepted)', async () => {
    expect((await submit(T.faculty, { ...body, title: 'x'.repeat(100000) })).status).toBe(400);
  });

  test('HTML in title is stored as-is (output encoding must happen in the UI)', async () => {
    const res = await submit(T.faculty, { ...body, title: '<img src=x onerror=alert(1)>' });
    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('<img src=x onerror=alert(1)>');
  });

  test('non-faculty roles cannot submit (403)', async () => {
    for (const r of ['oa', 'admin']) expect((await submit(T[r], body)).status).toBe(403);
  });

  test('proof upload: allowed type is accepted and a short link stored', async () => {
    const res = await api().post(`${C}/credits/positive`).set(auth(T.faculty))
      .field('title', 'With proof').field('points', '3').field('academicYear', '2025-2026')
      .attach('proof', Buffer.from('%PDF-1.4 test'), 'proof.pdf');
    expect(res.status).toBe(201);
    expect(res.body.data.proofUrl).toMatch(/\/s\/[0-9a-f]{6}$/);
  });

  test.failing('[BUG] blocked file type returns 500 instead of a clear 400', async () => {
    const res = await api().post(`${C}/credits/positive`).set(auth(T.faculty))
      .field('title', 'x').field('points', '3').field('academicYear', '2025-2026')
      .attach('proof', Buffer.from('MZ'), 'malware.exe');
    expect(res.status).toBe(400);
  });

  test.failing('[BUG] upload filter trusts the file name only: an HTML/JS file renamed to .pdf is accepted', async () => {
    const res = await api().post(`${C}/credits/positive`).set(auth(T.faculty))
      .field('title', 'x').field('points', '3').field('academicYear', '2025-2026')
      .attach('proof', Buffer.from('<script>alert(1)</script>'), { filename: 'proof.pdf', contentType: 'text/html' });
    expect(res.status).toBe(400);
  });

  test.failing('[BUG] SVG uploads are allowed by default (SVG can carry scripts)', async () => {
    const res = await api().post(`${C}/credits/positive`).set(auth(T.faculty))
      .field('title', 'x').field('points', '3').field('academicYear', '2025-2026')
      .attach('proof', Buffer.from('<svg onload="alert(1)"/>'), 'proof.svg');
    expect(res.status).toBe(400);
  });

  test('over 10 MB file is refused', async () => {
    const res = await api().post(`${C}/credits/positive`).set(auth(T.faculty))
      .field('title', 'x').field('points', '3').field('academicYear', '2025-2026')
      .attach('proof', Buffer.alloc(10 * 1024 * 1024 + 1), 'big.pdf');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test.failing('[BUG] duplicate submission: the same claim can be submitted twice in a row', async () => {
    const b = { title: 'Duplicate test claim', points: 4, academicYear: '2025-2026' };
    const [r1, r2] = await Promise.all([submit(T.faculty2, b), submit(T.faculty2, b)]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
  });
});

describe('faculty edits / withdraws own pending submission', () => {
  test('edit own pending -> 200', async () => {
    const id = await addCredit(ID.faculty1, 'positive', 5, 'pending');
    const res = await api().put(`${C}/credits/positive/${id}`).set(auth(T.faculty)).send({ title: 'Updated', points: 6 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ title: 'Updated', points: 6 });
  });

  test("cannot edit another faculty's credit (403)", async () => {
    const res = await api().put(`${C}/credits/positive/${CREDIT.f2PosPending}`).set(auth(T.faculty)).send({ points: 99 });
    expect(res.status).toBe(403);
  });

  test('cannot edit an approved credit (400)', async () => {
    const res = await api().put(`${C}/credits/positive/${CREDIT.f1PosApproved}`).set(auth(T.faculty)).send({ points: 99 });
    expect(res.status).toBe(400);
  });

  test('unknown id -> 404', async () => {
    expect((await api().put(`${C}/credits/positive/${newId()}`).set(auth(T.faculty)).send({ points: 1 })).status).toBe(404);
  });

  test('[FIXED] edit accepts negative points', async () => {
    const id = await addCredit(ID.faculty1, 'positive', 5, 'pending');
    expect((await api().put(`${C}/credits/positive/${id}`).set(auth(T.faculty)).send({ points: -50 })).status).toBe(400);
  });

  test('[FIXED] edit accepts non-numeric points and then breaks score recalculation', async () => {
    const id = await addCredit(ID.faculty2, 'positive', 5, 'pending');
    const res = await api().put(`${C}/credits/positive/${id}`).set(auth(T.faculty2)).send({ points: 'abc' });
    const stored = await db.get('credits', id);
    await db.put('credits', { ...stored, points: 5 }); // repair for later tests
    expect(res.status).toBe(400);
  });

  test('[FIXED SEC-01] faculty can change the points of a NEGATIVE remark issued to them', async () => {
    const id = await addCredit(ID.faculty1, 'negative', -5, 'pending', { issuedBy: ID.oa1 });
    const res = await api().put(`${C}/credits/positive/${id}`).set(auth(T.faculty)).send({ points: 0.01 });
    const after = await db.get('credits', id);
    expect([400, 403]).toContain(res.status);
    expect(after.points).toBe(-5);
  });

  test('[FIXED SEC-01] faculty can VOID a negative remark issued to them', async () => {
    const id = await addCredit(ID.faculty1, 'negative', -5, 'pending', { issuedBy: ID.oa1 });
    const res = await api().delete(`${C}/credits/positive/${id}`).set(auth(T.faculty));
    const after = await db.get('credits', id);
    expect([400, 403]).toContain(res.status);
    expect(after.status).toBe('pending');
  });

  test('withdraw own pending positive -> soft void, record kept', async () => {
    const id = await addCredit(ID.faculty1, 'positive', 5, 'pending');
    expect((await api().delete(`${C}/credits/positive/${id}`).set(auth(T.faculty))).status).toBe(200);
    const after = await db.get('credits', id);
    expect(after.status).toBe('deleted');
    expect(after.activityLog?.length).toBe(1);
  });
});

describe('admin review of positive credits', () => {
  const setStatus = (t, id, status) => api().put(`${A}/credits/positive/${id}/status`).set(auth(t)).send({ status });

  test('approve adds the points and keeps the cached total consistent', async () => {
    const id = await addCredit(ID.faculty2, 'positive', 8, 'pending');
    const before = (await db.get('users', ID.faculty2)).currentCredit || 0;
    expect((await setStatus(T.admin, id, 'approved')).status).toBe(200);
    const total = await expectConsistentTotal(ID.faculty2);
    expect(total).toBeGreaterThan(before - 0.0001);
  });

  test('faculty and OA cannot approve (403)', async () => {
    const id = await addCredit(ID.faculty1, 'positive', 8, 'pending');
    expect((await setStatus(T.faculty, id, 'approved')).status).toBe(403);
    expect((await setStatus(T.oa, id, 'approved')).status).toBe(403);
  });

  test('invalid status -> 400; negative credit -> 400; unknown -> 404', async () => {
    expect((await setStatus(T.admin, CREDIT.f1PosPending, 'awesome')).status).toBe(400);
    expect((await setStatus(T.admin, CREDIT.f1NegPending, 'approved')).status).toBe(400);
    expect((await setStatus(T.admin, newId(), 'approved')).status).toBe(404);
  });

  test.failing('[BUG] approving does not record WHO approved it (no audit trail)', async () => {
    const id = await addCredit(ID.faculty2, 'positive', 1, 'pending');
    await setStatus(T.admin, id, 'approved');
    const after = await db.get('credits', id);
    expect(after.approvedBy || after.reviewedBy || after.activityLog).toBeTruthy();
  });

  test.failing('[BUG] a VOIDED credit can be brought back to life by approving it', async () => {
    const id = await addCredit(ID.faculty2, 'positive', 50, 'deleted');
    expect((await setStatus(T.admin, id, 'approved')).status).toBe(409);
  });

  test.failing('[BUG] positive credit can be set to "appealed" (meaningless state)', async () => {
    const id = await addCredit(ID.faculty2, 'positive', 1, 'pending');
    expect((await setStatus(T.admin, id, 'appealed')).status).toBe(400);
  });

  test.failing('[BUG] GET /admin/credits/positive/:id crashes (uses MongoDB .select() on DynamoDB)', async () => {
    expect((await api().get(`${A}/credits/positive/${CREDIT.f1PosApproved}`).set(auth(T.admin))).status).toBe(200);
  });

  test('admin list of positive credits works with filters and paging', async () => {
    const res = await api().get(`${A}/credits/positive?status=pending&limit=2&page=1`).set(auth(T.admin));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.data.every((c) => c.status === 'pending')).toBe(true);
  });

  test('void positive credit (admin) -> deleted with activity log', async () => {
    const id = await addCredit(ID.faculty2, 'positive', 3, 'approved');
    expect((await api().delete(`${A}/credits/positive/${id}`).set(auth(T.admin)).send({ reason: 'duplicate' })).status).toBe(200);
    expect((await db.get('credits', id)).status).toBe('deleted');
    await expectConsistentTotal(ID.faculty2);
  });
});

describe('negative credits (remarks)', () => {
  const issue = (t, body) => api().post(`${A}/credits/negative`).set(auth(t)).send(body);
  const body = { facultyId: ID.faculty2, creditTitleId: TITLE.negLate, academicYear: '2025-2026', notes: 'late' };

  test('OA issues a remark: points come from the title, deduction applies immediately', async () => {
    const res = await issue(T.oa, body);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ type: 'negative', points: -3, status: 'pending', issuedBy: ID.oa1 });
    await expectConsistentTotal(ID.faculty2);
  });

  test('client-supplied points are ignored (cannot inflate a penalty)', async () => {
    const res = await issue(T.admin, { ...body, points: -500 });
    expect(res.body.data.points).toBe(-3);
  });

  test.each([
    [{ ...body, facultyId: ID.admin }, 'target is not faculty'],
    [{ ...body, facultyId: ID.inactive }, 'target inactive'],
    [{ ...body, creditTitleId: TITLE.posPaper }, 'positive title'],
    [{ ...body, creditTitleId: TITLE.inactiveNeg }, 'inactive title'],
    [{ facultyId: ID.faculty2, academicYear: '2025-2026' }, 'missing title'],
  ])('rejected: %s', async (b) => {
    expect((await issue(T.admin, b)).status).toBeGreaterThanOrEqual(400);
  });

  test('faculty cannot issue remarks (403)', async () => {
    expect((await issue(T.faculty, body)).status).toBe(403);
  });

  test('OA list of negative credits contains only their own issued ones', async () => {
    const res = await api().get(`${C}/credits/negative`).set(auth(T.oa));
    expect(res.status).toBe(200);
    expect(res.body.items.every((c) => c.issuedBy === ID.oa1)).toBe(true);
  });

  test('faculty list of negative credits contains only their own', async () => {
    const res = await api().get(`${C}/credits/negative?facultyId=${ID.faculty2}`).set(auth(T.faculty));
    expect(res.body.items.every((c) => c.faculty === ID.faculty1)).toBe(true);
  });

  test.failing('[BUG] GET /admin/credits/negative/:id crashes (MongoDB .select())', async () => {
    expect((await api().get(`${A}/credits/negative/${CREDIT.f1NegPending}`).set(auth(T.admin))).status).toBe(200);
  });

  test.failing('[BUG] GET /admin/credits/negative/:id/faculty crashes when snapshot has no name', async () => {
    const id = await addCredit(ID.faculty1, 'negative', -1, 'pending', { facultySnapshot: {} });
    expect((await api().get(`${A}/credits/negative/${id}/faculty`).set(auth(T.admin))).status).toBe(200);
  });
});

describe('appeals', () => {
  const appeal = (t, id, reason = 'I have evidence this is wrong') =>
    api().post(`${C}/credits/${id}/appeal`).set(auth(t)).send({ reason });
  const decide = (t, id, status) => api().put(`${A}/credits/negative/${id}/appeal`).set(auth(t)).send({ status });

  test('appeal own remark -> appealed; deduction still applies while pending', async () => {
    const id = await addCredit(ID.faculty1, 'negative', -4, 'pending');
    const res = await appeal(T.faculty, id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'appealed', appealCount: 1 });
    await expectConsistentTotal(ID.faculty1);
  });

  test('empty reason -> 400; positive credit -> 400; unknown -> 404', async () => {
    const id = await addCredit(ID.faculty1, 'negative', -4, 'pending');
    expect((await appeal(T.faculty, id, '   ')).status).toBe(400);
    expect((await appeal(T.faculty, CREDIT.f1PosApproved)).status).toBe(400);
    expect((await appeal(T.faculty, newId())).status).toBe(404);
  });

  test("cannot appeal someone else's remark (403)", async () => {
    expect((await appeal(T.faculty, CREDIT.f2NegByOa2)).status).toBe(403);
  });

  test('second appeal while one is pending -> 400', async () => {
    expect((await appeal(T.faculty, CREDIT.f1NegAppealed)).status).toBe(400);
  });

  test('appeal window: 20-day-old remark -> 400; admin re-opens -> allowed', async () => {
    expect((await appeal(T.faculty, CREDIT.f1NegOld)).status).toBe(400);
    expect((await api().patch(`${A}/credits/negative/${CREDIT.f1NegOld}/reopen`).set(auth(T.admin))).status).toBe(200);
    expect((await appeal(T.faculty, CREDIT.f1NegOld)).status).toBe(200);
  });

  test('accepting an appeal removes the deduction; deciding twice -> 409', async () => {
    const id = await addCredit(ID.faculty1, 'negative', -6, 'pending');
    await appeal(T.faculty, id);
    expect((await decide(T.admin, id, 'accepted')).status).toBe(200);
    const after = await db.get('credits', id);
    expect(after.appeal).toMatchObject({ status: 'accepted', reviewedBy: ID.admin });
    await expectConsistentTotal(ID.faculty1);
    expect((await decide(T.admin, id, 'rejected')).status).toBe(409);
  });

  test('two admins deciding the same appeal at the same time: exactly one wins', async () => {
    const id = await addCredit(ID.faculty1, 'negative', -2, 'pending');
    await appeal(T.faculty, id);
    const results = await Promise.all([decide(T.admin, id, 'accepted'), decide(T.superadmin, id, 'rejected')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  test('rejecting keeps the deduction; max 2 appeals', async () => {
    const id = await addCredit(ID.faculty1, 'negative', -2, 'pending');
    await appeal(T.faculty, id);
    await decide(T.admin, id, 'rejected');
    expect((await appeal(T.faculty, id)).status).toBe(200);
    await decide(T.admin, id, 'rejected');
    expect((await appeal(T.faculty, id)).status).toBe(400);
  });

  test('faculty and OA cannot decide appeals (403)', async () => {
    expect((await decide(T.faculty, CREDIT.f1NegAppealed, 'accepted')).status).toBe(403);
    expect((await decide(T.oa, CREDIT.f1NegAppealed, 'accepted')).status).toBe(403);
  });

  test('withdraw pending appeal -> credit back to pending, deduction continues', async () => {
    const id = await addCredit(ID.faculty1, 'negative', -2, 'pending');
    await appeal(T.faculty, id);
    expect((await api().delete(`${C}/credits/appeals/${id}`).set(auth(T.faculty))).status).toBe(200);
    expect((await db.get('credits', id)).status).toBe('pending');
  });

  test.failing('[BUG] withdrawing an appeal on a VOIDED credit brings it back to "pending" (deduction returns)', async () => {
    const id = await addCredit(ID.faculty1, 'negative', -2, 'deleted', {
      appeal: { by: ID.faculty1, reason: 'x', status: 'pending' }, appealCount: 1,
    });
    await api().delete(`${C}/credits/appeals/${id}`).set(auth(T.faculty));
    expect((await db.get('credits', id)).status).toBe('deleted');
  });

  test("OA cannot re-open another OA's remark (403)", async () => {
    expect((await api().patch(`${A}/credits/negative/${CREDIT.f2NegByOa2}/reopen`).set(auth(T.oa))).status).toBe(403);
  });

  test('[DESIGN] re-opening resets the appeal counter to 0 (two more appeals each time)', async () => {
    const id = await addCredit(ID.faculty1, 'negative', -1, 'approved', {
      appealCount: 2, appeal: { by: ID.faculty1, reason: 'x', status: 'rejected' },
    });
    await api().patch(`${A}/credits/negative/${id}/reopen`).set(auth(T.admin));
    // Intentional in code; needs a business decision. Documents current behaviour.
    expect((await db.get('credits', id)).appealCount).toBe(0);
  });
});

describe('OA manages only credits they issued', () => {
  test('edit own issued credit -> 200 with audit event', async () => {
    const id = await addCredit(ID.faculty2, 'negative', -3, 'pending', { issuedBy: ID.oa1 });
    const res = await api().patch(`${A}/oa/credits/issued/${id}`).set(auth(T.oa)).send({ notes: 'corrected', reason: 'typo fix' });
    expect(res.status).toBe(200);
    expect(res.body.data.activityLog.at(-1)).toMatchObject({ action: 'edited', actorId: ID.oa1 });
  });

  test("edit another OA's credit -> 403", async () => {
    expect((await api().patch(`${A}/oa/credits/issued/${CREDIT.f2NegByOa2}`).set(auth(T.oa)).send({ notes: 'x' })).status).toBe(403);
  });

  test('cannot change status/faculty/type directly (400)', async () => {
    const id = await addCredit(ID.faculty2, 'negative', -3, 'pending', { issuedBy: ID.oa1 });
    for (const f of [{ status: 'deleted' }, { faculty: ID.faculty1 }, { type: 'positive' }]) {
      expect((await api().patch(`${A}/oa/credits/issued/${id}`).set(auth(T.oa)).send(f)).status).toBe(400);
    }
  });

  test('cannot set points directly on a negative credit (400)', async () => {
    const id = await addCredit(ID.faculty2, 'negative', -3, 'pending', { issuedBy: ID.oa1 });
    expect((await api().patch(`${A}/oa/credits/issued/${id}`).set(auth(T.oa)).send({ points: 0, reason: 'make it zero' })).status).toBe(400);
  });

  test('void needs a reason of 5+ characters; then the record is kept as deleted', async () => {
    const id = await addCredit(ID.faculty2, 'negative', -3, 'pending', { issuedBy: ID.oa1 });
    expect((await api().delete(`${A}/oa/credits/issued/${id}`).set(auth(T.oa)).send({ reason: 'no' })).status).toBe(400);
    expect((await api().delete(`${A}/oa/credits/issued/${id}`).set(auth(T.oa)).send({ reason: 'issued in error' })).status).toBe(200);
    expect((await db.get('credits', id)).status).toBe('deleted');
  });

  test('two simultaneous edits: optimistic locking lets only one through', async () => {
    const id = await addCredit(ID.faculty2, 'negative', -3, 'pending', { issuedBy: ID.oa1 });
    const res = await Promise.all([1, 2, 3].map((n) =>
      api().patch(`${A}/oa/credits/issued/${id}`).set(auth(T.oa)).send({ notes: `edit ${n}` })));
    expect(res.filter((r) => r.status === 200).length).toBe(1);
    expect(res.filter((r) => r.status === 409).length).toBe(2);
  });

  test('admin/OA direct positive award: capped at MAX_ISSUED_CREDIT_POINTS', async () => {
    const res = await api().post(`${A}/credits/positive`).set(auth(T.oa))
      .send({ facultyId: ID.faculty2, points: 10001, title: 'Too much', academicYear: '2025-2026' });
    expect(res.status).toBe(400);
  });

  test('[DESIGN] an OA can award up to 10,000 positive points with no admin approval', async () => {
    const res = await api().post(`${A}/credits/positive`).set(auth(T.oa))
      .send({ facultyId: ID.faculty2, points: 10000, title: 'Manual award', academicYear: '2025-2026' });
    // Documented as a business-risk finding, not asserted as a bug.
    expect([201, 403]).toContain(res.status);
    expect(res.body.data?.status).toBe('approved');
  });
});

describe('reading credits and totals', () => {
  test("faculty cannot list another faculty's credits (403)", async () => {
    expect((await api().get(`${C}/credits/faculty/${ID.faculty2}`).set(auth(T.faculty))).status).toBe(403);
    expect((await api().get(`${C}/${ID.faculty2}/credits`).set(auth(T.faculty))).status).toBe(403);
    expect((await api().get(`${C}/credits/faculty/${ID.faculty2}/negative`).set(auth(T.faculty))).status).toBe(403);
    expect((await api().get(`${A}/faculty/${ID.faculty2}/credits/negative`).set(auth(T.faculty))).status).toBe(403);
  });

  test("faculty cannot read a single credit belonging to someone else (403)", async () => {
    expect((await api().get(`${C}/credits/${CREDIT.f2PosPending}`).set(auth(T.faculty))).status).toBe(403);
  });

  test("OA cannot read a single credit they did not issue (403)", async () => {
    expect((await api().get(`${C}/credits/${CREDIT.f2NegByOa2}`).set(auth(T.oa))).status).toBe(403);
  });

  test('invalid status filter -> 400', async () => {
    expect((await api().get(`${C}/credits/faculty/${ID.faculty1}?status=hacked`).set(auth(T.faculty))).status).toBe(400);
  });

  test('summary endpoint matches the scoring rules for seeded data', async () => {
    const res = await api().get(`${C}/${ID.faculty1}/credits?recalc=true`).set(auth(T.admin));
    expect(res.status).toBe(200);
    const credits = (await db.scan('credits')).filter((c) => c.faculty === ID.faculty1);
    expect(res.body.data.currentCredit).toBe(processCredits(credits).runningTotal);
  });

  test.failing('[BUG] paging accepts limit=-1 / page=abc without validation', async () => {
    const res = await api().get(`${C}/credits/faculty/${ID.faculty1}?limit=-1&page=abc`).set(auth(T.faculty));
    expect(res.status).toBe(400);
  });

  test('recalc endpoint keeps the cached total consistent', async () => {
    expect((await api().post(`${C}/credits/${ID.faculty1}/recalc-credits`).set(auth(T.admin))).status).toBe(200);
    await expectConsistentTotal(ID.faculty1);
  });
});
