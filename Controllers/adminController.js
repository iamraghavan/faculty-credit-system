const CreditTitle = require('../Models/CreditTitle');

async function createCreditTitle(req, res, next) {
  try {
    const actor = req.user;
    if (!actor || actor.role !== 'admin') 
      return res.status(403).json({ success: false, message: 'Forbidden' });

    const { title, points, type, description } = req.body;
    if (!title || !points) 
      return res.status(400).json({ success: false, message: 'Missing required fields' });

    const ct = await CreditTitle.create({
      title,
      points,
      type: type || 'positive',
      description,
      createdBy: actor._id,
    });

    res.status(201).json({ success: true, data: ct });
  } catch (err) {
    next(err);
  }
}

async function listCreditTitles(req, res, next) {
  try {
    const items = await CreditTitle.find({ isActive: true });
    res.json({ success: true, total: items.length, items });
  } catch (err) {
    next(err);
  }
}

module.exports = { createCreditTitle, listCreditTitles };
