const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const User = require('../../Models/User');
const { sendEmail } = require('../../utils/email');

/**
 * Forgot Password
 */
async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const users = await User.find({ email: email.toLowerCase() });
    
    // Security: Always return "email sent" (success) even if user not found to prevent enumeration
    if (users.length > 0) {
      const user = users[0];
      const resetToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
      const resetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

      await User.update(user._id, {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: resetExpires
      });

      // Prepare Email
      const resetUrl = `${process.env.FRONTEND_URL || 'https://fcs.egspgroup.in'}/u/portal/auth/reset-password/${resetToken}`;
      const templatePath = path.join(process.cwd(), 'email-templates', 'reset-password.html');

      let html;
      try {
        html = fs.readFileSync(templatePath, 'utf8');
      } catch (e) {
        console.warn('Email template not found, falling back to basic HTML');
        html = `<p>Click here to reset your password: <a href="${resetUrl}">${resetUrl}</a></p>`;
      }

      // Replace placeholders
      html = html
        .replace(/{{name}}/g, user.name || 'User')
        .replace(/{{resetUrl}}/g, resetUrl)
        .replace(/{{year}}/g, new Date().getFullYear());

      await sendEmail({
        to: user.email,
        subject: 'Reset your password - CreditHub',
        html, 
        text: `Reset your password here: ${resetUrl}`
      });
    }

    res.json({ success: true, message: 'If that email exists, a reset link was sent.' });
  } catch (err) {
    next(err);
  }
}

/**
 * Reset Password
 */
async function resetPassword(req, res, next) {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ success: false, message: 'Token and new password required' });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // Find User with valid, non-expired token.
    // Note: Since User.find() performs a Scan, this is inefficient but acceptable for MVP.
    // In production, use GSI on resetPasswordToken.
    const allUsers = await User.find();
    const user = allUsers.find(u => 
      u.resetPasswordToken === hashedToken && 
      u.resetPasswordExpires && 
      Date.now() < Number(u.resetPasswordExpires)
    );

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired password reset token' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update User
    await User.update(user._id, {
      password: hashedPassword,
      resetPasswordToken: null,
      resetPasswordExpires: null,
      updatedAt: new Date().toISOString()
    });

    // Send Confirmation Email
    const templatePath = path.join(process.cwd(), 'email-templates', 'reset-success.html');
    let html;
    try {
        html = fs.readFileSync(templatePath, 'utf8');
    } catch(e) {
        html = `<p>Your password has been changed successfully.</p>`;
    }

    const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`;
    html = html
      .replace(/{{name}}/g, user.name || 'User')
      .replace(/{{loginUrl}}/g, loginUrl)
      .replace(/{{year}}/g, new Date().getFullYear());

    await sendEmail({
      to: user.email,
      subject: 'Password Changed Successfully',
      html,
      text: 'Your password has been changed.'
    });

    res.json({ success: true, message: 'Password has been reset successfully' });

  } catch (err) {
    next(err);
  }
}

