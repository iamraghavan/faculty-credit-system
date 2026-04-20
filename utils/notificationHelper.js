// utils/notificationHelper.js
'use strict';

const fs = require('fs').promises;
const path = require('path');
const { sendEmail } = require('./email');
const { generateRemarkPdf } = require('./pdfGenerator');
const { sendPushToUser } = require('../Controllers/pushController');
const { recalcFacultyCredits } = require('./calculateCredits');
const { sendWhatsAppMessage } = require('./whatsapp');

/**
 * Consolidated Helper to send all remark notifications (Email, PDF, Push, WhatsApp)
 */
async function sendRemarkNotificationHelper({
  faculty,
  title,
  points,
  academicYear,
  notes,
  issuerName,
  portalUrl
}) {
  const dateStr = new Date().toLocaleDateString('en-IN', { dateStyle: 'long' });
  const pointsValue = Number(points) || 0;
  const facultyId = faculty._id;

  try {
    // 1. Generate PDF
    let pdfBuffer = null;
    try {
      pdfBuffer = await generateRemarkPdf({
        title,
        points: pointsValue,
        academicYear,
        notes: notes || '',
        facultyName: faculty.name,
        facultyId: faculty.facultyID,
        issuerName,
        date: dateStr
      });
    } catch (pdfErr) {
      console.error('PDF Generation failed:', pdfErr);
    }

    // 2. Read and Render HTML Template
    const templatePath = path.resolve(process.cwd(), 'email-templates', 'remark-notification.html');
    let htmlContent = '';
    try {
      htmlContent = await fs.readFile(templatePath, 'utf8');
      htmlContent = htmlContent
        .replace(/{{\s*facultyName\s*}}/g, faculty.name || 'Faculty Member')
        .replace(/{{\s*facultyID\s*}}/g, faculty.facultyID || 'N/A')
        .replace(/{{\s*remarkTitle\s*}}/g, title)
        .replace(/{{\s*remarkPoints\s*}}/g, Math.abs(pointsValue))
        .replace(/{{\s*remarkMessage\s*}}/g, notes || 'No additional notes provided.')
        .replace(/{{\s*date\s*}}/g, dateStr)
        .replace(/{{\s*academicYear\s*}}/g, academicYear || 'N/A')
        .replace(/{{\s*issuerName\s*}}/g, issuerName)
        .replace(/{{\s*portalUrl\s*}}/g, portalUrl || '#')
        .replace(/{{\s*currentYear\s*}}/g, new Date().getFullYear());
    } catch (err) {
      console.warn('Email template not found or failed to render:', err);
      htmlContent = `<p>Dear ${faculty.name},</p><p>A remark has been recorded: ${title}</p><p>Points: ${pointsValue}</p>`;
    }

    // 3. Send Email
    try {
      await sendEmail({
        to: faculty.email,
        subject: `Startling Alert - Remark Notification: ${title}`,
        text: `Remark Notification: ${title}\nPoints: ${pointsValue}\nPlease check the attached PDF for details.`,
        html: htmlContent,
        attachments: pdfBuffer ? [
          {
            filename: `Remark_Notification_${Date.now()}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf'
          }
        ] : []
      });
      console.log('Remark notification email sent to:', faculty.email);
    } catch (emailErr) {
      console.error('Email send failed:', emailErr);
    }

    // 4. Send Web Push
    try {
      await sendPushToUser(String(facultyId), {
        title: 'New Remark Received',
        body: `${title} (${pointsValue} points). Check your portal.`,
        url: portalUrl || '#',
        icon: '/icons/warning.png'
      });
    } catch (pushErr) {
      console.error('Push notification failed:', pushErr);
    }

    // 5. Send WhatsApp
    if (faculty.whatsappNumber) {
      try {
        const recalcResult = await recalcFacultyCredits(facultyId);
        // Fix: Use netTotal or runningTotal from recalcResult
        const currentBalance = recalcResult.netTotal || recalcResult.runningTotal || 0;

        await sendWhatsAppMessage({
          phone: faculty.whatsappNumber,
          templateName: 'fcs_negative_credit_alert_v1',
          language: 'en',
          textParams: [
            faculty.name,
            Math.abs(pointsValue).toString(),
            faculty.facultyID || 'N/A',
            faculty.department || 'N/A',
            title,
            issuerName,
            notes || 'No reason specified',
            currentBalance.toString()
          ],
          buttonParams: [
            String(facultyId)
          ]
        });
        console.log('WhatsApp notification sent to:', faculty.whatsappNumber);
      } catch (waErr) {
        console.error('WhatsApp notification failed:', waErr);
      }
    }

    return { success: true };
  } catch (err) {
    console.error('sendRemarkNotificationHelper failed overall:', err);
    throw err;
  }
}

module.exports = { sendRemarkNotificationHelper };
