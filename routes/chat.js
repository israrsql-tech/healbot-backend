const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const pool = require("../db");

const SYSTEM_PROMPT = `
You are a multilingual health assistant for a medicine reminder app.

Hard rules:
- Reply in the same language as the user's latest message.
- No diagnosis. No prescription changes. No "start/stop/change dose" advice.
- Provide general educational information.
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

    // Medicines
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

    const lastMsgs = messages.slice(-8).map((m) => ({
      role: m.role || "user",
      content: clampText(m.content, 2000),
    }));

    const prompt =
      SYSTEM_PROMPT +
      "\n\nCONTEXT:\n" +
      JSON.stringify(contextObj, null, 2) +
      "\n\nCHAT:\n" +
      lastMsgs.map((m) => `${m.role}: ${m.content}`).join("\n") +
      "\n\nAssistant:";

    // ===============================
    // REPLICATE API START
    // ===============================

    // Step 1: Create prediction
    const createPrediction = await fetch(
      "https://api.replicate.com/v1/predictions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.REPLICATE_API_TOKEN}`
        },
        body: JSON.stringify({
          model: "meta/meta-llama-3-8b-instruct",
          input: {
            prompt: prompt,
            max_new_tokens: 650,
            temperature: 0.3
          }
        })
      }
    );

    const predictionData = await createPrediction.json();

    if (!createPrediction.ok) {
      console.error("Replicate Error:", predictionData);
      return res.status(500).json({ error: "Replicate request failed" });
    }

    let predictionId = predictionData.id;
    let status = predictionData.status;
    let result;

    // Step 2: Poll until finished
    while (status !== "succeeded" && status !== "failed") {
      await new Promise(resolve => setTimeout(resolve, 1500));

      const poll = await fetch(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        {
          headers: {
            "Authorization": `Bearer ${process.env.REPLICATE_API_TOKEN}`
          }
        }
      );

      result = await poll.json();
      status = result.status;
    }

    if (status === "failed") {
      return res.status(500).json({ error: "Model failed" });
    }

    const reply = Array.isArray(result.output)
      ? result.output.join("")
      : result.output || "";

    return res.json({ reply });

    // ===============================
    // REPLICATE API END
    // ===============================

  } catch (error) {
    console.error("CHAT ERROR:", error);
    return res.status(500).json({ error: "Chat failed" });
  }
});

module.exports = router;