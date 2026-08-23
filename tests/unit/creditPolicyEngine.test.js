jest.mock('../../utils/exportVerification', () => ({ canonicalJson: value => JSON.stringify(value) }));
const { evaluateCreditRule, policyHash } = require('../../domain/policy/creditPolicyEngine');

const policy = { status: 'published', policyId: 'research', version: 2, rules: [{
  ruleId: 'journal', name: 'Journal publication', creditType: 'positive',
  eligibility: { all: [{ field: 'indexed', operator: 'equals', value: true }] },
  requiredEvidence: [{ type: 'doi', required: true }],
  calculation: { basePoints: 10, multiplierRules: [{ when: { field: 'quartile', operator: 'equals', value: 'Q1' }, multiplier: 2, label: 'Q1 journal' }], perEventCap: 15, periodCap: 40, roundingScale: 2 },
} ] };

describe('credit policy engine', () => {
  test('explains multiplier, event cap, period cap and positive sign', () => {
    const result = evaluateCreditRule(policy, 'journal', { indexed: true, quartile: 'Q1', evidenceTypes: ['doi'] }, { alreadyAwarded: 30 });
    expect(result.calculation).toMatchObject({ basePoints: 10, multiplier: 2, preCapPoints: 20, magnitude: 10, signedImpact: 10 });
    expect(result.explanation.join(' ')).toContain('Final signed impact: +10');
  });

  test('returns no calculation when required evidence is absent', () => {
    expect(evaluateCreditRule(policy, 'journal', { indexed: true }).calculation).toBeNull();
  });

  test('negative rules store a signed negative impact', () => {
    const negative = { ...policy, rules: [{ ...policy.rules[0], creditType: 'negative', requiredEvidence: [] }] };
    expect(evaluateCreditRule(negative, 'journal', { indexed: true }).calculation.signedImpact).toBe(-10);
  });

  test('policy content hash is stable', () => expect(policyHash(policy)).toHaveLength(64));
});
