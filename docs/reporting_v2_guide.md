# Reporting System Guide (V2) - Ranking & Sorting

The reporting system now supports two distinct views: **Transactions** (individual credit logs) and **Ranking** (aggregated faculty scores).

---

## 1. Unified API Endpoints

All reporting endpoints are under `/api/v1/reports`.

| View Type | Query Parameter | Result |
| :--- | :--- | :--- |
| **Transactions** | `view=transactions` (Default) | List of individual credit records. |
| **Ranking** | `view=ranking` | Aggregated faculty list with total points. |

### Sorting Parameters (Ranking View)
- `sortBy`: `total` (Net), `positive` (Sum of +ve), `negative` (Sum of |abs| -ve), `count` (Activities).
- `order`: `desc` (High-to-Low, default) or `asc` (Low-to-High).

### Filtering Parameters
- `level`: `college` or `department`.
- `id`: Department name (if level is department).
- `academicYear`: e.g., `2024-2025` or `all`.
- `startDate` / `endDate`: Filter by activity date.

---

## 2. Frontend Implementation Example

### Fetch Ranking Data (JSON)
Use this to populate a "Faculty Leaderboard" or "Penalty List" in the admin dashboard.

```javascript
// Example: Get top 10 faculty by net credits in CSE department
const getRanking = async () => {
  const params = {
    view: 'ranking',
    level: 'department',
    id: 'Computer Science',
    sortBy: 'total',
    order: 'desc',
    academicYear: '2024-2025'
  };
  
  const res = await axios.get('/api/v1/reports', { params, headers });
  return res.data.data; // Array of { name, facultyID, positive, negative, total, count }
};
```

---

## 3. Download Options

The `download` endpoint automatically detects the `view` and adjusts the document format accordingly.

```bash
# Download PDF High-to-Low Ranking for the whole College
GET /api/v1/reports/download?view=ranking&sortBy=total&order=desc&format=pdf

# Download Excel Low-to-High Ranking for a specific Dept
GET /api/v1/reports/download?view=ranking&sortBy=total&order=asc&level=department&id=Mechanical&format=excel
```

---

## 4. UI Rendering logic
- **Transaction View**: Columns show Date, Faculty, Activity, Pts.
- **Ranking View**: Columns show Faculty, Dept, Pos(+), Neg(-), Net Total.

> [!TIP]
> **Performance Optimization**: The current aggregation logic runs on the server using `ScanCommand`. For high performance with thousands of records, ensure you use the `academicYear` filter to limit the data set.
