// routes/history.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../middleware/auth');

// GET /api/history?patient_id=1
router.get('/', auth, async (req, res) => {
  try {
    const patientId = req.query.patient_id ? Number(req.query.patient_id) : null;

    const result = await pool.query(
      `SELECT
        s.id,
        s.status,
        s.time,
        s.taken_at,
        (s.schedule_date + (s.time::time)) AS scheduled_at,

        m.id AS medicine_id,
        m.patient_id,
        fm.name AS patient_name,
        m.name AS medicine,
        m.frequency,

        s.dosage
      FROM schedules s
      JOIN medicines m ON s.medicine_id = m.id
      LEFT JOIN family_members fm ON fm.id = m.patient_id
      WHERE m.user_id = $1
        AND ($2::int IS NULL OR m.patient_id = $2)
      ORDER BY
        COALESCE(s.taken_at, (s.schedule_date + (s.time::time))) DESC,
        s.id DESC`,
      [req.user.id, patientId]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
