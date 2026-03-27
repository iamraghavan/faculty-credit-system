# Frontend Integration Guide (V2) - Enhanced Credits & Reporting

This guide covers how to integrate the newly upgraded Credit Calculation Engine and Reporting V2 features into your React/Frontend application.

---

## 1. Implementing "Force Recalculation"

Since the backend now supports high-precision recalculation via `?recalc=true`, you should add a refresh button to the Faculty Dashboard and Admin Panel.

### Axios Implementation
```javascript
/**
 * Fetches credits and forces a full backend recount from the transaction log.
 * Useful for resolving out-of-sync totals.
 */
export const getFacultyCreditsWithRecalc = async (facultyId, token) => {
  const response = await axios.get(
    `/api/v1/credits/credits/faculty/${facultyId}`, 
    {
      params: { recalc: true }, // This triggers the new Math.js/Lodash engine
      headers: { Authorization: `Bearer ${token}` }
    }
  );
  return response.data;
};
```

---

## 2. Dynamic Ranking & Leaderboards

With the new `view=ranking` parameter, you can build a leaderboard in just a few lines of code.

### Sample Component Logic (React)
```javascript
const [facultyRankings, setFacultyRankings] = useState([]);

const loadRankings = async (sortBy = 'total', order = 'desc') => {
  const { data } = await axios.get('/api/v1/reports', {
    params: {
      view: 'ranking',
      sortBy: sortBy, // 'total', 'positive', 'negative', or 'count'
      order: order,   // 'desc' (High-to-Low) or 'asc' (Low-to-High)
      level: 'college',
      academicYear: '2024-25'
    }
  });
  setFacultyRankings(data.data);
};
```

---

## 3. Handling API Paths (Restored)

**CRITICAL**: The routes have been reverted to the redundant `/credits/credits` structure to maintain compatibility with your existing frontend code.

| Feature | Correct Frontend URL Pattern |
| :--- | :--- |
| **Faculty Credits** | `/api/v1/credits/credits/faculty/:id` |
| **Issue Penalty** | `/api/v1/credits/credits/negative` |
| **Edit Penalty** | `/api/v1/credits/credits/negative/:id` |
| **Delete Penalty** | `/api/v1/credits/credits/negative/:id` |

---

## 4. UI Best Practices for Rankings
- **Color Coding**: Display `positive` credits in **green** ($+$) and `negative` credits in **red** ($-$).
- **Sorting Toggle**: Allow users to click table headers to toggle between `asc` and `desc`.
- **Formatting**: Since the backend uses `mathjs` for precision, the numbers returned are clean. You can use standard `.toLocaleString()` for display.

---

## 5. Download Integration

To trigger the new multi-format reports:

```javascript
const downloadReport = (format, view) => {
  const url = `/api/v1/reports/download?format=${format}&view=${view}&level=college`;
  window.open(url, '_blank');
};
```
- `format`: `pdf`, `excel`, or `html`.
- `view`: `transactions` (Detailed logs) or `ranking` (Summary totals).
