const CreditTitle = require('../../Models/CreditTitle');
const { connectDB } = require('../../config/db');
const { schemas } = require('../../utils/validation');

/**
 * Ensure DB Connection
 */
async function ensureDb() {
  await connectDB();
}

/**
 * Admin creates credit title (Dynamo)
 */
async function createCreditTitle(req, res, next) {
  try {
    await ensureDb();
    
    // Validation
    const { error, value } = schemas.creditTitle.create.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const { title, points, type, description } = value;
    const actor = req.user;

    const ct = await CreditTitle.create({
      title,
      points: Number(points),
      type,
      description,
      createdBy: String(actor._id),
      isActive: true,
    });

    return res.status(201).json({ success: true, data: ct });
  } catch (err) {
    next(err);
  }
}

/**
 * List credit titles (Dynamo)
 */
async function listCreditTitles(req, res, next) {
  try {
    await ensureDb();
    // Optimized: Filter at DB level if possible, else in-memory
    const items = await CreditTitle.find({ isActive: true });
    return res.json({ success: true, total: items.length, items });
  } catch (err) {
    next(err);
  }
}

/**
 * Update credit title (Dynamo)
 */
async function updateCreditTitle(req, res, next) {
  try {
    await ensureDb();
    const { id } = req.params;
    
    const { error, value } = schemas.creditTitle.update.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const existing = await CreditTitle.findById(id);
    if (!existing) return res.status(404).json({ success: false, message: 'Credit title not found' });

    const updated = await CreditTitle.update(id, {
      ...value,
      updatedAt: new Date().toISOString(),
    });

    return res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * Delete (soft) credit title (Dynamo)
 */
async function deleteCreditTitle(req, res, next) {
  try {
    await ensureDb();
    const { id } = req.params;

    const existing = await CreditTitle.findById(id);
    if (!existing) return res.status(404).json({ success: false, message: 'Credit title not found' });

    const updated = await CreditTitle.update(id, { isActive: false, updatedAt: new Date().toISOString() });
    return res.json({ success: true, message: 'Credit title deactivated', data: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createCreditTitle,
  listCreditTitles,
  updateCreditTitle,
  deleteCreditTitle
};
