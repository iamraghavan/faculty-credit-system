const Joi = require('joi');

const shortText = Joi.string().trim().max(200).allow('', null);
const url = Joi.string().trim().uri({ scheme: ['http', 'https'] }).max(500).allow('', null);

const professionalProfileSchema = Joi.object({
  biography: Joi.string().trim().max(2000).allow('', null),
  expertise: Joi.array().items(Joi.string().trim().min(1).max(100)).max(30),
  researchInterests: Joi.array().items(Joi.string().trim().min(1).max(150)).max(30),
  qualifications: Joi.array().items(Joi.object({
    degree: Joi.string().trim().max(150).required(),
    specialization: shortText,
    institution: Joi.string().trim().max(250).required(),
    year: Joi.number().integer().min(1950).max(2200).allow(null),
  })).max(25),
  researchIds: Joi.object({
    orcid: Joi.string().trim().pattern(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i).allow('', null),
    scopus: shortText,
    researcherId: shortText,
    googleScholarUrl: url,
  }),
  professionalLinks: Joi.object({ linkedin: url, website: url }),
}).min(1);

const employmentSchema = Joi.object({
  employeeId: Joi.string().trim().max(100).required(),
  employmentType: Joi.string().valid('permanent', 'contract', 'visiting', 'adjunct', 'temporary', 'other').required(),
  status: Joi.string().valid('active', 'leave', 'inactive', 'retired', 'separated').required(),
  college: Joi.string().trim().max(250).required(),
  department: Joi.string().trim().max(250).required(),
  designation: Joi.string().trim().max(200).required(),
  joiningDate: Joi.date().iso().required(),
  effectiveFrom: Joi.date().iso().required(),
  effectiveTo: Joi.date().iso().allow(null),
}).custom((value, helpers) => {
  if (value.effectiveTo && new Date(value.effectiveTo) < new Date(value.effectiveFrom)) {
    return helpers.error('any.invalid');
  }
  return value;
});

module.exports = { professionalProfileSchema, employmentSchema };
