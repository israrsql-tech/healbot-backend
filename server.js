// server.js
const express = require('express');
const cors = require('cors');
const pool = require('./db');
require('dotenv').config();

const app = express();

const allowedOrigins = [
  "http://localhost:3000",
  "https://healbot-gules.vercel.app",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/medicines', require('./routes/medicines'));
app.use('/api/family-members', require('./routes/familyMembers'));  // 👈 NEW
app.use('/api/schedules', require('./routes/schedules'));
app.use('/api/history', require('./routes/history'));
app.use('/api/chat', require('./routes/chat'));

// TODO: /api/schedules, /api/history files bhi baad me add karenge

// Test route
app.get('/api/test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ message: 'Backend connected to PostgreSQL!', time: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const listEndpoints = require("express-list-endpoints");
console.log(listEndpoints(app));


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
