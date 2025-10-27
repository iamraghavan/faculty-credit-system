// middlewares/ipToDomainRedirect.js

module.exports = function ipToDomainRedirect(req, res, next) {
  // Check if the request was made directly to the server's local IP
  if (req.hostname === '172.16.20.129') {
    return res.redirect('http://fcs.egspgroup.in' + req.originalUrl);
  }
  next();
};
