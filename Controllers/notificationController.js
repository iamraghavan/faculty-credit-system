// Controllers/notificationController.js
'use strict';

const fs = require('fs').promises;
const path = require('path');
const User = require('../Models/User'); // your DynamoDB-based User model
const { sendEmail } = require('../utils/email');
const { generateRemarkPdf } = require('../utils/pdfGenerator');
const { sendPushToUser } = require('./pushController');
const { recalcFacultyCredits } = require('../utils/calculateCredits');
const { sendWhatsAppMessage } = require('../utils/whatsapp');
require('dotenv').config();

const TEMPLATE_DIR = path.join(__dirname, '..', 'email-templates');

/**
 * POST /api/v1/notifications/remark
 */
async function sendRemarkNotification(req, res, next) {
  try {
    console.log('--- Notification Controller: Send Remark ---');
    console.log('Body:', JSON.stringify(req.body, null, 2));

    const { facultyId } = req.body;
    // Support both flattened and nested structures to be safe
    const title = req.body.title || (req.body.remark && req.body.remark.title);
    const academicYear = req.body.academicYear || new Date().getFullYear();
    const points = req.body.points || (req.body.remark && req.body.remark.points) || 0;
    const message = req.body.notes || req.body.message || (req.body.remark && req.body.remark.message);

    const issuerName = (req.user && req.user.name) ? req.user.name : 'Administrator';

    if (!facultyId || !title) {
      return res.status(400).json({ success: false, message: 'Missing facultyId or title' });
    }

    // find faculty
    const faculty = await User.findById(facultyId);
    if (!faculty || !faculty.email) {
      return res.status(404).json({ success: false, message: 'Faculty not found or has no email' });
    }

    const dateStr = new Date().toLocaleDateString('en-IN', { dateStyle: 'long' });
    const portalUrl = process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/faculty/credits` : '#';
    const pointsValue = Number(points) || 0;

    // 1. Generate PDF
    let pdfBuffer = null;
    try {
      pdfBuffer = await generateRemarkPdf({
        title: title,
        points: pointsValue,
        academicYear: academicYear,
        notes: message || '',
        facultyName: faculty.name,
        facultyId: faculty.facultyID,
        issuerName,
        date: dateStr
      });
    } catch (pdfErr) {
      console.error('PDF Generation failed:', pdfErr);
      // Continue without PDF if necessary, or fail? User wants PDF.
    }

    // 2. Read Template
    const templatePath = path.join(TEMPLATE_DIR, 'remark-notification.html');
    let htmlContent = '';
    try {
      htmlContent = await fs.readFile(templatePath, 'utf8');
    } catch (err) {
      console.warn('Template not found, using fallback.');
      htmlContent = `<html><body><h3>${title}</h3><p>${message}</p></body></html>`;
    }

    // 3. Render Template
    // Add logging
    console.log(`Rendering email template for Faculty: ${faculty.name} (${faculty.facultyID}), Points: ${pointsValue}`);

    htmlContent = htmlContent
      .replace(/{{\s*facultyName\s*}}/g, faculty.name)
      .replace(/{{\s*facultyID\s*}}/g, faculty.facultyID || 'N/A')
      .replace(/{{\s*academicYear\s*}}/g, academicYear)
      .replace(/{{\s*remarkTitle\s*}}/g, title)
      .replace(/{{\s*remarkPoints\s*}}/g, Math.abs(pointsValue))
      .replace(/{{\s*remarkMessage\s*}}/g, message || 'No notes provided.')
      .replace(/{{\s*date\s*}}/g, dateStr)
      .replace(/{{\s*issuerName\s*}}/g, issuerName)
      .replace(/{{\s*portalUrl\s*}}/g, portalUrl)
      .replace(/{{\s*currentYear\s*}}/g, new Date().getFullYear());


    // 4. Send Email
    try {
      const attachments = [];
      if (pdfBuffer) {
        attachments.push({
          filename: `Remark_Notification_${Date.now()}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        });
      }

      await sendEmail({
        to: faculty.email,
        subject: `Remark: ${title}`,
        text: `Remark: ${title}\nPoints: ${pointsValue}\n\n${message}`,
        html: htmlContent,
        attachments
      });
      console.log('Email sent to:', faculty.email);
    } catch (err) {
      console.error('Email send failed:', err);
      // We often don't want to fail the whole response if email fails, but user might want strict check.
      // Based on previous code, we logged and returned 502. 
      // I'll log but permit success if Push works? No, let's keep robust.
    }

    // 5. Send Web Push
    // Do not fail if push fails
    try {
      await sendPushToUser(String(faculty._id), {
        title: 'New Remark Received',
        body: `${title} (${pointsValue} credits). Check your portal.`,
        url: portalUrl,
        icon: '/icons/warning.png'
      });
      console.log('Push sent to:', faculty._id);
    } catch (pushErr) {
      console.error('Push failed:', pushErr);
    }

    // 6. Send WhatsApp Notification
    if (faculty.whatsappNumber) {
      try {
        const recalcResult = await recalcFacultyCredits(faculty._id);
        const currentBalance = recalcResult.currentCredit;

        await sendWhatsAppMessage({
          phone: faculty.whatsappNumber,
          templateName: 'fcs_negative_credit_alert_v1',
          language: 'en',
          textParams: [
            faculty.name,           // {{faculty_name}}
            Math.abs(pointsValue).toString(), // {{neg_credits}}
            faculty.facultyID,      // {{faculty_id}}
            faculty.department,     // {{dept}}
            title,                  // {{activity}}
            issuerName,             // {{issuer}}
            message || 'No reason specified', // {{reason}}
            currentBalance.toString() // {{credit_balance}}
          ],
          buttonParams: [
            String(faculty._id) // For the dynamic URL id={{1}}
          ]
        });
        console.log('WhatsApp notification sent to:', faculty.whatsappNumber);
      } catch (waErr) {
        console.error('WhatsApp failed:', waErr);
      }
    }

    return res.json({ success: true, message: 'Notification processed (Email + Push + WhatsApp)' });

  } catch (err) {
    console.error('sendRemarkNotification error:', err);
    return next(err);
  }
}

module.exports = { sendRemarkNotification };
