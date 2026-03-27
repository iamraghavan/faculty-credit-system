# Admin & OA Negative Credit Management Guide

This guide describes how Admins and Office Assistants (OAs) can manage negative credits (penalties) within the Faculty Credit System.

---

## 1. Quick Action Routes

| Action | Method | Endpoint | Authorization |
| :--- | :--- | :--- | :--- |
| **Issue New Credit** | `POST` | `/api/v1/credits/credits/negative` | Admin / OA |
| **Update Credit** | `PUT` | `/api/v1/credits/credits/negative/:creditId` | Admin / OA |
| **Delete Credit** | `DELETE` | `/api/v1/credits/credits/negative/:creditId` | Admin / OA |

---

## 2. Managing Credits (React Frontend Integration)

### Example API Client (using Axios)

```javascript
import axios from 'axios';

const API_BASE = '/api/v1/credits';

// Example React Service Update
export const NegativeCreditService = {
  // Update a negative credit
  update: async (creditId, formData, token) => {
    return axios.put(`${API_BASE}/credits/negative/${creditId}`, formData, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'multipart/form-data'
      }
    });
  },

  // Delete a negative credit
  delete: async (creditId, token) => {
    return axios.delete(`${API_BASE}/credits/negative/${creditId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
  }
};
```

---

## 3. Workflow Implementation

### A. Editing a Penalty
1. **Fetch Data**: Populate your edit modal by calling `GET /api/v1/credits/credits/:creditId`.
2. **Submit**: Use `multipart/form-data` if you allow re-uploading proof of the violation.
3. **Refresh**: After success, call the recalculate endpoint to update the faculty's dashboard total:  
   `GET /api/v1/credits/credits/:facultyId/credits?recalc=true`

### B. Deleting a Penalty
1. **Confirmation**: Always show a confirmation prompt before calling the `DELETE` route.
2. **Cleanup**: On success, the backend automatically triggers a recalculation for the affected faculty.

---

## 4. Authorization Notes
- **Admin**: Has full access to delete/edit any penalty.
- **OA (Office Assistant)**: Can delete or edit negative credits they themselves have issued.
- **Faculty**: CANNOT edit or delete negative credits; they must use the "Appeal" system instead.
