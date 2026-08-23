const crypto = require('crypto');
const { canonicalJson } = require('../../utils/exportVerification');

function valueAt(source, path) {
  return path.split('.').reduce((value, key) => value?.[key], source);
}

function evaluateCondition(condition, facts) {
  const actual = valueAt(facts, condition.field);
  switch (condition.operator) {
    case 'equals': return actual === condition.value;
    case 'not_equals': return actual !== condition.value;
    case 'in': return Array.isArray(condition.value) && condition.value.includes(actual);
    case 'greater_than': return Number(actual) > Number(condition.value);
    case 'greater_or_equal': return Number(actual) >= Number(condition.value);
    case 'less_than': return Number(actual) < Number(condition.value);
    case 'less_or_equal': return Number(actual) <= Number(condition.value);
    default: return false;
  }
}

function evaluateCreditRule(policy, ruleId, facts, context = {}) {
  if (policy.status !== 'published' && !context.allowDraft) throw new Error('Only published policies can calculate official credits');
  const rule = policy.rules.find(item => item.ruleId === ruleId);
  if (!rule) throw new Error(`Rule not found: ${ruleId}`);
  const eligibilityChecks = (rule.eligibility?.all || []).map(condition => ({ condition, passed: evaluateCondition(condition, facts) }));
  const eligible = eligibilityChecks.every(check => check.passed);
  const suppliedEvidence = new Set(Array.isArray(facts.evidenceTypes) ? facts.evidenceTypes : []);
  const evidenceChecks = (rule.requiredEvidence || []).map(item => ({ ...item, present: suppliedEvidence.has(item.type) }));
  const evidenceSatisfied = evidenceChecks.every(item => !item.required || item.present);
  if (!eligible || !evidenceSatisfied) {
    return { eligible, evidenceSatisfied, eligibilityChecks, evidenceChecks, calculation: null, explanation: ['Credit cannot be calculated until eligibility and evidence requirements pass.'] };
  }

  const appliedMultipliers = (rule.calculation.multiplierRules || []).filter(item => evaluateCondition(item.when, facts));
  const multiplier = appliedMultipliers.reduce((result, item) => result * item.multiplier, 1);
  const scale = rule.calculation.roundingScale ?? 2;
  const round = value => Number(Number(value).toFixed(scale));
  const basePoints = Number(rule.calculation.basePoints);
  const preCapPoints = round(basePoints * multiplier);
  const eventCap = rule.calculation.perEventCap;
  const afterEventCap = eventCap == null ? preCapPoints : Math.min(preCapPoints, Number(eventCap));
  const alreadyAwarded = Math.max(0, Number(context.alreadyAwarded) || 0);
  const remainingPeriodCap = rule.calculation.periodCap == null ? null : Math.max(0, Number(rule.calculation.periodCap) - alreadyAwarded);
  const magnitude = round(remainingPeriodCap == null ? afterEventCap : Math.min(afterEventCap, remainingPeriodCap));
  const signedImpact = rule.creditType === 'negative' ? -magnitude : magnitude;
  return {
    eligible: true, evidenceSatisfied: true, eligibilityChecks, evidenceChecks,
    calculation: { basePoints, multiplier, preCapPoints, eventCap: eventCap ?? null, remainingPeriodCap, magnitude, signedImpact },
    explanation: [
      `Base points: ${basePoints}`,
      ...appliedMultipliers.map(item => `${item.label}: x${item.multiplier}`),
      eventCap != null && afterEventCap < preCapPoints ? `Per-event cap applied: ${eventCap}` : 'No per-event cap reduction',
      remainingPeriodCap != null && magnitude < afterEventCap ? `Period cap remaining: ${remainingPeriodCap}` : 'No period cap reduction',
      `Final signed impact: ${signedImpact > 0 ? '+' : ''}${signedImpact}`,
    ],
  };
}

function policyHash(policy) {
  const content = { ...policy };
  delete content.contentHash; delete content.updatedAt; delete content.publishedAt; delete content.publishedBy;
  return crypto.createHash('sha256').update(canonicalJson(content)).digest('hex');
}

module.exports = { evaluateCondition, evaluateCreditRule, policyHash };
