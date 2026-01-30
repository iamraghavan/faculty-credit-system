const Joi = require('joi');

const schemas = {
  creditTitle: {
    create: Joi.object({
      title: Joi.string().required().min(3).max(100),
      points: Joi.number().required().integer(),
      type: Joi.string().valid('positive', 'negative').default('positive'),
      description: Joi.string().allow('').optional()
    }),
    update: Joi.object({
      title: Joi.string().min(3).max(100),
      points: Joi.number().integer(),
      type: Joi.string().valid('positive', 'negative'),
      description: Joi.string().allow('').optional()
    })
  },
  issueCredit: {
    positive: Joi.object({
      title: Joi.string().required(),
      points: Joi.number().required().positive(),
      categories: Joi.alternatives().try(Joi.array().items(Joi.string()), Joi.string()),
      academicYear: Joi.string().required(),
      notes: Joi.string().optional()
    }),
    negative: Joi.object({
      facultyId: Joi.string().required(),
      creditTitleId: Joi.string().required(),
      academicYear: Joi.string().required(),
      notes: Joi.string().optional(),
      points: Joi.number().optional(), // sometimes overridden
      title: Joi.string().optional()
    })
  },
  auth: {
    register: Joi.object({
      name: Joi.string().required(),
      email: Joi.string().email().required(),
      password: Joi.string().min(6).required(),
      college: Joi.string().required(),
      department: Joi.string().optional(),
      role: Joi.string().valid('admin', 'faculty', 'oa').optional()
    }),
    login: Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().required(),
      token: Joi.string().optional(), // MFA token
      turnstileToken: Joi.string().optional() // Cloudflare Turnstile token
    })
  }
};

module.exports = { schemas };
