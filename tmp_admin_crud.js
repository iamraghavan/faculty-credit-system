
/**
 * Admin Updates a Negative Credit
 * PUT /api/v1/credits/credits/negative/:creditId
 */
async function updateNegativeCredit(req, res, next) {
    try {
        await ensureDb();

        const { creditId } = req.params;
        const { notes, creditTitleId } = req.body; // Allow updating notes or changing the violation type

        if (!creditId) return res.status(400).json({ success: false, message: 'creditId required' });

        const credit = await Credit.findById(creditId);
        if (!credit) return res.status(404).json({ success: false, message: 'Credit not found' });
        if (credit.type !== 'negative') return res.status(400).json({ success: false, message: 'Not a negative credit' });

        // Assuming only notes or violation type can be changed. Proof usually stays or requires re-upload.
        // If user sends file, handle it.
        let proofUrl = credit.proofUrl;
        let proofMeta = credit.proofMeta;

        if (req.file) {
            const uploadResult = await handleFileUpload(req.file, credit.academicYear || 'general');
            proofUrl = uploadResult.proofUrl;
            proofMeta = uploadResult.proofMeta;
        }

        const updates = {
            updatedAt: new Date().toISOString()
        };
        if (notes !== undefined) updates.notes = notes;
        if (proofUrl) {
            updates.proofUrl = proofUrl;
            updates.proofMeta = proofMeta;
        }

        // If Credit Title (violation type) changes, points might change
        if (creditTitleId && String(creditTitleId) !== String(credit.title)) { // IDK if title stores ID or Name. In existing code: title: ct.title || ct._id
            // This is tricky if 'title' field stores the Name string. Code says: 'title: ct.title || ct._id'
            // Ideally we store ID strictly or have a ref. 
            // For safety, let's assume we update only if we can find the new Title.
            const ct = await CreditTitle.findById(creditTitleId);
            if (ct) {
                updates.title = ct.title;
                updates.points = -Math.abs(Number(ct.points || 0));
            }
        }

        await Credit.update(creditId, updates);

        // Recalc
        try { await recalcFacultyCredits(credit.faculty); } catch (e) { }

        const updated = await Credit.findById(creditId);
        io.emit(`faculty:${credit.faculty}:creditUpdate`, updated);

        return res.json({ success: true, data: updated, message: 'Negative credit updated' });

    } catch (err) {
        next(err);
    }
}

/**
 * Admin Deletes a Negative Credit
 * DELETE /api/v1/credits/credits/negative/:creditId
 */
async function deleteNegativeCredit(req, res, next) {
    try {
        await ensureDb();
        const { creditId } = req.params;

        const credit = await Credit.findById(creditId);
        if (!credit) return res.status(404).json({ success: false, message: 'Credit not found' });
        if (credit.type !== 'negative') return res.status(400).json({ success: false, message: 'Not a negative credit' });

        await Credit.delete(creditId);

        // Recalc
        try { await recalcFacultyCredits(credit.faculty); } catch (e) { }

        // Notify FE about deletion (send ID or null)
        io.emit(`faculty:${credit.faculty}:creditDelete`, { creditId, type: 'negative' });

        return res.json({ success: true, message: 'Negative credit deleted' });
    } catch (err) {
        next(err);
    }
}
