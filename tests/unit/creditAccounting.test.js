const { creditImpact } = require('../../domain/creditAccounting');
const { processCredits } = require('../../utils/calculateCredits');

const credit = (type, status, points, appealStatus, academicYear = '2026-2027') => ({
  type, status, points, academicYear,
  ...(appealStatus ? { appeal: { status: appealStatus } } : {}),
});

describe('faculty credit accounting', () => {
  test('deducts an issued negative credit, regardless of the stored sign', () => {
    expect(creditImpact(credit('negative', 'pending', 5)).points).toBe(-5);
    expect(creditImpact(credit('negative', 'approved', -5)).points).toBe(-5);
  });

  test('keeps pending appeals deducted, voids accepted appeals, and keeps rejected appeals deducted', () => {
    expect(creditImpact(credit('negative', 'appealed', 5, 'pending')).points).toBe(-5);
    expect(creditImpact(credit('negative', 'pending', 5, 'accepted')).points).toBe(0);
    expect(creditImpact(credit('negative', 'appealed', 5, 'rejected')).points).toBe(-5);
    expect(creditImpact(credit('negative', 'pending', 5, 'withdrawn')).points).toBe(-5);
    expect(creditImpact(credit('negative', 'deleted', 5, 'rejected')).points).toBe(0);
  });

  test('counts only approved positive credits and rejects invalid points', () => {
    expect(creditImpact(credit('positive', 'approved', 8)).points).toBe(8);
    expect(creditImpact(credit('positive', 'pending', 8)).points).toBe(0);
    expect(() => creditImpact(credit('negative', 'pending', 'bad'))).toThrow('Invalid points');
  });

  test('keeps separate effective totals and annual nets', () => {
    const result = processCredits([
      credit('positive', 'approved', 12),
      credit('positive', 'pending', 9),
      credit('negative', 'pending', 5),
      credit('negative', 'appealed', 7, 'pending'),
      credit('negative', 'pending', 9, 'accepted'),
      credit('negative', 'appealed', -3, 'rejected'),
      credit('negative', 'deleted', 4, undefined, '2025-2026'),
    ]);
    expect(result).toMatchObject({ totalPositive: 12, totalNegative: 15, runningTotal: -3, eventsApplied: 4 });
    expect(result.positiveByYear['2026-2027']).toBe(12);
    expect(result.negativeByYear['2026-2027']).toBe(15);
    expect(result.netByYear['2026-2027']).toBe(-3);
    expect(result.excludedByReason).toMatchObject({ appeal_accepted: 1 });
  });
});
