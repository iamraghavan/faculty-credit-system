# Faculty credit accounting

The credit record is the source of truth. `domain/creditAccounting.js` decides the signed impact of one record. All effective totals must use that function; a credit must contribute at most once.

| Credit state | Balance impact |
| --- | ---: |
| Positive, approved | `+abs(points)` |
| Positive, any other status | `0` |
| Negative, issued (pending or approved), no appeal | `-abs(points)` |
| Negative, appeal pending | `-abs(points)` until accepted |
| Negative, appeal accepted | `0` permanently |
| Negative, appeal rejected | `-abs(points)` |
| Deleted credit | `0` |

For each faculty and academic year, `net = effectivePositive - effectiveNegative`. The overall net is the sum of annual nets. Recorded point amounts remain visible in the ledger even when their current effective impact is zero.

`utils/calculateCredits.js` projects credit records into separate positive, negative, net, and yearly totals. It stores those totals on the user for fast profile and institution views. The faculty credits API also computes the official balance from source records, so a temporarily stale projection does not change the displayed result. Appeal submission and decision recalculate the affected faculty projection. Appeal decisions use a conditional DynamoDB update so only a pending appeal can be decided.

Run `node scripts/reconcileFacultyCredits.js` for a read-only drift report. To repair projections after reviewing the report, run `node scripts/reconcileFacultyCredits.js --apply --confirm-policy=issued-negative-immediate`. Repeat the dry run afterward; `changedFaculty` should be zero.

## Scaling and audit path

The current DynamoDB models scan tables to find credits and users. For larger datasets, add a faculty ID and issue date index, then query each faculty's records instead of scanning. Keep immutable transition events with actor, timestamp, reason, policy version, and an idempotency key. Use a DynamoDB transaction or outbox to couple credit transitions with balance projection updates, and schedule the reconciliation report. These are future architecture steps; the current reconciliation script and conditional appeal decision provide the operational checks available today.
