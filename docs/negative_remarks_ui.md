# Frontend Integration Guide: Manage Negative Remarks

This guide explains how to connect your "Manage Negative Remarks" UI to the backend API, including filtering, dynamic dropdowns, and table actions.

---

## 1. API Endpoint Overview

- **Endpoint**: `GET /api/v1/admin/credits/negative`
- **Auth**: Requires `Authorization: Bearer <token>`
- **Roles**: Admin or OA

---

## 2. Filtering & Search Parameters

Map your UI filter components to these query parameters:

| UI Filter | API Parameter | Description |
| :--- | :--- | :--- |
| **Search name, ID** | `search` | Searches across Faculty Name, Faculty ID, College, and Department. |
| **All Templates** | `templateId` | Filter by specific penalty template ID (from `filters.templates`). |
| **All Statuses** | `status` | `pending`, `approved`, `rejected`, `appealed`, or `all`. |
| **All Years** | `academicYear` | e.g., `2024-25`. |
| **All Colleges** | `college` | filter by faculty college name. |
| **All Departments** | `department` | Filter by faculty department name. |
| **Pagination** | `page` / `limit` | Defaults: `page=1`, `limit=20`. |

---

## 3. Dynamic Dropdowns (The `filters` Object)

The API response includes a `filters` object containing all unique values currently in the system. Use this to populate your dropdown menus automatically.

### API Response Structure:
```json
{
  "success": true,
  "filters": {
    "templates": ["Late Arrival", "Missed Duty", ...],
    "years": ["2023-24", "2024-25"],
    "colleges": ["EGSPEC", "EGSPGOI"],
    "departments": ["CSE", "ECE", "EEE"]
  },
  "items": [...]
}
```

---

## 4. Table Action Handlers

### 👀 View Reason/Proof
Trigger a modal or redirect using the `creditId`:
`GET /api/v1/admin/credits/negative/:creditId`

### 📝 Edit Remark
Open your Edit Modal and submit changes to:
`PUT /api/v1/credits/credits/negative/:creditId`
*(Note: Use the dedicated negative credit update route for consistency)*

### 🗑️ Delete Remark
Send a delete request with confirmation:
`DELETE /api/v1/credits/credits/negative/:creditId`

---

## 5. Implementation Example (React/Axios)

```javascript
const fetchRemarks = async (filters) => {
  try {
    const { data } = await axios.get('/api/v1/admin/credits/negative', {
      params: {
        search: filters.search,
        status: filters.status || 'all',
        college: filters.college || 'all',
        department: filters.department || 'all',
        academicYear: filters.year || 'all',
        page: filters.page,
        limit: 10
      }
    });
    
    // 1. Update your table data
    setRemarks(data.items);
    
    // 2. (Optional) Update your dropdown options dynamically
    setDropdownOptions(data.filters);
    
  } catch (err) {
    console.error("Failed to fetch remarks", err);
  }
};
```

> [!TIP]
> **Debouncing**: Ensure your search input has a debounce (e.g., 300ms) to avoid over-calling the API as the user types.
