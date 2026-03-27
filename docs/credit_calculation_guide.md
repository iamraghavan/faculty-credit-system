# Credit Calculation Engine (Recalculation Logic)

The faculty credit system uses a transaction-based approach to ensure data integrity. Instead of just storing a single "total" number, the system calculates the total dynamically from individual credit entries.

---

## 1. Advanced Technology Stack

We use industry-standard libraries to ensure precision and reliability:
- **Lodash (`_`)**: Used for functional data manipulation, filtering, and grouped aggregations (e.g., academic year summaries).
- **Math.js**: Used for high-precision decimal arithmetic. This prevents "floating-point errors" (like `0.1 + 0.2 = 0.3000000004`) when summing hundreds of credits.

---

## 2. How `?recalc=true` Works

When you call an endpoint with `?recalc=true`, the following "Source of Truth" synchronization occurs:

1. **Fetch Transactions**: All individual credit records (positive and negative) for the faculty are fetched from DynamoDB.
2. **Filter & Sort**: Items with status `pending` or `deleted` are excluded. Survivors are sorted chronologically.
3. **Big-Number Accumulation**:
   - **Positive Credits**: Summed ONLY if `status === 'approved'`.
   - **Negative Credits**: Summed if `status === 'approved'` (and no appeal) OR if an appeal was `rejected`.
4. **User Sync**: The final net total is saved back to the `User` profile's `currentCredit` field.
5. **Breakdown**: The system also generates a yearly breakdown (`creditsByYear`) for charts.

---

## 3. Calculation Rules

| Type | Status | Appeal Status | Applied? |
| :--- | :--- | :--- | :--- |
| Positive | Approved | N/A | **YES** |
| Positive | Pending | N/A | NO |
| Negative | Approved | N/A | **YES** |
| Negative | Approved | Rejected | **YES** |
| Negative | Approved | Approved | NO (Penalty waived) |
| Negative | Deleted | N/A | NO |

> [!IMPORTANT]
> **Real-time Updates**: The system automatically triggers a background recalculation whenever a credit is created, edited, or deleted. Adding `?recalc=true` to your API call is a "Force Refresh" that guarantees the data is 100% accurate.
