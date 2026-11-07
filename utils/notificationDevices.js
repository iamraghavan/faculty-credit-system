const User = require('../Models/User');

const MAX_DEVICES = 10;
const TOKEN_PATTERN = /^[!-~]{20,4096}$/;
const PLATFORMS = new Set(['web', 'android', 'ios']);

function isValidToken(token) {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

function tokensForUser(user) {
  const devices = Array.isArray(user?.fcmDevices) ? user.fcmDevices : [];
  return [...new Set([...devices.map((device) => device.token), user?.fcmToken].filter(isValidToken))];
}

async function changeDevice(userId, token, platform) {
  if (!isValidToken(token)) {
    const error = new Error('A valid FCM device token is required');
    error.status = 400;
    throw error;
  }
  if (platform !== null && !PLATFORMS.has(platform)) {
    const error = new Error('platform must be web, android, or ios');
    error.status = 400;
    throw error;
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const user = await User.findById(userId);
    if (!user) {
      const error = new Error('User not found');
      error.status = 404;
      throw error;
    }
    const previous = Array.isArray(user.fcmDevices) ? user.fcmDevices : undefined;
    const current = previous || [];
    const withoutToken = current.filter((device) => device.token !== token);
    const next =
      platform === null
        ? withoutToken
        : [...withoutToken, { token, platform, updatedAt: new Date().toISOString() }].slice(-MAX_DEVICES);
    try {
      await User.updateFcmDevices(userId, previous, next);
      if (platform === null && user.fcmToken === token) await User.update(userId, { fcmToken: null });
      return { deviceCount: next.length };
    } catch (error) {
      if (error.name !== 'ConditionalCheckFailedException' || attempt === 3) throw error;
    }
  }
}

module.exports = { changeDevice, isValidToken, tokensForUser };
