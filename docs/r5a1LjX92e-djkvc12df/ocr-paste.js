/* ================= OCR PASTE ADD-ON (proxy + multi-address) ================= */

/* ---------- CONFIG ---------- */
const OCR_CONFIG = {
  // Use the proxy we just deployed so this works on any PC with no login:
  backend: 'proxy',     // 'proxy' | 'vision' | 'tesseract'
  ocrProxyUrl: 'https://ocrproxy-20209668074.northamerica-northeast2.run.app', // <-- your Cloud Run URL
  // If you ever want to go direct (not recommended), keep the Vision key here:
  visionApiKey: '',     // not used when backend==='proxy'
  lang: 'eng'
};

/* ---------- OPTIONAL: Tesseract lazy loader (client-side fallback) ---------- */
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

/* ---------- OCR core ---------- */
async function ocrFromClipboardImage(blob){
  const b64 = await blobToBase64(blob);

  if (OCR_CONFIG.backend === 'proxy' && OCR_CONFIG.ocrProxyUrl){
    try{
      const res = await fetch(`${OCR_CONFIG.ocrProxyUrl.replace(/\/+$/,'')}/ocr`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ imageB64: b64, lang: OCR_CONFIG.lang })
      });
      const json = await res.json().catch(()=>null);
      const text = json?.text || '';
      console.log('[OCR] proxy ok, chars:', text.length);
      return text;
    }catch(err){
      console.warn('[OCR] proxy failed, falling back to tesseract', err);
      // fall through to tesseract
    }
  }

  if (OCR_CONFIG.backend === 'vision' && OCR_CONFIG.visionApiKey){
    const req = {
      requests: [{
        image: { content: b64.replace(/^data:image\/\w+;base64,/, '') },
        features: [{ type: 'TEXT_DETECTION' }]
      }]
    };
    const res = await fetch(
      'https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(OCR_CONFIG.visionApiKey),
      { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(req) }
    ).then(r=>r.json()).catch(()=>null);
    const text = res?.responses?.[0]?.fullTextAnnotation?.text || '';
    console.log('[OCR] vision direct ok, chars:', text.length);
    return text;
  }

  // Tesseract (always available as a last resort)
  const T = await ensureTesseract();
  const { data:{ text } } = await T.recognize(blob, OCR_CONFIG.lang, { tessedit_pageseg_mode: 6 });
  console.log('[OCR] tesseract ok, chars:', (text||'').length);
  return text || '';
}

function blobToBase64(blob){
  return new Promise((res)=>{
    const r = new FileReader();
    r.onload = ()=> res(r.result);
    r.readAsDataURL(blob);
  });
}

/* ---------- Address extraction (global regex; keeps order & dedups) ---------- */
/* We sweep the whole OCR text and pull every "#### Name <type>" occurrence. */
const STREET_TYPE_RX = `St(?:reet)?|Ave(?:nue)?|Rd|Road|Dr|Drive|Blvd|Boulevard|Hwy|Highway|Way|Lane|Ln|Court|Ct|Place|Pl|Trail|Terrace|Cres(?:cent)?|Close|Pkwy|Parkway`;
const ADDRESS_GLOB_RX = new RegExp(
  String.raw`\b(\d{3,6})\s+([A-Za-z0-9.'\- ]+?)\s+(${STREET_TYPE_RX})\b`,
  'gi'
);

function extractAddresses(text){
  if (!text) return [];
  ADDRESS_GLOB_RX.lastIndex = 0;   // <-- IMPORTANT: reset global regex state
  const found = [];
  let m;
  while ((m = ADDRESS_GLOB_RX.exec(text)) !== null){
    const number = m[1];
    const name   = m[2].replace(/\s+/g,' ').trim();
    const type   = m[3];
    const addr   = `${number} ${name} ${type}`.replace(/\s+/g,' ').trim();
    found.push(addr);
  }
  // Dedup while preserving order
  const seen = new Set();
  const out = [];
  for (const a of found){
    const k = a.toLowerCase();
    if (!seen.has(k)){ seen.add(k); out.push(a); }
  }
  return out;
}

/* ---------- Fill helper: put each address into its own stop ---------- */
async function fillSequentialFrom(input, addresses){
  if (!addresses.length) return;

  // Put the first address in the current input
  applyAddressToInput(input, addresses[0]);

  // For the rest, advance/create rows using your existing helpers
  for (let i=1; i<addresses.length; i++){
    if (window.flatMode) {
      // advance or create a new row (your app’s helper)
      window.focusNextInFlatOrCreate(input, false);
    } else {
      window.focusNextInFrameOrCreate(input, false);
    }
    // Try to locate the currently focused stop, or last created
    let next = document.activeElement && document.activeElement.classList?.contains('stop')
      ? document.activeElement
      : (window.flatMode
         ? document.querySelector('#addrList .row:last-child .stop')
         : input.closest('.row')?.nextElementSibling?.querySelector('.stop'));
    if (!next) break;
    applyAddressToInput(next, addresses[i]);
    input = next;
  }

  if (window.renumber) window.renumber();
  if (window.scheduleAutoCompute) { window.autoResolveNext = true; window.scheduleAutoCompute(0,true); }
}

function applyAddressToInput(el, addr){
  el.value = addr;
  el.dataset.lat = '';
  el.dataset.lng = '';
  el.dataset.dirty = '1';
}

/* ---------- Paste handler (image only) ---------- */
document.addEventListener('paste', async (ev)=>{
  const target = ev.target;
  if (!target || !target.classList || !target.classList.contains('stop')) return;

  const dt = ev.clipboardData;
  if (!dt) return;

  let blob = null;

  // Try items[] first
  if (dt.items && dt.items.length){
    for (const it of dt.items){
      if (it.kind === 'file' && it.type && it.type.startsWith('image/')){
        blob = it.getAsFile(); break;
      }
    }
  }
  // Fallback: files[]
  if (!blob && dt.files && dt.files.length){
    const f = dt.files[0];
    if (f.type && f.type.startsWith('image/')) blob = f;
  }

  if (!blob) return;                 // Let normal text pastes through

  ev.preventDefault();
  ev.stopImmediatePropagation();     // make sure our handler wins

  try{
    const text = await ocrFromClipboardImage(blob);
    const addresses = extractAddresses(text);

    // Extra light backup: check line-by-line if global regex found nothing
    if (!addresses.length && text){
      const lines = text.split(/\r?\n+/).map(s=>s.trim()).filter(Boolean);
      for (const ln of lines){
        const mm = ln.replace(/[,\s]+(?:Kelowna|West Kelowna|Lake Country|Peachland)\b.*$/i,'')
             .match(new RegExp(String.raw`^(\d{3,6})\s+([A-Za-z0-9.'\- ]+?)\s+(${STREET_TYPE_RX})\b`, 'i'));
        if (mm){
          addresses.push(`${mm[1]} ${mm[2].replace(/\s+/g,' ').trim()} ${mm[3]}`.trim());
        }
      }
      // Dedup preserve order
      const uniq = [];
      const seen = new Set();
      for (const a of addresses){ const k=a.toLowerCase(); if(!seen.has(k)){ seen.add(k); uniq.push(a);} }
      addresses.splice(0, addresses.length, ...uniq);
    }

    console.log('[OCR] extracted:', addresses);

if (window.applyAddressesList) {
  await window.applyAddressesList(target, addresses);
} else {
  // fallback (older builds): keep previous sequential filler
  await fillSequentialFrom(target, addresses);
}
  }catch(err){
    console.error('OCR paste failed:', err);
  }
}, true);
