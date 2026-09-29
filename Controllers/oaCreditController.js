const crypto = require('crypto');
const Credit = require('../Models/Credit');
const CreditTitle = require('../Models/CreditTitle');
const { connectDB } = require('../config/db');
const { recalcFacultyCredits } = require('../utils/calculateCredits');
const { handleFileUpload } = require('../utils/fileUpload');

function ownsCredit(user, credit) {
  return user?.role === 'oa' && String(credit?.issuedBy || '') === String(user?._id || '');
}

function auditEvent(action, user, credit, changes, reason) {
  return {
    id: crypto.randomUUID(), action, at: new Date().toISOString(), actorId: String(user._id),
    before: {
      title: credit.title || null, creditTitle: credit.creditTitle || null, points: credit.points ?? null,
      notes: credit.notes || '', academicYear: credit.academicYear || null, status: credit.status || null,
      proofUrl: credit.proofUrl || null,
    },
    after: changes,
    ...(reason ? { reason } : {}),
  };
}

async function loadOwnedCredit(req, res) {
  const credit = await Credit.findById(req.params.id);
  if (!credit) { res.status(404).json({ success: false, message: 'Credit not found' }); return null; }
  if (!ownsCredit(req.user, credit)) { res.status(403).json({ success: false, message: 'You can manage only credits you issued' }); return null; }
  if (credit.status === 'deleted') { res.status(409).json({ success: false, message: 'This credit has already been voided' }); return null; }
  return credit;
}

async function updateOwnIssuedCredit(req, res, next) {
  try {
    await connectDB();
    const credit = await loadOwnedCredit(req, res);
    if (!credit) return;
    if (credit.appeal && credit.appeal.status !== 'withdrawn') return res.status(409).json({ success: false, message: 'A credit with an appeal cannot be edited; an admin must review it' });

    const body = req.body || {};
    if (body.status !== undefined || body.faculty !== undefined || body.type !== undefined) {
      return res.status(400).json({ success: false, message: 'Direct changes to status, faculty, or type are not allowed' });
    }
    const changes = {};
    if (body.points !== undefined) {
      if (credit.type !== 'positive' || credit.creditTitle || body.creditTitleId) {
        return res.status(400).json({ success: false, message: 'Only manual positive awards can have their points corrected directly' });
      }
      const amount = Number(body.points);
      const maxPoints = Math.max(1, Number(process.env.MAX_ISSUED_CREDIT_POINTS) || 10000);
      if (!Number.isFinite(amount) || amount <= 0 || amount > maxPoints) return res.status(400).json({ success: false, message: 'Invalid positive points' });
      if (String(body.reason || '').trim().length < 5) return res.status(400).json({ success: false, message: 'A reason of at least 5 characters is required for a point correction' });
      changes.points = amount;
    }
    if (body.notes !== undefined) changes.notes = String(body.notes).trim().slice(0, 5000);
    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title || title.length > 200) return res.status(400).json({ success: false, message: 'Title must contain 1 to 200 characters' });
      changes.title = title;
    }
    if (body.academicYear !== undefined) {
      const year = String(body.academicYear).trim();
      if (!/^\d{4}-\d{2,4}$/.test(year)) return res.status(400).json({ success: false, message: 'Invalid academic year' });
      changes.academicYear = year;
    }
    if (body.creditTitleId) {
      const template = await CreditTitle.findById(String(body.creditTitleId));
      if (!template || template.type !== credit.type || template.isActive === false) {
        return res.status(400).json({ success: false, message: 'Select an active credit title of the same type' });
      }
      const amount = Math.abs(Number(template.points));
      const maxPoints = Math.max(1, Number(process.env.MAX_ISSUED_CREDIT_POINTS) || 10000);
      if (!Number.isFinite(amount) || amount <= 0 || amount > maxPoints) return res.status(400).json({ success: false, message: 'Credit title has invalid points' });
      changes.creditTitle = String(template._id);
      changes.title = template.title;
      changes.points = credit.type === 'negative' ? -amount : amount;
    }
    if (req.file) Object.assign(changes, await handleFileUpload(req.file, `credits/${credit.academicYear || 'general'}`));
    if (!Object.keys(changes).length) return res.status(400).json({ success: false, message: 'No changes provided' });

    const now = new Date().toISOString();
    const event = auditEvent('edited', req.user, credit, changes, String(body.reason || '').trim().slice(0, 1000));
    let updated;
    try {
      updated = await Credit.updateOwned(credit._id, req.user._id, { ...changes, updatedAt: now }, event, credit.updatedAt);
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') return res.status(409).json({ success: false, message: 'Credit changed while you were editing; reload and try again' });
      throw error;
    }
    let balanceUpdated = true;
    try { await recalcFacultyCredits(String(credit.faculty)); }
    catch (error) { balanceUpdated = false; console.error('OA credit changed but balance projection failed:', error); }
    return res.json({ success: true, balanceUpdated, data: updated });
  } catch (error) { next(error); }
}

async function voidOwnIssuedCredit(req, res, next) {
  try {
    await connectDB();
    const credit = await loadOwnedCredit(req, res);
    if (!credit) return;
    if (credit.appeal?.status === 'pending') return res.status(409).json({ success: false, message: 'An open appeal must be reviewed by an admin before this credit can be voided' });
    const now = new Date().toISOString();
    const reason = String(req.body?.reason || '').trim().slice(0, 1000);
    if (reason.length < 5) return res.status(400).json({ success: false, message: 'Provide a reason of at least 5 characters to void this credit' });
    const changes = { status: 'deleted', deletedAt: now, deletedBy: String(req.user._id), updatedAt: now };
    const event = auditEvent('voided', req.user, credit, changes, reason);
    let updated;
    try {
      updated = await Credit.updateOwned(credit._id, req.user._id, changes, event, credit.updatedAt);
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') return res.status(409).json({ success: false, message: 'Credit changed while you were voiding it; reload and try again' });
      throw error;
    }
    let balanceUpdated = true;
    try { await recalcFacultyCredits(String(credit.faculty)); }
    catch (error) { balanceUpdated = false; console.error('OA credit voided but balance projection failed:', error); }
    return res.json({ success: true, balanceUpdated, message: 'Credit voided; its record and activity remain available', data: updated });
  } catch (error) { next(error); }
}

module.exports = { ownsCredit, updateOwnIssuedCredit, voidOwnIssuedCredit };
