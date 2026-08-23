const { v4: uuid } = require('uuid');
const CreditPolicy = require('../Models/CreditPolicy');
const { policySchema } = require('../utils/creditPolicySchema');
const { evaluateCreditRule, policyHash } = require('../domain/policy/creditPolicyEngine');

function httpError(status, message) {
  const error = new Error(message); error.status = status; return error;
}

function validatePolicy(payload) {
  const { value, error } = policySchema.validate(payload, { abortEarly: false, stripUnknown: true });
  if (error) throw httpError(400, error.details.map(item => item.message).join('; '));
  return value;
}

function scopesOverlap(left, right) {
  return ['colleges', 'departments', 'designations'].every(field => {
    const a = left?.[field] || ['ALL']; const b = right?.[field] || ['ALL'];
    return a.includes('ALL') || b.includes('ALL') || a.some(value => b.includes(value));
  });
}

function datesOverlap(left, right) {
  const endA = left.effectiveTo ? new Date(left.effectiveTo).getTime() : Infinity;
  const endB = right.effectiveTo ? new Date(right.effectiveTo).getTime() : Infinity;
  return new Date(left.effectiveFrom).getTime() <= endB && new Date(right.effectiveFrom).getTime() <= endA;
}

async function listPolicies(req, res) {
  const policies = await CreditPolicy.find(req.query.status ? { status: req.query.status } : {});
  policies.sort((a, b) => b.version - a.version || String(a.name).localeCompare(String(b.name)));
  res.json({ success: true, policies });
}

async function getPolicy(req, res) {
  const policy = await CreditPolicy.findByVersion(req.params.policyId, Number(req.params.version));
  if (!policy) throw httpError(404, 'Credit policy version not found');
  res.json({ success: true, policy });
}

async function createPolicy(req, res) {
  const definition = validatePolicy(req.body);
  const now = new Date().toISOString();
  const policy = await CreditPolicy.create({
    ...definition, policyId: req.body.policyId || uuid(), version: 1, revision: 1,
    status: 'draft', createdAt: now, updatedAt: now, createdBy: req.user._id,
  });
  res.status(201).json({ success: true, policy });
}

async function createVersion(req, res) {
  const versions = await CreditPolicy.find({ policyId: req.params.policyId });
  if (!versions.length) throw httpError(404, 'Credit policy not found');
  const source = versions.sort((a, b) => b.version - a.version)[0];
  const definition = validatePolicy({ ...source, ...req.body });
  const now = new Date().toISOString();
  const policy = await CreditPolicy.create({
    ...definition, policyId: source.policyId, version: source.version + 1, revision: 1,
    status: 'draft', previousVersion: source.version, createdAt: now, updatedAt: now, createdBy: req.user._id,
  });
  res.status(201).json({ success: true, policy });
}

async function updateDraft(req, res) {
  const current = await CreditPolicy.findByVersion(req.params.policyId, Number(req.params.version));
  if (!current) throw httpError(404, 'Credit policy version not found');
  const definition = validatePolicy({ ...current, ...req.body });
  try {
    const policy = await CreditPolicy.updateDraft(current.policyId, current.version, definition, Number(req.body.revision || current.revision));
    res.json({ success: true, policy });
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') throw httpError(409, 'Draft changed or is no longer editable; reload and retry');
    throw error;
  }
}

async function publishPolicy(req, res) {
  const policy = await CreditPolicy.findByVersion(req.params.policyId, Number(req.params.version));
  if (!policy) throw httpError(404, 'Credit policy version not found');
  validatePolicy(policy);
  const published = await CreditPolicy.find({ status: 'published' });
  const conflict = published.find(item => scopesOverlap(item.scope, policy.scope) && datesOverlap(item, policy));
  if (conflict) throw httpError(409, `Effective dates and scope overlap published policy ${conflict.policyId} v${conflict.version}`);
  try {
    const now = new Date().toISOString();
    const updated = await CreditPolicy.changeStatus(policy.policyId, policy.version, 'draft', 'published', {
      publishedAt: now, publishedBy: req.user._id, contentHash: policyHash({ ...policy, status: 'published' }),
    });
    res.json({ success: true, policy: updated });
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') throw httpError(409, 'Only a draft policy can be published');
    throw error;
  }
}

async function retirePolicy(req, res) {
  try {
    const policy = await CreditPolicy.changeStatus(req.params.policyId, Number(req.params.version), 'published', 'retired', {
      retiredAt: new Date().toISOString(), retiredBy: req.user._id,
    });
    res.json({ success: true, policy });
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') throw httpError(409, 'Only a published policy can be retired');
    throw error;
  }
}

async function previewCalculation(req, res) {
  const policy = await CreditPolicy.findByVersion(req.params.policyId, Number(req.params.version));
  if (!policy) throw httpError(404, 'Credit policy version not found');
  try {
    const result = evaluateCreditRule(policy, req.body.ruleId, req.body.facts || {}, {
      alreadyAwarded: req.body.alreadyAwarded, allowDraft: policy.status === 'draft',
    });
    res.json({ success: true, policy: { policyId: policy.policyId, version: policy.version, contentHash: policy.contentHash || null }, result });
  } catch (error) { throw httpError(400, error.message); }
}

module.exports = { listPolicies, getPolicy, createPolicy, createVersion, updateDraft, publishPolicy, retirePolicy, previewCalculation };
