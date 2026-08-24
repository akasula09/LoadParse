/**
 * POST /api/parse
 *
 * Serverless endpoint (Vercel Node.js function format — works on Vercel as-is;
 * port the handler body into an Express route, Netlify function, or
 * Cloudflare Worker with minimal changes).
 *
 * Keeps the Groq API key server-side. The browser never sees it — the
 * dashboard (app.js) only ever talks to this endpoint.
 *
 * Env var required: GROQ_API_KEY
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

const SYSTEM_PROMPT = `You are a freight dispatch data extraction engine.
You will be given raw, messy text from a rate confirmation, load sheet, email, or text message.

Extract the following structured fields:
- pickup: { location (City, ST ZIP), date (human readable), time_window }
- delivery: { location (City, ST ZIP), date (human readable), time_window }
- financial: { rate (formatted as currency), rate_type (flat / per_mile), trailer }
- notes: any special instructions (BOL required, appointment delivery, lumper fees, detention terms, drop trailer, etc.)

CRITICAL GUARDRAIL: Compare the pickup date and delivery date.
If the delivery date falls BEFORE the pickup date, this is a physical impossibility.
Set "warning" to a clear, specific sentence explaining the conflict and telling the
dispatcher to confirm with the broker before dispatching. If there is no conflict,
set "warning" to null.

If a field cannot be found in the source text, set it to null — never invent data.

Respond with ONLY valid JSON, no markdown fences, no commentary, matching exactly:
{
  "pickup": {"location": string|null, "date": string|null, "time_window": string|null},
  "delivery": {"location": string|null, "date": string|null, "time_window": string|null},
  "financial": {"rate": string|null, "rate_type": string|null, "trailer": string|null},
  "notes": string|null,
  "warning": string|null
}`;

export default async function handler(req, res) {
  // Allow a lightweight OPTIONS ping so the frontend can detect a live backend.
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST' });
    return;
  }

  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Missing "text" field with the raw load sheet.' });
    return;
  }

  if (!process.env.GROQ_API_KEY) {
    res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server.' });
    return;
  }

  try {
    const groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        max_tokens: 700,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text.slice(0, 8000) }, // basic input cap
        ],
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      res.status(502).json({ error: 'Groq request failed', detail: errText });
      return;
    }

    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content?.trim() || '{}';
    const cleaned = raw.replace(/^```json\s*|```$/g, '');

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      res.status(502).json({ error: 'Model returned non-JSON output', raw: cleaned });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: 'Unexpected server error', detail: String(err) });
  }
}
