/* docs/events.js ----------------------------------------------------------
   LIVE LAYERS for Okanagan Route Planner
   - Google Traffic layer (incidents + congestion)  ← no external fetches
   - Optional wildfires (BCWS) + DriveBC events via YOUR proxy
   ------------------------------------------------------------------------ */
(() => {
  const VERSION = '2024-08-02';

  /* **********  SET THIS TO YOUR CLOUDFLARE WORKER BASE URL  ********** */
  // Example once deployed: 'https://okanagan-live-proxy.yourname.workers.dev'
const WORKER_BASE = 'https://okanagan-live-proxy.<your-account>.workers.dev';
  /* ******************************************************************* */

  // Central Okanagan bbox
  const BBOX = { w:-119.8, s:49.6, e:-119.15, n:50.2 };

  // Optional feeds (only used if WORKER_BASE is set)
  const FEEDS = {
    wildfirePerimeters: {
      // ArcGIS FeatureServer filtered by bbox; Worker adds CORS and returns GeoJSON
      direct: `https://services1.arcgis.com/6p2tH2h9U98dYnj4/arcgis/rest/services/Current_Wildfire_Perimeters_Public/FeatureServer/0/query` +
        `?where=1%3D1&geometry=${BBOX.w}%2C${BBOX.s}%2C${BBOX.e}%2C${BBOX.n}` +
        `&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects` +
        `&outFields=*&returnGeometry=true&outSR=4326&f=geojson`,
      kind: 'polygon',
      style: { fillColor:'#E64A19', fillOpacity:0.26, strokeColor:'#BF360C', strokeWeight:1.2 }
    },
    drivebc: {
      direct: `https://api.open511.gov.bc.ca/events?format=geojson` +
              `&bbox=${BBOX.w},${BBOX.s},${BBOX.e},${BBOX.n}` +
              `&event_type=INCIDENT,CONSTRUCTION`,
      kind: 'mixed',
      pointIcon: {
        path:'M0,-10 L10,0 L0,10 L-10,0 Z',
        fillColor:'#F50057', fillOpacity:1,
        strokeColor:'#ffffff', strokeWeight:1.5, scale:1
      },
      lineStyle: { strokeColor:'#F50057', strokeWeight:3, strokeOpacity:0.9 }
    }
  };

  /* ============== SAFE BOOT ============== */
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  async function waitForMap(ms=15000){
    const t0=Date.now();
    while(Date.now()-t0<ms){
      if(window.map && window.map.data && typeof window.styleFeature==='function') return true;
      await sleep(100);
    }
    console.warn('[live] map/style not ready; addon idle.');
    return false;
  }
  const mapOrNull = () => (window.map && window.map.data) ? window.map : null;

  /* ============== UI (button + menu) ============== */
  let btn, menu, trafficLayer=null, trafficOn=false;
  let extWildfireOn = false, extDriveBCOn = false;

  function makeButton(){
    if(document.getElementById('refreshLiveBtn')){
      btn = document.getElementById('refreshLiveBtn');
      btn.onclick = toggleMenu;
      return;
    }
    btn = document.createElement('button');
    btn.id = 'refreshLiveBtn';
    btn.type='button';
    btn.textContent='⟳ Live';
    btn.title='Live traffic + optional feeds';
    btn.style.cssText = `
      position:absolute; top:10px; right:58px; z-index:1000;
      padding:6px 12px; font-weight:600; border:1px solid #c7c7c7;
      background:#fff; border-radius:10px; cursor:pointer;
      box-shadow:0 2px 8px rgba(0,0,0,.15);
    `;
    btn.addEventListener('click', toggleMenu);
    document.body.appendChild(btn);

    // drop-down menu
    menu = document.createElement('div');
    menu.id = 'liveMenu';
    menu.style.cssText = `
      position:absolute; top:44px; right:58px; z-index:1000;
      width:260px; background:#fff; border:1px solid #dadada; border-radius:10px;
      box-shadow:0 8px 20px rgba(0,0,0,.18); padding:8px; display:none;
      font: 14px/1.4 Roboto, Arial, sans-serif;
    `;
    menu.innerHTML = `
      <div style="font-weight:700;margin:4px 6px 8px 6px;">Live Layers</div>
      <label style="display:flex;align-items:center;gap:8px;padding:4px 6px;">
        <input id="ckTraffic" type="checkbox"> Traffic (Google)
      </label>
      <label style="display:flex;align-items:center;gap:8px;padding:4px 6px;">
        <input id="ckWildfires" type="checkbox"> Wildfires (BCWS)
        <span style="margin-left:auto;font-size:12px;color:#666" id="wfHint"></span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;padding:4px 6px;">
        <input id="ckDriveBC" type="checkbox"> DriveBC (incidents & construction)
        <span style="margin-left:auto;font-size:12px;color:#666" id="dbcHint"></span>
      </label>
      <div style="display:flex;gap:6px;justify-content:flex-end;padding:6px 6px 2px 6px;">
        <button id="btnReload" type="button" style="padding:4px 10px;">Refresh</button>
        <button id="btnClose"  type="button" style="padding:4px 10px;">Close</button>
      </div>
    `;
    document.body.appendChild(menu);

    // Wire up controls
    const ckTraffic = menu.querySelector('#ckTraffic');
    const ckWild   = menu.querySelector('#ckWildfires');
    const ckDrive  = menu.querySelector('#ckDriveBC');
    const wfHint   = menu.querySelector('#wfHint');
    const dbcHint  = menu.querySelector('#dbcHint');

    // Disable external if no proxy configured
    if(!WORKER_BASE){
      ckWild.disabled = true; ckDrive.disabled = true;
      wfHint.textContent = 'proxy off'; dbcHint.textContent = 'proxy off';
    }

    ckTraffic.addEventListener('change', () => setTraffic(ckTraffic.checked));
    ckWild  .addEventListener('change', () => { extWildfireOn = ckWild.checked; reloadExternal(); });
    ckDrive .addEventListener('change', () => { extDriveBCOn  = ckDrive.checked;  reloadExternal(); });
    menu.querySelector('#btnReload').addEventListener('click', reloadExternal);
    menu.querySelector('#btnClose').addEventListener('click', toggleMenu);

    // restore previous state
    try{
      trafficOn = localStorage.getItem('live_trafficOn')==='1';
      extWildfireOn = localStorage.getItem('live_wfOn')==='1';
      extDriveBCOn  = localStorage.getItem('live_dbcOn')==='1';
    }catch(_){}
    ckTraffic.checked = trafficOn;
    ckWild.checked    = extWildfireOn && !!WORKER_BASE;
    ckDrive.checked   = extDriveBCOn  && !!WORKER_BASE;

    // apply immediately
    setTraffic(trafficOn);
    if(WORKER_BASE) reloadExternal();
  }

  function toggleMenu(){
    menu.style.display = (menu.style.display==='none' || !menu.style.display) ? 'block' : 'none';
  }

  /* ============== Google Traffic ============== */
  function setTraffic(on){
    const m = mapOrNull();
    if(!m) return;
    if(on){
      if(!trafficLayer) trafficLayer = new google.maps.TrafficLayer();
      trafficLayer.setMap(m);
    }else{
      trafficLayer?.setMap(null);
    }
    trafficOn = !!on;
    try{
      localStorage.setItem('live_trafficOn', trafficOn ? '1':'0');
    }catch(_){}
  }

  /* ============== External feeds via Worker (safe, optional) ============== */
  const liveFeatures = [];
  function clearLive(){
    const m = mapOrNull(); if(!m) return;
    liveFeatures.forEach(f => m.data.remove(f));
    liveFeatures.length = 0;
  }

  function wrapStyle(orig){
    return function(feature){
      if(feature.getProperty('__live')){
        let t = '';
        try{ t = feature.getGeometry()?.getType?.() || ''; }catch(_){}
        if(t.includes('Polygon')){
          return feature.getProperty('__polyStyle') || { fillColor:'#E64A19', fillOpacity:.26, strokeColor:'#BF360C', strokeWeight:1.2 };
        }
        if(t.includes('LineString')){
          return feature.getProperty('__lineStyle') || { strokeColor:'#F50057', strokeWeight:3, strokeOpacity:.9 };
        }
        if(t==='Point'){
          return { icon: feature.getProperty('__pointIcon') || {
            path:'M0,-10 L10,0 L0,10 L-10,0 Z',
            fillColor:'#F50057', fillOpacity:1, strokeColor:'#fff', strokeWeight:1.5, scale:1
          }};
        }
      }
      return orig(feature);
    };
  }

  async function fetchViaWorker(url){
    if(!WORKER_BASE) throw new Error('proxy not configured');
    const prox = `${WORKER_BASE}/proxy?u=${encodeURIComponent(url)}`;
    const res  = await fetch(prox, { cache:'no-store' });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    try{ return JSON.parse(text); }
    catch{ throw new Error('not JSON'); }
  }

  async function addFeed(key){
    const feed = FEEDS[key];
    const gj = await fetchViaWorker(feed.direct);
    gj.features?.forEach(ft=>{
      ft.properties = ft.properties || {};
      ft.properties.__live = true;
      ft.properties.__feed = key;
      if(feed.style)     ft.properties.__polyStyle  = feed.style;
      if(feed.pointIcon) ft.properties.__pointIcon = feed.pointIcon;
      if(feed.lineStyle) ft.properties.__lineStyle = feed.lineStyle;
    });
    const m = mapOrNull(); if(!m) return;
    const feats = m.data.addGeoJson(gj);
    feats.forEach(f=>{ f.setProperty('__live',true); liveFeatures.push(f); });
  }

  async function reloadExternal(){
    if(!WORKER_BASE){
      console.info('[live] proxy not configured; external feeds disabled.');
      return;
    }
    const m = mapOrNull(); if(!m) return;
    m.data.setStyle(wrapStyle(window.styleFeature));

    clearLive();
    // Persist user choices
    try{
      localStorage.setItem('live_wfOn',  extWildfireOn ? '1':'0');
      localStorage.setItem('live_dbcOn', extDriveBCOn  ? '1':'0');
    }catch(_){}

    // Load selectively
    try{
      if(extWildfireOn) await addFeed('wildfirePerimeters');
    }catch(e){ console.warn('[live] wildfirePerimeters:', e.message); }
    try{
      if(extDriveBCOn)  await addFeed('drivebc');
    }catch(e){ console.warn('[live] driveBC:', e.message); }
  }

  /* ============== init ============== */
  (async function init(){
    console.log('[live] addon v'+VERSION);
    const ok = await waitForMap();
    if(!ok) return;
    makeButton();
  })();
})();
