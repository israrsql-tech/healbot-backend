// routes/familyMembers.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../middleware/auth');

// GET /api/family-members
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM family_members WHERE user_id = $1',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get family members error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/family-members
router.post('/', auth, async (req, res) => {
  try {
    const { name, relationship, age, bloodType, phone, emergency, history } = req.body;

    const result = await pool.query(
      `INSERT INTO family_members
       (user_id, name, relationship, age, blood_type, phone, emergency, history)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [req.user.id, name, relationship, age, bloodType, phone, emergency, history]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Add family member error:', err);
    res.status(500).json({ error: err.message });
  }
});
// DELETE /api/family-members/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    // ensure this member belongs to logged-in user
    const check = await pool.query(
      'SELECT id FROM family_members WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Family member not found' });
    }

    // delete schedules for medicines of this patient
    await pool.query(
      `DELETE FROM schedules
       WHERE medicine_id IN (
         SELECT id FROM medicines WHERE user_id = $1 AND patient_id = $2
       )`,
      [req.user.id, id]
    );

    // delete medicines of this patient
    await pool.query(
      'DELETE FROM medicines WHERE user_id = $1 AND patient_id = $2',
      [req.user.id, id]
    );

    // finally delete family member
    await pool.query(
      'DELETE FROM family_members WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error('Delete family member error:', err);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
