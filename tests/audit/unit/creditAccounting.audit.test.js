/**
 * Audit: the single source of truth for how much a credit counts.
 * Every type x status x appeal-status combination, plus boundary values.
 */
const { creditImpact } = require('../../../domain/creditAccounting');
const { processCredits } = require('../../../utils/calculateCredits');

const c = (type, status, points, appealStatus) => ({
  _id: 'x', type, status, points, ...(appealStatus ? { appeal: { status: appealStatus } } : {}),
});

describe('creditImpact - positive credits', () => {
  test.each([
    ['approved', 10, 10, 'approved_positive'],
    ['pending', 10, 0, 'positive_not_approved'],
    ['rejected', 10, 0, 'positive_not_approved'],
    ['appealed', 10, 0, 'positive_not_approved'],
    ['deleted', 10, 0, 'deleted'],
  ])('status %s with %d points -> %d (%s)', (status, points, expected, reason) => {
    expect(creditImpact(c('positive', status, points))).toEqual({ points: expected, reason });
  });

  test('a positive credit stored with negative points still counts as positive magnitude', () => {
    expect(creditImpact(c('positive', 'approved', -10)).points).toBe(10);
  });

  test('status and type are case-insensitive', () => {
    expect(creditImpact(c('POSITIVE', 'Approved', 4)).points).toBe(4);
  });
});

describe('creditImpact - negative credits', () => {
  test.each([
    ['pending', undefined, -3, 'issued_negative'],
    ['approved', undefined, -3, 'issued_negative'],
    ['rejected', undefined, 0, 'negative_not_active'],
    ['deleted', undefined, 0, 'deleted'],
    ['appealed', 'pending', -3, 'appeal_pending'],
    ['rejected', 'accepted', 0, 'appeal_accepted'],
    ['approved', 'rejected', -3, 'appeal_rejected'],
    ['rejected', 'rejected', 0, 'credit_revoked'],
    ['pending', 'withdrawn', -3, 'appeal_withdrawn'],
    ['pending', 'mystery', 0, 'unknown_appeal_status'],
    ['deleted', 'pending', 0, 'deleted'],
  ])('status %s / appeal %s -> %d (%s)', (status, appeal, expected, reason) => {
    expect(creditImpact(c('negative', status, -3, appeal))).toEqual({ points: expected, reason });
  });

  test('a negative credit stored with POSITIVE points still deducts', () => {
    expect(creditImpact(c('negative', 'pending', 3)).points).toBe(-3);
  });
});

describe('creditImpact - invalid input', () => {
  test.each([[NaN], ['abc'], [undefined], [Infinity], [-Infinity]])('points=%p throws', (p) => {
    expect(() => creditImpact(c('positive', 'approved', p))).toThrow(/Invalid points/);
  });
  test('null points are treated as 0 (Number(null) === 0)', () => {
    expect(creditImpact(c('positive', 'approved', null)).points).toBe(0);
  });
  test('numeric strings are accepted', () => {
    expect(creditImpact(c('positive', 'approved', '7.5')).points).toBe(7.5);
  });
  test('unknown type counts 0', () => {
    expect(creditImpact(c('bonus', 'approved', 5))).toEqual({ points: 0, reason: 'unknown_type' });
  });
  test('zero points count zero', () => {
    expect(creditImpact(c('negative', 'pending', 0)).points === 0).toBe(true);
  });
});

describe('processCredits - totals', () => {
  test('empty list gives all zeros', () => {
    const r = processCredits([]);
    expect(r).toMatchObject({ runningTotal: 0, totalPositive: 0, totalNegative: 0, eventsApplied: 0 });
  });

  test('mixed credits across years', () => {
    const r = processCredits([
      { ...c('positive', 'approved', 10), academicYear: '2024-2025' },
      { ...c('positive', 'pending', 99), academicYear: '2024-2025' },
      { ...c('negative', 'pending', -3), academicYear: '2024-2025' },
      { ...c('positive', 'approved', 5), academicYear: '2025-2026' },
      { ...c('negative', 'rejected', -4, 'accepted'), academicYear: '2025-2026' },
    ]);
    expect(r.runningTotal).toBe(12);
    expect(r.totalPositive).toBe(15);
    expect(r.totalNegative).toBe(3);
    expect(r.netByYear).toEqual({ '2024-2025': 7, '2025-2026': 5 });
    expect(r.excludedByReason).toEqual({ positive_not_approved: 1, appeal_accepted: 1 });
  });

  test('decimal precision: 0.1 + 0.2 = 0.3 exactly', () => {
    const r = processCredits([c('positive', 'approved', 0.1), c('positive', 'approved', 0.2)]);
    expect(r.runningTotal).toBe(0.3);
  });

  test('missing academic year is grouped as "unknown"', () => {
    const r = processCredits([c('positive', 'approved', 1)]);
    expect(r.netByYear).toEqual({ unknown: 1 });
  });

  test('ONE corrupt credit (non-numeric points) makes the whole calculation throw', () => {
    // Documents fragility: a single bad record blocks the faculty's total from updating.
    expect(() => processCredits([c('positive', 'approved', 5), c('positive', 'pending', 'abc')])).toThrow();
  });

  test('large boundary values', () => {
    const r = processCredits([c('positive', 'approved', 10000), c('negative', 'pending', -10000)]);
    expect(r.runningTotal).toBe(0);
  });
});
