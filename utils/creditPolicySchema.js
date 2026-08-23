const Joi = require('joi');

const condition = Joi.object({
  field: Joi.string().pattern(/^[a-zA-Z][a-zA-Z0-9_.]{0,99}$/).required(),
  operator: Joi.string().valid('equals', 'not_equals', 'in', 'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal').required(),
  value: Joi.any().required(),
});

const rule = Joi.object({
  ruleId: Joi.string().pattern(/^[a-z0-9][a-z0-9._-]{2,99}$/).required(),
  titleId: Joi.string().trim().max(100).allow(null, ''),
  name: Joi.string().trim().min(3).max(250).required(),
  creditType: Joi.string().valid('positive', 'negative').required(),
  eligibility: Joi.object({ all: Joi.array().items(condition).max(30).default([]) }).default({ all: [] }),
  requiredEvidence: Joi.array().items(Joi.object({
    type: Joi.string().trim().max(100).required(),
    required: Joi.boolean().default(true),
  })).max(20).default([]),
  calculation: Joi.object({
    basePoints: Joi.number().min(0).max(100000).required(),
    multiplierRules: Joi.array().items(Joi.object({ when: condition.required(), multiplier: Joi.number().min(0).max(100).required(), label: Joi.string().max(200).required() })).max(20).default([]),
    perEventCap: Joi.number().positive().max(100000).allow(null).default(null),
    periodCap: Joi.number().positive().max(100000).allow(null).default(null),
    roundingScale: Joi.number().integer().min(0).max(4).default(2),
  }).required(),
  approvalPath: Joi.array().items(Joi.object({
    order: Joi.number().integer().min(1).required(), role: Joi.string().valid('oa', 'admin', 'superadmin').required(),
    action: Joi.string().valid('verify_evidence', 'review', 'approve').required(),
    whenPointsAbove: Joi.number().min(0).allow(null),
  })).max(10).default([]),
});

const policySchema = Joi.object({
  name: Joi.string().trim().min(3).max(250).required(),
  description: Joi.string().trim().max(2000).allow('', null),
  effectiveFrom: Joi.date().iso().required(),
  effectiveTo: Joi.date().iso().allow(null).required(),
  timezone: Joi.string().trim().max(100).default('Asia/Kolkata'),
  scope: Joi.object({
    colleges: Joi.array().items(Joi.string().trim().max(250)).min(1).default(['ALL']),
    departments: Joi.array().items(Joi.string().trim().max(250)).min(1).default(['ALL']),
    designations: Joi.array().items(Joi.string().trim().max(200)).min(1).default(['ALL']),
  }).default({ colleges: ['ALL'], departments: ['ALL'], designations: ['ALL'] }),
  rules: Joi.array().items(rule).min(1).max(500).required(),
}).custom((value, helpers) => {
  if (value.effectiveTo && new Date(value.effectiveTo) < new Date(value.effectiveFrom)) return helpers.error('any.invalid');
  const ruleIds = value.rules.map(item => item.ruleId);
  if (new Set(ruleIds).size !== ruleIds.length) return helpers.error('any.invalid');
  return value;
});

module.exports = { policySchema };
