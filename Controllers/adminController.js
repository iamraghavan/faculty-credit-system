const CreditTitle = require('../Models/CreditTitle');

// Update credit title
async function updateCreditTitle(req, res, next) {
  try {
    const actor = req.user;
    if (!actor || actor.role !== 'admin') 
      return res.status(403).json({ success: false, message: 'Forbidden' });

    const { id } = req.params;
    const { title, points, type, description } = req.body;

    const updated = await CreditTitle.findByIdAndUpdate(
      id,
      { title, points, type, description },
      { new: true, runValidators: true }
    );

    if (!updated)
      return res.status(404).json({ success: false, message: 'Credit title not found' });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

// Delete (soft delete) credit title
async function deleteCreditTitle(req, res, next) {
  try {
    const actor = req.user;
    if (!actor || actor.role !== 'admin')
      return res.status(403).json({ success: false, message: 'Forbidden' });

    const { id } = req.params;

    // soft delete by marking isActive = false
    const deleted = await CreditTitle.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );

    if (!deleted)
      return res.status(404).json({ success: false, message: 'Credit title not found' });

    res.json({ success: true, message: 'Credit title deactivated', data: deleted });
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
