// Middleware/errorMiddleware.js
function errorHandler(err, req, res, next) {
  if (err.name === 'ConditionalCheckFailedException')
    return res.status(409).json({ success: false, message: 'This record changed. Reload and try again.' });
  if (err.name === 'ResourceNotFoundException') {
    console.error(`Required application storage is missing for ${req.method} ${req.path}`);
    return res
      .status(503)
      .json({ success: false, message: 'Application storage is unavailable. Contact the site administrator.' });
  }
  if (['UnrecognizedClientException', 'InvalidClientTokenId', 'ExpiredTokenException'].includes(err.name || err.code)) {
    console.error(`DynamoDB authentication failed: ${err.name || err.code}`);
    return res.status(503).json({
      success: false,
      message: 'DynamoDB rejected the configured AWS credentials. Contact the administrator.',
    });
  }

  console.error(err);
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  const payload = { success: false, message };

  if (process.env.NODE_ENV !== 'production') {
    payload.stack = err.stack;
  }

  res.status(status).json(payload);
}

module.exports = { errorHandler };
