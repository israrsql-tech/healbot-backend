// routes/medicines.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../middleware/auth');

const FREQ_META = {
  ONCE_DAILY:  { requiredTimes: 1, stepDays: 1 },
  TWICE_DAILY: { requiredTimes: 2, stepDays: 1 },
  THRICE_DAILY:{ requiredTimes: 3, stepDays: 1 },
  ONCE_WEEKLY: { requiredTimes: 1, stepDays: 7 },
  TWICE_WEEKLY:{ requiredTimes: 2, stepDays: 7 },
  
};

const getMeta = (freq) => FREQ_META[freq] || FREQ_META.ONCE_DAILY;

const normalizeTimes = (times) => {
  let t = times;
  if (!Array.isArray(t)) t = [t];
  t = t.map(x => String(x || '').slice(0, 8)).filter(Boolean);
  t = [...new Set(t)];
  return t;
};

// GET /api/medicines
router.get('/', auth, async (req, res) => {
  try {
    const medicines = await pool.query(
      'SELECT * FROM medicines WHERE user_id = $1',
      [req.user.id]
    );
    res.json(medicines.rows);
  } catch (err) {
    console.error('Get medicines error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/medicines
router.post('/', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    let {
      name,
      dosage,
      unit,
      patient_id,
      frequency = 'ONCE_DAILY',
      times = ['08:00'],
      startDate,
      endDate,
      customTimesCount,
      customStepDays,

    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Medicine name required' });
    }
    if (!dosage || !String(dosage).trim()) {
      return res.status(400).json({ error: 'Dosage required' });
    }

    let meta;

if (frequency === "CUSTOM") {
  const rt = Number(customTimesCount);
  const sd = Number(customStepDays);

  if (!Number.isInteger(rt) || rt < 1 || rt > 6)
    return res.status(400).json({ error: "Custom frequency: times per day must be 1-6" });

  if (!Number.isInteger(sd) || sd < 1 || sd > 30)
    return res.status(400).json({ error: "Custom frequency: repeat days must be 1-30" });

  meta = { requiredTimes: rt, stepDays: sd };
} else {
  meta = getMeta(frequency);
}

    const normTimes = normalizeTimes(times);
    if (normTimes.length !== meta.requiredTimes) {
      return res.status(400).json({
        error: `Frequency ${frequency} requires ${meta.requiredTimes} time(s)`
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const start = startDate || today;
    const end = endDate || start;

    const startD = new Date(start);
    const endD = new Date(end);
    if (Number.isNaN(startD.getTime()) || Number.isNaN(endD.getTime())) {
      return res.status(400).json({ error: 'Invalid start/end date' });
    }
    if (endD < startD) {
      return res.status(400).json({ error: 'End date must be after start date' });
    }

    await client.query('BEGIN');

    const medRes = await client.query(
      `INSERT INTO medicines (user_id, name, dosage, unit, patient_id, start_date, end_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, name, dosage, unit, patient_id, start, end]
    );

    // cap total generated dates
    const maxDates = 365;
    let countDates = 0;

    for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + meta.stepDays)) {
      countDates++;
      if (countDates > maxDates) break;

      const scheduleDate = d.toISOString().slice(0, 10);

      for (const time of normTimes) {
        await client.query(
          `INSERT INTO schedules (medicine_id, schedule_date, time, status, dosage)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT DO NOTHING`,
          [medRes.rows[0].id, scheduleDate, time, 'pending', `${dosage} ${unit}`]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json(medRes.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Add medicine error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/medicines/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const medCheck = await pool.query(
      'SELECT id FROM medicines WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (medCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Medicine not found' });
    }

    await pool.query('DELETE FROM schedules WHERE medicine_id = $1', [id]);
    await pool.query('DELETE FROM medicines WHERE id = $1', [id]);

    return res.json({ success: true });
  } catch (err) {
    console.error('Delete medicine error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
