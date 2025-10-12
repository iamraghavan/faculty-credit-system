// Middleware/validateMiddleware.js
/**
 * Simple middleware factory that receives a Joi schema and runs validation.
 */
function validate(schema) {
  return (req, res, next) => {
    const source = {
      body: req.body,
      params: req.params,
      query: req.query,
    };

    const { error } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map((d) => d.message);
      return res.status(400).json({ success: false, message: 'Validation error', errors: messages });
    }

    next();
  };
}

module.exports = validate;
