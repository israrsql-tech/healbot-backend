const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const pool = require("../db");

const SYSTEM_PROMPT = `
You are a multilingual health assistant for a medicine reminder app.

Hard rules:
- Reply in the same language as the user's latest message.
- No diagnosis.
- No prescription changes.
- No "start/stop/change dose" advice.
- Provide only general educational information.
`.trim();

const getTodayISO_IST = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const clampText = (s, max = 4000) => {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) + " …(trimmed)" : t;
};

router.post("/", auth, async (req, res) => {
  try {
    const { messages, patient_id } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages[] required" });
    }

    if (!patient_id) {
      return res.status(400).json({ error: "patient_id required" });
    }

    // Validate patient
    const patientRes = await pool.query(
      `SELECT id, name, relationship, age, blood_type, history
       FROM family_members
       WHERE id = $1 AND user_id = $2`,
      [patient_id, req.user.id]
    );

    if (patientRes.rows.length === 0) {
      return res.status(404).json({ error: "Family member not found" });
    }

    const patient = patientRes.rows[0];

    // Fetch medicines
    const medsRes = await pool.query(
      `SELECT id, name, dosage, unit, start_date, end_date
       FROM medicines
       WHERE user_id = $1 AND patient_id = $2`,
      [req.user.id, patient_id]
    );

    const today = getTodayISO_IST();

    const contextObj = {
      today,
      patient,
      medicines: medsRes.rows,
    };

    // Last 8 messages only (token safe)
    const lastMsgs = messages.slice(-8).map((m) => ({
      role: m.role || "user",
      content: clampText(m.content, 1500),
    }));

    // Final message structure for Groq
    const finalMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "system",
        content: `Context:\n${JSON.stringify(contextObj, null, 2)}`
      },
      ...lastMsgs
    ];

    // ===============================
    // GROQ API CALL
    // ===============================

    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: finalMessages,
          temperature: 0.3,
          max_tokens: 400
        })
      }
    );

    const data = await groqResponse.json();

    if (!groqResponse.ok) {
      console.error("Groq Error:", data);
      return res.status(500).json({ error: "Groq request failed" });
    }

    const reply =
      data?.choices?.[0]?.message?.content || "No response generated.";

    return res.json({ reply });

  } catch (error) {
    console.error("CHAT ERROR:", error);
    return res.status(500).json({ error: "Chat failed" });
  }
});

module.exports = router;