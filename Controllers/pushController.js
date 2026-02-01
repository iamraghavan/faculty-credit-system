const webpush = require('web-push');
const fs = require('fs');
const path = require('path');
const fsPromises = fs.promises;
const PushSubscription = require('../Models/PushSubscription');
const { sendEmail } = require('../utils/email');
const { generateRemarkPdf } = require('../utils/pdfGenerator');
require('dotenv').config();

// Configure web-push
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_MAILTO || 'mailto:admin@example.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
} else {
    console.warn('VAPID Keys not found. Web Push will not work.');
}

/**
 * Save a new subscription for a user
 * POST /api/v1/notifications/subscribe
 */
async function subscribe(req, res, next) {
    try {
        const subscription = req.body;
        const user = req.user;

        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({ success: false, message: 'Invalid subscription object' });
        }

        await PushSubscription.create({
            userId: String(user._id),
            endpoint: subscription.endpoint,
            keys: subscription.keys,
            userAgent: req.headers['user-agent']
        });

        res.status(201).json({ success: true, message: 'Subscribed to notifications' });
    } catch (err) {
        next(err);
    }
}

/**
 * Send a push notification to a specific user
 * @param {string} userId 
 * @param {Object} payload { title, body, icon, url }
 */
async function sendPushToUser(userId, payload) {
    try {
        const subscriptions = await PushSubscription.findByUserId(userId);
        if (!subscriptions || subscriptions.length === 0) return;

        const notificationPayload = JSON.stringify(payload);

        const promises = subscriptions.map(async (sub) => {
            try {
                await webpush.sendNotification(sub, notificationPayload);
            } catch (err) {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    await PushSubscription.delete(sub.endpoint);
                } else {
                    console.error('Error sending push:', err);
                }
            }
        });

        await Promise.all(promises);
    } catch (err) {
        console.error('Failed to send push batch:', err);
    }
}

/**
 * Send a manual remark notification (Email + Push)
 * POST /api/v1/notifications/remark
 */
async function sendRemarkNotification(req, res, next) {
    try {
        const { facultyId, title, points, notes, academicYear } = req.body;
        const issuerName = req.user ? req.user.name : 'Administrator';

        if (!facultyId || !title) {
            return res.status(400).json({ success: false, message: 'Missing facultyId or title' });
        }

        const User = require('../Models/User');
        const faculty = await User.findById(facultyId);
        if (!faculty) return res.status(404).json({ success: false, message: 'Faculty not found' });

        const dateStr = new Date().toLocaleDateString('en-IN', { dateStyle: 'long' });
        const portalUrl = process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/faculty/credits` : '#';
        const pointsValue = Number(points) || 0;

        // 1. Generate PDF
        const pdfBuffer = await generateRemarkPdf({
            title: title,
            points: pointsValue,
            academicYear: academicYear || new Date().getFullYear(),
            notes: notes || '',
            facultyName: faculty.name,
            facultyId: faculty.facultyID,
            issuerName,
            date: dateStr
        });

        // 2. Read HTML Template
        const templatePath = path.resolve(process.cwd(), 'email-templates', 'remark-notification.html');
        let htmlContent = await fsPromises.readFile(templatePath, 'utf8');

        // 3. Replace Placeholders
        htmlContent = htmlContent
            .replace(/{{\s*facultyName\s*}}/g, faculty.name)
            .replace(/{{\s*remarkTitle\s*}}/g, title)
            .replace(/{{\s*remarkPoints\s*}}/g, Math.abs(pointsValue))
            .replace(/{{\s*remarkMessage\s*}}/g, notes || 'No additional notes provided.')
            .replace(/{{\s*date\s*}}/g, dateStr)
            .replace(/{{\s*issuerName\s*}}/g, issuerName)
            .replace(/{{\s*portalUrl\s*}}/g, portalUrl)
            .replace(/{{\s*currentYear\s*}}/g, new Date().getFullYear());

        // 4. Send Email
        await sendEmail({
            to: faculty.email,
            subject: `Startling Alert - Remark Notification: ${title}`,
            text: `Remark Notification: ${title}\nPoints: ${pointsValue}\nPlease check attached PDF.`,
            html: htmlContent,
            attachments: [
                {
                    filename: `Remark_Notification_${Date.now()}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }
            ]
        });

        // 5. Send Push
        await sendPushToUser(String(faculty._id), {
            title: 'New Remark Received',
            body: `${title} (${pointsValue} credits). Check your portal.`,
            url: portalUrl,
            icon: '/icons/warning.png'
        });

        res.status(200).json({ success: true, message: 'Notification sent successfully' });

    } catch (err) {
        next(err);
    }
}

module.exports = {
    subscribe,
    sendPushToUser,
    sendRemarkNotification
};
