/**
 * POST /api/parse
 *
 * Serverless endpoint (Vercel Node.js function format — works on Vercel as-is;
 * port the handler body into an Express route, Netlify function, or
 * Cloudflare Worker with minimal changes).
 *
 * Keeps the Groq API key server-side. The browser never sees it.
 *
 * Input is always plain text by the time it reaches this function — the
 * frontend (app.js) extracts text from PDFs (pdf.js) and spreadsheets
 * (SheetJS) client-side before calling this endpoint, so this handler
 * never has to parse binary files itself. It just has to be robust to
 * text that looks like *anything*: a clean rate confirmation, a forwarded
 * email thread, a text message, an OCR'd scanned document with jumbled
 * spacing, or a CSV/table dump pulled out of a spreadsheet with its own
 * (possibly inconsistent) column headers.
 *
 * Env var required: GROQ_API_KEY
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

// Spreadsheet/PDF extraction can produce much longer text than a pasted
// rate con — cap generously rather than truncating real content.
const MAX_INPUT_CHARS = 24000;

const SYSTEM_PROMPT = `You are a freight dispatch data extraction engine. You will be given raw text pulled from ANY source a dispatcher might hand you — a clean rate confirmation, a messy forwarded email, a text message, a scanned/OCR'd PDF with jumbled spacing and line breaks, or a CSV/table dump extracted from a spreadsheet (which may include its own header row using any column naming convention, extra blank cells, or multiple sheets separated by "--- Sheet: name ---" markers).

Do not assume a fixed layout. Read the whole document, identify shipping details wherever they appear, and handle any of these variations gracefully:
- Abbreviations and shorthand: pu/pickup, del/drop/deliver, apt/appt, trl, bol, po#, lumper, TONU, detention, live load/unload, drop trailer, hook.
- Any date format: "8/24", "08-24-26", "Aug 24, 2026", "next day", "tmrw" (resolve relative dates only if an anchor date is present in the text; otherwise leave the date as written).
- Any number of stops. Many loads are simple one-pickup-one-delivery, but some have multiple pickups and/or multiple deliveries in sequence. Extract every stop you can identify, in the order they occur in the load (not alphabetically or by any other reordering).
- Tabular/CSV data: column headers may be named anything (e.g. "Origin"/"From"/"Ship From" all mean pickup location). Map columns by meaning, not by exact header text.
- Noise: greetings, disclaimers, signatures, forwarded-message headers, repeated boilerplate — ignore all of it and extract only the shipment data.

Extract:
- stops: an ordered array of every stop in the load, each as { type: "Pickup" | "Delivery" | "Stop", location (City, ST ZIP — as close to that format as the source allows), date (human readable) }. Use "Stop" only if you cannot tell whether it's a pickup or delivery.
- financial: { rate (formatted as currency string), rate_type ("flat" | "per_mile" | "cwt" | null), trailer (string or null) }
- cargo: { weight (string or null), commodity (string or null), temperature (string or null, for reefer loads) } — omit entirely (set cargo to null) if nothing cargo-related is present.
- references: { load_number, po_number, bol_number } (each string or null) — set references to null entirely if none are present.
- notes: any special instructions (appointment requirements, lumper fees, detention terms, drop-trailer, no-touch freight, seal numbers, etc.) as a single readable sentence, or null if genuinely none found.

CRITICAL GUARDRAIL: After extracting all stops in the order they appear in the source document, check whether their dates are chronologically consistent with that order — i.e. no stop should have a date earlier than an earlier-listed stop's date, since that would be a physical impossibility (you can't deliver before you pick up, or reach stop 3 before stop 2). If you find such a conflict, set "warning" to a clear, specific sentence naming the two stops involved and telling the dispatcher to confirm with the broker before dispatching. If dates are consistent, or if too few dates were found to check, set "warning" to null.

If a field cannot be found anywhere in the source text, set it to null (or omit stops you have zero evidence for) — never invent or guess data that isn't there.

Respond with ONLY valid JSON, no markdown fences, no commentary, matching exactly this shape:
{
  "stops": [{"type": string, "location": string|null, "date": string|null}],
  "financial": {"rate": string|null, "rate_type": string|null, "trailer": string|null},
  "cargo": {"weight": string|null, "commodity": string|null, "temperature": string|null} | null,
  "references": {"load_number": string|null, "po_number": string|null, "bol_number": string|null} | null,
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
    res.status(400).json({ error: 'Missing "text" field with the extracted load sheet text.' });
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
        max_tokens: 1400,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text.slice(0, MAX_INPUT_CHARS) },
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

    // Defensive normalization so a slightly-off model response still renders.
    if (!Array.isArray(parsed.stops)) parsed.stops = [];
    if (!parsed.financial || typeof parsed.financial !== 'object') {
      parsed.financial = { rate: null, rate_type: null, trailer: null };
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: 'Unexpected server error', detail: String(err) });
  }
}
