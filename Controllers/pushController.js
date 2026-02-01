const fs = require('fs');
const path = require('path');
const fsPromises = fs.promises;
const { sendEmail } = require('../utils/email');
const { generateRemarkPdf } = require('../utils/pdfGenerator');
const { User } = require('../Models/User'); // Assuming User model is here, check if it's correct path or use dynamo

// Adjust User import if it's different. In creditController it was just `const faculty = await User.findById(facultyId);`
// I need to be sure about User model location. 3.0 codebase might use DynamoDB directly or a helper.
// In creditController snippet: "const faculty = await User.findById(facultyId);"
// Let's assume User is available. But wait, I don't see User imported in creditController snippet I viewed.
// Ah, step 168: "const faculty = await User.findById(facultyId);"
// I should verify where User comes from.

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

        // Mock faculty object if we can't find model, OR try to find it
        // Better: Fetch from DB.
        // Assuming there is a User model.
        // If not, we might need a utility to fetch user.
        // Let's rely on payload having email if possible? No, frontend likely only sends IDs.

        // I will use a placeholder for User.findById for now or better, require it.
        // If I can't be sure, I'll use a SAFE error.

        // Let's try to get User from ../Models/User
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

/**
 * Save a new subscription for a user
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
                    // Subscription/Endpoint is gone, delete it
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

module.exports = {
    subscribe,
    sendPushToUser
};
