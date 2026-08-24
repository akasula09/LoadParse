/* ==========================================================================
   LoadParse dashboard logic.

   Production path:  POST /api/parse  -> serverless function -> Groq API
                      (see /api/parse.js). Keeps the Groq key server-side.

   This static demo has no deployed backend, so if /api/parse isn't
   reachable, LoadParse falls back to a local heuristic parser so the
   two-panel workflow is still fully demonstrable offline. The engine
   status pill tells you honestly which mode you're in.
   ========================================================================== */

const els = {
  input: document.getElementById('raw-input'),
  charCount: document.getElementById('char-count'),
  parseBtn: document.getElementById('parse-btn'),
  empty: document.getElementById('output-empty'),
  loading: document.getElementById('output-loading'),
  result: document.getElementById('output-result'),
  copyAll: document.getElementById('copy-all-btn'),
  toast: document.getElementById('toast'),
  statusPill: document.getElementById('engine-status'),
  statusText: document.getElementById('engine-status-text'),
};

let engineMode = 'checking'; // 'live' | 'demo'
let lastParsed = null;

/* ---------------------------- engine status ---------------------------- */
async function checkEngine(){
  try{
    const res = await fetch('/api/parse', { method: 'OPTIONS' });
    if(res.ok || res.status === 405 || res.status === 204){
      engineMode = 'live';
    } else {
      engineMode = 'demo';
    }
  } catch(e){
    engineMode = 'demo';
  }
  renderEngineStatus();
}

function renderEngineStatus(){
  if(engineMode === 'live'){
    els.statusPill.classList.remove('offline');
    els.statusText.textContent = 'Groq engine connected';
  } else {
    els.statusPill.classList.add('offline');
    els.statusText.textContent = 'Demo mode — local parser (no backend deployed)';
  }
}
checkEngine();

/* ------------------------------ char count ------------------------------ */
els.input.addEventListener('input', () => {
  els.charCount.textContent = `${els.input.value.length} characters`;
});

/* -------------------------------- samples -------------------------------- */
const SAMPLES = {
  clean: `PICKUP: Springfield, IL 62701 — Aug 25, 2026, 08:00-10:00
DELIVERY: Columbus, OH 43004 — Aug 26, 2026, 14:00-16:00
RATE: $1,850.00 flat rate
TRAILER: #5521
NOTES: BOL required, appointment delivery, no lumper fee`,

  messy: `pu springfield IL 62701 8/25 0800-1000
del columbus oh 43004 8/26 1400-1600
rate 1850 flat trl#5521
bol req'd appt del no lumper!!
call dispatch if detention >2hrs`,

  conflict: `PICKUP: Phoenix, AZ 85003 — Sep 3, 2026, 07:00-09:00
DELIVERY: Las Vegas, NV 89101 — Sep 1, 2026, 11:00-13:00
RATE: $975.00 flat
TRAILER: #2290
NOTES: drop trailer, no touch freight`,
};

document.querySelectorAll('[data-sample]').forEach(btn => {
  btn.addEventListener('click', () => {
    els.input.value = SAMPLES[btn.dataset.sample];
    els.input.dispatchEvent(new Event('input'));
    els.input.focus();
  });
});

/* -------------------------------- toast -------------------------------- */
let toastTimer;
function showToast(msg){
  clearTimeout(toastTimer);
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1800);
}

/* ------------------------------- clipboard ------------------------------- */
function copyText(text, label){
  navigator.clipboard?.writeText(text).then(() => {
    showToast(`Copied ${label}`);
  }).catch(() => {
    showToast('Copy failed — select manually');
  });
}

/* ------------------------------- parse flow ------------------------------- */
els.parseBtn.addEventListener('click', async () => {
  const text = els.input.value.trim();
  if(!text){
    showToast('Paste a load sheet first');
    return;
  }

  els.empty.style.display = 'none';
  els.result.style.display = 'none';
  els.loading.style.display = 'flex';
  els.copyAll.style.display = 'none';

  let data;
  try{
    if(engineMode === 'live'){
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if(!res.ok) throw new Error('backend error');
      data = await res.json();
    } else {
      data = await demoParse(text);
    }
  } catch(err){
    // Backend hiccup mid-session — degrade gracefully to the local parser
    // rather than dead-ending the dispatcher.
    data = await demoParse(text);
    engineMode = 'demo';
    renderEngineStatus();
  }

  lastParsed = data;
  renderResult(data);
});

/* ---------------------------------------------------------------------------
   Demo-mode local parser.
   Heuristic extraction so the UI is fully demonstrable without a deployed
   Groq backend. The production /api/parse function replaces this with a
   real llama-3.3-70b-versatile call (see api/parse.js).
   ------------------------------------------------------------------------- */
function demoParse(raw){
  return new Promise(resolve => {
    setTimeout(() => {
      const text = raw.replace(/\r/g, '');
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

      const cityStateZip = /([A-Za-z .]+?),?\s+([A-Za-z]{2})\s+(\d{5})/;
      const rateMatch = text.match(/\$?\s?([\d,]{2,7}(?:\.\d{2})?)\s*(flat|per\s?mile|\/mi)?/i);
      const trailerMatch = text.match(/(?:trl|trailer)\s?#?\s?(\w+)/i);

      const pickupLine = lines.find(l => /\bpu\b|pickup/i.test(l)) || lines[0] || '';
      const deliveryLine = lines.find(l => /\bdel\b|delivery/i.test(l)) || lines[1] || '';

      const pickupLoc = pickupLine.match(cityStateZip);
      const deliveryLoc = deliveryLine.match(cityStateZip);

      const pickupDate = extractDate(pickupLine, text);
      const deliveryDate = extractDate(deliveryLine, text, pickupDate ? 1 : 0);

      const notesLine = lines.find(l => /bol|lumper|appt|appointment|detention|drop|no touch/i.test(l)) || '';

      const conflict = pickupDate && deliveryDate && deliveryDate.sortable < pickupDate.sortable;

      resolve({
        pickup: {
          location: pickupLoc ? `${titleCase(pickupLoc[1])}, ${pickupLoc[2].toUpperCase()} ${pickupLoc[3]}` : 'Not detected — check source text',
          date: pickupDate ? pickupDate.display : 'Not detected',
        },
        delivery: {
          location: deliveryLoc ? `${titleCase(deliveryLoc[1])}, ${deliveryLoc[2].toUpperCase()} ${deliveryLoc[3]}` : 'Not detected — check source text',
          date: deliveryDate ? deliveryDate.display : 'Not detected',
        },
        financial: {
          rate: rateMatch ? `$${Number(rateMatch[1].replace(/,/g,'')).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}${rateMatch[2] ? ' ' + rateMatch[2].replace('per?mile','per mile') : ' flat'}` : 'Not detected',
          trailer: trailerMatch ? `#${trailerMatch[1]}` : 'Not detected',
        },
        notes: notesLine || 'No special instructions detected',
        warning: conflict
          ? `Delivery date (${deliveryDate.display}) falls before the pickup date (${pickupDate.display}). This load cannot be run as written — confirm with the broker before dispatching.`
          : null,
      });
    }, 900 + Math.random() * 500);
  });
}

function titleCase(str){
  return str.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// Very small date heuristic covering "8/25", "Aug 25, 2026", "Aug 25" formats.
// Assumes current year when no year is given — good enough for a demo parser.
function extractDate(line, fullText, fallbackIndex){
  const monthNames = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
  const source = line || fullText;
  let m = source.match(new RegExp(`(${monthNames})[a-z]*\\.?\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?`, 'i'));
  if(m){
    const monthIdx = monthNames.split('|').indexOf(m[1].toLowerCase().slice(0,3));
    const day = parseInt(m[2], 10);
    const year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
    const d = new Date(year, monthIdx, day);
    return { display: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), sortable: d.getTime() };
  }
  m = source.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if(m){
    const month = parseInt(m[1],10) - 1;
    const day = parseInt(m[2],10);
    const year = m[3] ? (m[3].length === 2 ? 2000+parseInt(m[3],10) : parseInt(m[3],10)) : new Date().getFullYear();
    const d = new Date(year, month, day);
    return { display: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), sortable: d.getTime() };
  }
  return null;
}

/* -------------------------------- render -------------------------------- */
function renderResult(data){
  els.loading.style.display = 'none';
  els.result.style.display = 'block';
  els.copyAll.style.display = 'inline-flex';

  const warningHtml = data.warning ? `
    <div class="warn-banner">
      <span class="flag">⚠ Guardrail</span>
      <span class="msg"><b>Date conflict flagged.</b> ${escapeHtml(data.warning)}</span>
    </div>` : '';

  els.result.innerHTML = `
    ${warningHtml}
    <div class="result-card">
      <div class="stamp-abs ${data.warning ? 'hold' : ''}" id="stamp">${data.warning ? 'HOLD —<br>REVIEW' : 'VERIFIED'}</div>

      <div class="result-section">
        <h3>Stops</h3>
        <div class="stops-list">
          <div class="stop pickup">
            <span class="stop-tag">Pickup</span>
            <div class="stop-body">
              <b class="copy-field" data-value="${escapeAttr(data.pickup.location)}">${escapeHtml(data.pickup.location)}</b>
              <span>${escapeHtml(data.pickup.date)}</span>
            </div>
          </div>
          <div class="stop delivery">
            <span class="stop-tag">Delivery</span>
            <div class="stop-body">
              <b class="copy-field" data-value="${escapeAttr(data.delivery.location)}">${escapeHtml(data.delivery.location)}</b>
              <span>${escapeHtml(data.delivery.date)}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="result-section">
        <h3>Financial</h3>
        <div class="result-row"><span class="rk">Rate</span><span class="rv copyable copy-field" data-value="${escapeAttr(data.financial.rate)}">${escapeHtml(data.financial.rate)}</span></div>
        <div class="result-row"><span class="rk">Trailer</span><span class="rv copyable copy-field" data-value="${escapeAttr(data.financial.trailer)}">${escapeHtml(data.financial.trailer)}</span></div>
      </div>

      <div class="result-section">
        <h3>Notes</h3>
        <div class="result-row"><span class="rv" style="font-family:var(--font-body); font-weight:400; text-align:left;">${escapeHtml(data.notes)}</span></div>
      </div>

      <div class="result-foot">
        <button class="btn btn-ghost" id="copy-json-btn">Copy as JSON</button>
      </div>
    </div>
  `;

  // stamp animation
  requestAnimationFrame(() => {
    setTimeout(() => document.getElementById('stamp')?.classList.add('show'), 120);
  });

  // per-field copy
  els.result.querySelectorAll('.copy-field').forEach(node => {
    node.addEventListener('click', () => copyText(node.dataset.value, node.textContent.trim()));
  });

  document.getElementById('copy-json-btn').addEventListener('click', () => {
    copyText(JSON.stringify(data, null, 2), 'load JSON');
  });
}

els.copyAll.addEventListener('click', () => {
  if(!lastParsed) return;
  const d = lastParsed;
  const text = [
    `Pickup: ${d.pickup.location} — ${d.pickup.date}`,
    `Delivery: ${d.delivery.location} — ${d.delivery.date}`,
    `Rate: ${d.financial.rate}`,
    `Trailer: ${d.financial.trailer}`,
    `Notes: ${d.notes}`,
  ].join('\n');
  copyText(text, 'full load summary');
});

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(str){ return escapeHtml(str).replace(/"/g, '&quot;'); }
