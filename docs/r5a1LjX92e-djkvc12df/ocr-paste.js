/* ================= OCR PASTE ADD-ON (via Cloud Run proxy) ================= */

/* ---------- CONFIG ---------- */
const OCR_CONFIG = {
  backend: 'proxy',   // 'proxy' (Cloud Run) or 'tesseract'
  proxyUrl: 'https://ocrproxy-20209668074.northamerica-northeast2.run.app/ocr',
  lang: 'eng'
};

// Lazy loader for Tesseract (single worker)
let __tessReady = null;
function ensureTesseract(){
  if (__tessReady) return __tessReady;
  __tessReady = new Promise((resolve, reject)=>{
    if (window.Tesseract) return resolve(window.Tesseract);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js';
    s.onload = ()=> resolve(window.Tesseract);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return __tessReady;
}

// Extract text from a pasted image (PNG/JPEG/clipboard bitmap)
async function ocrFromClipboardImage(blob){
  // --------- Use your Cloud Run proxy ----------
  if (OCR_CONFIG.backend === 'proxy' && OCR_CONFIG.proxyUrl){
    const b64 = await blobToBase64(blob); // data:image/...;base64,AAAA...
    const res = await fetch(OCR_CONFIG.proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageB64: b64,      // send full data URL; proxy strips the header
        lang: OCR_CONFIG.lang || 'eng'
      }),
    }).then(r => r.json()).catch(()=> null);

    // expected proxy response: { text: "..." }  or  { error: "..." }
    if (res && res.text) return res.text;
    console.error('Proxy OCR error:', res);
    return '';
  }

  // --------- Tesseract fallback (fully client-side) ----------
  const T = await ensureTesseract();
  const { data:{ text } } = await T.recognize(
    blob,
    OCR_CONFIG.lang || 'eng',
    { tessedit_pageseg_mode: 6 }
  );
  return text || '';
}

function blobToBase64(blob){
  return new Promise((res)=>{
    const r = new FileReader();
    r.onload = ()=> res(r.result);
    r.readAsDataURL(blob);
  });
}

// ---------------- Parsing: keep only real street addresses ----------------
// Strips unit/suite and facility names, keeps number + street, like "3163 Richter St"
function normalizeAddressLine(s){
  let t = (s||'').replace(/\s+/g,' ').trim();

  // remove leading unit/suite markers (e.g., "#304-", "Unit 12,", "Suite 5 –")
  t = t.replace(/^(?:#\s*\d+[A-Z]?\s*[-–]\s*|\b(?:unit|suite|apt|apartment)\b\s*\d+[A-Z]?\s*[-–]?\s*)/i, '');

  // try to capture street number + name + street type
  const streetType = "(?:St(?:reet)?|Ave(?:nue)?|Rd|Road|Dr|Drive|Blvd|Boulevard|Hwy|Highway|Way|Lane|Ln|Court|Ct|Place|Pl|Trail|Cres(?:cent)?|Close|Pkwy|Parkway)";
  const m = t.match(new RegExp(
    String.raw`^(\d{3,6})\s+([A-Za-z0-9.'\- ]+?)\s+${streetType}\b(?:[^\n,]*)`,
    'i'
  ));
  if (!m) return null;

  // recompose as "#### StreetName St"
  const number = m[1];
  const name   = m[2].replace(/\s+/g,' ').trim();
  const type   = (t.slice(m.index).match(new RegExp(streetType,'i'))||[''])[0];
  let out = `${number} ${name} ${type}`.replace(/\s+/g,' ').trim();

  return out;
}

function extractAddressesInOrder(rawText){
  const lines = (rawText||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const out = [];
  for (const ln of lines){
    const v = normalizeAddressLine(ln);
    if (v) out.push(v);
  }
  // Compact duplicates that are immediately repeated in the OCR text
  return out.filter((v,i)=> i===0 || v.toLowerCase()!==out[i-1].toLowerCase());
}

// ---------------- Fill helper: respects your flat/framed advance logic ----------------
// ---------------- Fill helper: use app bulk-paste when available, otherwise create rows ---------
async function fillSequentialFrom(input, addresses){
  if (!addresses || !addresses.length) return;

  // If your app exposes a bulk/multi paste helper, use it (it handles row creation perfectly).
  // Common names we've seen; harmless if not present:
  const bulk = window.multiPaste || window.bulkPasteStops || window.handleBulkPaste;
  if (typeof bulk === 'function') {
    // Most implementations expect a single string with newlines
    try {
      bulk(addresses.join('\n'), input);
      return;
    } catch (e) {
      console.warn('App bulk-paste helper threw, falling back to manual fill:', e);
      // fall through to manual loop
    }
  }

  // Manual fallback: set the first, then keep creating/focusing the next .stop and fill it.
  const setDirty = el => { el.dataset.lat=''; el.dataset.lng=''; el.dataset.dirty='1'; };

  // Put the first address into the current input
  input.value = addresses[0];
  setDirty(input);

  // Helper: get or create the next .stop input
  function getOrCreateNextStop(fromInput){
    // 1) Try “next row’s .stop”
    let row = fromInput.closest('.row') || fromInput.closest('li') || fromInput.parentElement;
    let next = row && row.nextElementSibling && (row.nextElementSibling.querySelector?.('input.stop'));
    if (next) return next;

    // 2) Ask app helpers (if you have these we used earlier)
    if (typeof window.focusNextInFlatOrCreate === 'function') {
      window.focusNextInFlatOrCreate(fromInput, false);
    } else if (typeof window.focusNextInFrameOrCreate === 'function') {
      window.focusNextInFrameOrCreate(fromInput, false);
    }

    // Did focusing helpers create one?
    next = document.activeElement && document.activeElement.classList?.contains('stop')
      ? document.activeElement
      : null;
    if (next) return next;

    // 3) Click a visible “add” button on the last row (covers most UIs)
    const lastRow = (row?.parentElement || document).querySelector('.row:last-child');
    const addBtn =
      lastRow?.querySelector('.add, [data-add], .add-stop, button[title*="Add"], .fa-plus, .icon-plus');
    if (addBtn) addBtn.click();

    // 4) Grab the new last row's .stop input
    const newLast = (row?.parentElement || document).querySelector('.row:last-child input.stop')
                 || document.querySelector('#addrList .row:last-child input.stop')
                 || document.querySelector('input.stop:last-of-type');

    return newLast || null;
  }

  // Fill the rest
  let current = input;
  for (let i = 1; i < addresses.length; i++) {
    const next = getOrCreateNextStop(current);
    if (!next) {
      console.warn('Could not find/create the next stop input for', addresses[i]);
      break;
    }
    next.value = addresses[i];
    setDirty(next);
    current = next;
  }

  // Trigger your normal pipeline
  if (typeof window.renumber === 'function') window.renumber();
  if (typeof window.scheduleAutoCompute === 'function') {
    window.autoResolveNext = true;
    window.scheduleAutoCompute(0, true);
  }
}

// --- keep this callsite the same (just adding a console so we can see what OCR produced) ---
document.addEventListener('paste', async (ev)=>{
  const target = ev.target;
  if (!target || !target.classList || !target.classList.contains('stop')) return;

  const dt = ev.clipboardData;
  if (!dt) return;

  let blob = null;
  if (dt.items && dt.items.length){
    for (const it of dt.items){
      if (it.kind === 'file' && it.type && it.type.startsWith('image/')) { blob = it.getAsFile(); break; }
    }
  }
  if (!blob && dt.files && dt.files.length){
    const f = dt.files[0];
    if (f.type && f.type.startsWith('image/')) blob = f;
  }
  if (!blob) return;                // let your normal text paste happen

  ev.preventDefault();              // we’re handling the image

  try{
    const text = await ocrFromClipboardImage(blob);
    let addresses = extractAddressesInOrder(text);

    if (!addresses.length && text){
      const quick = text.split(/[\r\n,]+/).map(s=>s.trim()).filter(Boolean);
      for (const q of quick){
        const v = normalizeAddressLine(q);
        if (v) addresses.push(v);
      }
      // dedupe again just in case
      addresses = addresses.filter((v,i,a)=> a.findIndex(x=>x.toLowerCase()===v.toLowerCase())===i);
    }

    console.log('OCR addresses:', addresses); // helpful to confirm we got >1
    await fillSequentialFrom(target, addresses);
  }catch(err){
    console.error('OCR paste failed:', err);
  }
}, true);
