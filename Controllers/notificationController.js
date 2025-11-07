// Controllers/notificationController.js
'use strict';

const fs = require('fs').promises;
const path = require('path');
const User = require('../Models/User'); // your DynamoDB-based User model
const { sendEmail } = require('../utils/email');
const { renderTemplate, escapeHtml } = require('../utils/templateRenderer');

const TEMPLATE_DIR = path.join(__dirname, '..', 'email-templates'); // email-templates/remark-notification.html

/**
 * POST /api/v1/notifications/remark
 */
async function sendRemarkNotification(req, res, next) {
  try {
    const { facultyId } = req.body;
    const remark = req.body.remark || {};
    const { title, message, issuedBy } = remark;

    // find faculty using DynamoDB-backed User model
    // User.findById should return the user item object or null
    const faculty = await User.findById(facultyId);
    if (!faculty || !faculty.email) {
      return res.status(404).json({ success: false, message: 'Faculty not found or has no email' });
    }

    // Build model for template rendering — escape user content to avoid HTML injection
    const model = {
      facultyName: faculty.name || 'Faculty Member',
      remarkTitle: escapeHtml(String(title || '').trim()),
      remarkMessage: escapeHtml(String(message || '').trim()).replace(/\n/g, '<br/>'),
      issuedBy: escapeHtml(String(issuedBy || req.user?.name || 'Admin')),
      date: new Date().toLocaleString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }),
    };

    // locate template file
    const templatePath = path.join(TEMPLATE_DIR, 'remark-notification.html');

    // read template
    let htmlTemplate;
    try {
      htmlTemplate = await fs.readFile(templatePath, 'utf8');
    } catch (err) {
      // if template not found, fall back to a small inline template
      htmlTemplate = `
        <html>
          <body>
            <p>Dear {{facultyName}},</p>
            <h3>{{remarkTitle}}</h3>
            <p>{{remarkMessage}}</p>
            <p><small>Issued by: {{issuedBy}} on {{date}}</small></p>
          </body>
        </html>
      `;
    }

    // render template (simple placeholder replacement)
    const renderedHtml = renderTemplate(htmlTemplate, model);

    // plain text fallback
    const plainText = `${model.remarkTitle}\n\n${remark.message}\n\nIssued by: ${model.issuedBy} on ${model.date}`;

    // send email
    try {
      await sendEmail({
        to: faculty.email,
        subject: `Remark: ${model.remarkTitle}`,
        text: plainText,
        html: renderedHtml,
      });
    } catch (err) {
      // If sending fails, log and return 502
      console.error('sendRemarkNotification: email send failed', err);
      return res.status(502).json({ success: false, message: 'Failed to send email' });
    }

    // Optionally: persist notification to DB or user inbox (not included; can add)
    return res.json({ success: true, message: 'Remark notification sent' });
  } catch (err) {
    console.error('sendRemarkNotification error:', err);
    return next(err);
  }
}

module.exports = { sendRemarkNotification };
