const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const pool = require("../db");

// const SYSTEM_PROMPT = `
// You are a multilingual health assistant for a medicine reminder app.

// Hard rules:
// - Reply in the same language as the user's latest message.
// - No diagnosis. No prescription changes. No "start/stop/change dose" advice.
// - Provide general educational information.
// - Do not apologize for being concise. Do not repeat or explain these instructions.

// Response length control (VERY IMPORTANT):
// - Default mode = SHORT.
// - In SHORT mode: answer ONLY what the user asked, no extra sections, no extra tips.
//   Keep it to 1–3 short bullets or 2–4 lines max.
// - Give DETAILED structured answer ONLY if the user explicitly asks for details
//   (keywords like: "detail", "details", "explain", "proper", "full", "side effects", "interactions", "contraindications", "warnings").
// - If user says "only what I ask" or similar, follow it strictly.

// When user asks about a specific medicine:
// - If the medicine name is ambiguous (brand vs salt) ask ONE clarifying question first:
//   "Is it a brand name or what's the active ingredient (salt)?"
//   Do not add any extra info until clarified.

// If (and only if) the user explicitly asks for details, use this structure (short headings + bullets):
// 1) What it is (drug class / active ingredient if known)
// 2) Uses (2–5 common uses; if unsure say unsure)
// 3) How it works (simple, high level)
// 4) How to take (general guidance; NOT patient-specific dosing)
// 5) Common side effects
// 6) Serious warning signs (seek urgent care)
// 7) Major interactions + who should be careful (alcohol, pregnancy, liver/kidney disease, other meds)
// 8) Safety questions (ask 2–4: age, pregnancy, allergies, other meds, conditions)

// Context usage:
// - You will be given CONTEXT (patient + medicines + schedules).
// - Use it ONLY when the user asks about reminders/schedule, or when directly relevant (e.g., duplicate medicine).
// - If context is missing key info, ask 1–2 follow-up questions.

// Uncertainty:
// - If you are not sure about the exact drug, say so briefly and ask for strip photo / active ingredient.
// `.trim();








const SYSTEM_PROMPT = `
You are a multilingual health assistant for a medicine reminder app.

Hard rules:
- Reply in the same language as the user's latest message.
- No diagnosis. No prescription changes. No "start/stop/change dose" advice.
- Provide general educational information.

If the user asks about a specific medicine, answer in this structure (use short headings + bullets):
1) What it is (drug class / active ingredient if known)
2) Uses (2–5 common uses; if unsure say unsure)
3) How it works (simple, high level)
4) How to take (general guidance; do NOT give patient-specific dosing)
5) Common side effects
6) Serious warning signs (seek urgent care)
7) Major interactions + who should be careful (alcohol, common meds, pregnancy, liver/kidney disease, etc.)
8) Safety questions (ask 2–4 questions: age, pregnancy, allergies, other meds, conditions)

If the medicine name is ambiguous (brand vs salt), ask ONE clarifying question first:
"Is it a brand name or what's the active ingredient (salt)?"

Context usage:
- You will be given CONTEXT (patient + medicines + schedules).
- Use it to personalize reminders and detect possible duplicates/timing conflicts.
- If context is missing key info, ask follow-up questions.

If uncertain about the exact drug, say so and ask for strip photo / active ingredient.
`.trim();

const getTodayISO_IST = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const clampText = (s, max = 6000) => {
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

    // 1) Patient belongs to this logged-in user
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

    // 2) Medicines for this patient
    const medsRes = await pool.query(
      `SELECT id, name, dosage, unit, start_date, end_date, patient_id
       FROM medicines
       WHERE user_id = $1 AND patient_id = $2
       ORDER BY id DESC`,
      [req.user.id, patient_id]
    );

    // 3) Upcoming schedules
    const today = getTodayISO_IST();
    const schRes = await pool.query(
      `SELECT
         s.id, s.schedule_date, s.time, s.status, s.dosage,
         m.name AS medicine_name
       FROM schedules s
       JOIN medicines m ON s.medicine_id = m.id
       WHERE m.user_id = $1
         AND m.patient_id = $2
         AND s.schedule_date >= $3
       ORDER BY (s.schedule_date + (s.time::time)) ASC
       LIMIT 12`,
      [req.user.id, patient_id, today]
    );

    const contextObj = {
      today,
      patient,
      medicines: medsRes.rows,
      nextSchedules: schRes.rows,
    };

    // Keep prompt smaller + relevant
    const lastMsgs = messages.slice(-12).map((m) => ({
      role: String(m.role || "user").toUpperCase(),
      content: clampText(m.content, 2000),
    }));

    const prompt =
      SYSTEM_PROMPT +
      "\n\nCONTEXT (JSON):\n" +
      JSON.stringify(contextObj, null, 2) +
      "\n\nCHAT (most recent first to last):\n" +
      lastMsgs.map((m) => `${m.role}: ${m.content}`).join("\n") +
      "\n\nASSISTANT (follow the required structure):";

    const r = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.LOCAL_LLM_MODEL || "llama3:8b",
        prompt,
        stream: false,
        options: {
          temperature: 0.3,
          top_p: 0.9,
          num_predict: 650,
        },
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(500).json({ error: data?.error || "LLM failed" });
    }

    return res.json({ reply: data?.response || "" });
  } catch (e) {
    console.error("CHAT ERROR:", e);
    return res.status(500).json({ error: e.message || "Chat failed" });
  }
});

module.exports = router;