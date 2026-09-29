'use strict';

// The credit record is the source of truth. A decision changes its effective
// impact; it must never create a second credit or deduct the same credit twice.
function creditImpact(credit) {
  const type = String(credit?.type || '').toLowerCase();
  const status = String(credit?.status || '').toLowerCase();
  const appealStatus = String(credit?.appeal?.status || '').toLowerCase();
  const points = Number(credit?.points);
  if (!Number.isFinite(points)) throw new Error(`Invalid points for credit ${credit?._id || 'unknown'}`);
  const magnitude = Math.abs(points);

  if (status === 'deleted') return { points: 0, reason: 'deleted' };
  if (type === 'positive') {
    return status === 'approved'
      ? { points: magnitude, reason: 'approved_positive' }
      : { points: 0, reason: 'positive_not_approved' };
  }
  if (type !== 'negative') return { points: 0, reason: 'unknown_type' };

  if (appealStatus === 'pending') return { points: -magnitude, reason: 'appeal_pending' };
  if (appealStatus === 'accepted') return { points: 0, reason: 'appeal_accepted' };
  if (appealStatus === 'rejected') {
    return status === 'rejected'
      ? { points: 0, reason: 'credit_revoked' }
      : { points: -magnitude, reason: 'appeal_rejected' };
  }
  if (appealStatus === 'withdrawn') return { points: -magnitude, reason: 'appeal_withdrawn' };
  if (appealStatus) return { points: 0, reason: 'unknown_appeal_status' };
  if (status === 'pending' || status === 'approved') {
    return { points: -magnitude, reason: 'issued_negative' };
  }
  return { points: 0, reason: 'negative_not_active' };
}

module.exports = { creditImpact };
