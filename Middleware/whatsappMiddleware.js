const ensureWhatsappVerified = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Skip for admins or specific roles if needed
    // if (req.user.role === 'admin') return next();

    if (req.user.whatsappVerified) {
        return next();
    }

    return res.status(403).json({
        success: false,
        message: 'WhatsApp verification required.',
        requiresWhatsappVerification: true // Frontend can check this flag
    });
};

module.exports = { ensureWhatsappVerified };
