// routes/schedules.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../middleware/auth');

// GET /api/schedules?date=YYYY-MM-DD OR /api/schedules?from=YYYY-MM-DD
router.get('/', auth, async (req, res) => {
  try {
    const { date, from } = req.query;

    let where = 'WHERE m.user_id = $1';
    const params = [req.user.id];

    if (date) {
      where += ' AND s.schedule_date = $2';
      params.push(date);
    } else if (from) {
      where += ' AND s.schedule_date > $2';
      params.push(from);
    }

const result = await pool.query(
  `SELECT
     s.id,
     s.medicine_id,
     s.schedule_date,
     s.time,
     s.status,
     s.dosage,
     (s.schedule_date + (s.time::time)) AS scheduled_at,
     m.patient_id,
     m.name AS medicine_name
   FROM schedules s
   JOIN medicines m ON s.medicine_id = m.id
   ${where}
   ORDER BY (s.schedule_date + (s.time::time)) ASC`,
  params
);


    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/schedules/:id/taken (secure)
router.put('/:id/taken', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE schedules s
       SET status = $1, taken_at = NOW()
       FROM medicines m
       WHERE s.id = $2
         AND s.medicine_id = m.id
         AND m.user_id = $3
       RETURNING s.*`,
      ['taken', id, req.user.id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Schedule not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// DELETE /api/schedules/:id (delete one dose)
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    // ensure this schedule belongs to logged-in user (join medicines)
    const check = await pool.query(
      `SELECT s.id
       FROM schedules s
       JOIN medicines m ON s.medicine_id = m.id
       WHERE s.id = $1 AND m.user_id = $2`,
      [id, req.user.id]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    await pool.query('DELETE FROM schedules WHERE id = $1', [id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});


module.exports = router;
