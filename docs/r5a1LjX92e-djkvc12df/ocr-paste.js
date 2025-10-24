<!-- ================= OCR PASTE ADD-ON (proxy + tesseract) ================= -->

<script>
// ---------- CONFIG ----------
const OCR_CONFIG = {
  backend: 'proxy',  // 'proxy' (recommended) or 'tesseract'
  proxyUrl: 'https://ocrproxy-20209668074.northamerica-northeast2.run.app/ocr',
  lang: 'eng',
  maxBytes: 10 * 1024 * 1024 // guardrail for huge pastes (10 MB)
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

// Convert a Blob to a data: URL (base64)
function blobToBase64(blob){
  return new Promise((res)=>{
    const r = new FileReader();
    r.onload = ()=> res(r.result);
    r.readAsDataURL(blob);
  });
}

// === OCR core ===
async function ocrFromClipboardImage(blob){
  if (OCR_CONFIG.backend === 'proxy' && OCR_CONFIG.proxyUrl){
    const b64 = await blobToBase64(blob);
    // quick size guard (base64 ~ 4/3 of raw)
    if (b64.length > OCR_CONFIG.maxBytes * 1.5) {
      throw new Error('Image too large for OCR');
    }
    const res = await fetch(OCR_CONFIG.proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ imageB64: b64, lang: OCR_CONFIG.lang })
    });
    if (!res.ok){
      const t = await res.text().catch(()=>res.statusText);
      throw new Error(`Proxy error ${res.status}: ${t}`);
    }
    const json = await res.json();
    return json.text || '';
  }

  // Tesseract fallback (fully client-side)
  const T = await ensureTesseract();
  const { data:{ text } } = await T.recognize(blob, OCR_CONFIG.lang, { tessedit_pageseg_mode: 6 });
  return text || '';
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
  return `${number} ${name} ${type}`.replace(/\s+/g,' ').trim();
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
async function fillSequentialFrom(input, addresses){
  if (!addresses.length) return;

  // Put the first address into the current input
  input.value = addresses[0];
  input.dataset.lat = ''; input.dataset.lng = ''; input.dataset.dirty = '1';

  // For the rest, ask your existing helpers to advance/create rows
  for (let i=1;i<addresses.length;i++){
    if (window.flatMode) {
      window.focusNextInFlatOrCreate(input, false);
    } else {
      window.focusNextInFrameOrCreate(input, false);
    }
    const next = document.activeElement && document.activeElement.classList?.contains('stop')
      ? document.activeElement
      : (window.flatMode
          ? (document.querySelector('#addrList .row:last-child .stop'))
          : (input.closest('.row')?.nextElementSibling?.querySelector('.stop') || input));
    if (!next) break;
    next.value = addresses[i];
    next.dataset.lat = ''; next.dataset.lng = ''; next.dataset.dirty = '1';
    input = next;
  }

  // Trigger your normal pipeline
  if (window.renumber) window.renumber();
  if (window.scheduleAutoCompute) { window.autoResolveNext = true; window.scheduleAutoCompute(0,true); }
}

// Handle image->OCR when pasting into any address bar (input.stop)
document.addEventListener('paste', async (ev)=>{
  const target = ev.target;
  if (!target || !target.classList || !target.classList.contains('stop')) return;

  const dt = ev.clipboardData;
  if (!dt) return;

  // Try both paths: items[] (most browsers) and files[] (some Windows clipboard sources)
  let blob = null;

  if (dt.items && dt.items.length){
    for (const it of dt.items){
      if (it.kind === 'file' && it.type && it.type.startsWith('image/')){
        blob = it.getAsFile();
        break;
      }
    }
  }
  // Fallback: some pastes only populate files[]
  if (!blob && dt.files && dt.files.length){
    const f = dt.files[0];
    if (f.type && f.type.startsWith('image/')) blob = f;
  }

  // If no image present, let your normal text paste handler run (multiPaste)
  if (!blob) return;

  // We’re handling the image → stop the default and do OCR
  ev.preventDefault();

  try{
    const text = await ocrFromClipboardImage(blob);
    const addresses = extractAddressesInOrder(text);

    // Very light fallback if parser found nothing but OCR returned text
    if (!addresses.length && text){
      const quick = text.split(/[\r\n,]+/).map(s=>s.trim()).filter(Boolean);
      for (const q of quick){
        const v = normalizeAddressLine(q);
        if (v) addresses.push(v);
      }
    }

    await fillSequentialFrom(target, addresses);
  }catch(err){
    console.error('OCR paste failed:', err);
    // Optional UI: alert('Could not read the screenshot. Try again or type the address.');
  }
}, true); // capture so this runs before the input's text paste handler
</script>
