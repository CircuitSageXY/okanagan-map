/* docs/events.js ----------------------------------------------------------
   LIVE-LAYER ADD-ON  v2024-07-31-c (robust fetch / multi-endpoint fallback)
   Feeds: BC Wildfire perimeters + DriveBC Open511
---------------------------------------------------------------------------*/
(() => {
  /* =============== GEOGRAPHY (Central Okanagan) =============== */
  const BBOX = { west:-119.8, south:49.6, east:-119.15, north:50.2 };
  const bboxCsv = `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`;

  /* =============== CORS helper =============== */
  const needsProxy = (url) => {
    try {
      const u = new URL(url, location.href);
      return u.origin !== location.origin;
    } catch { return true; }
  };
  const withCors = (url) =>
    needsProxy(url) ? `https://corsproxy.io/?${encodeURIComponent(url)}` : url;

  /* =============== Feed URL builders (multiple candidates) =============== */
  function wildfireUrls() {
    // 1) ArcGIS FeatureServer query (envelope + where)
    const fsBase =
      'https://services1.arcgis.com/0p6zH2HnUoEH12XH/ArcGIS/rest/services/Current_fire_perimeters/FeatureServer/0/query';
    const fsParams = new URLSearchParams({
      f: 'geojson',
      where: '1=1',
      geometry: bboxCsv,                 // minX,minY,maxX,maxY (lon/lat)
      geometryType: 'esriGeometryEnvelope',
      spatialRel: 'esriSpatialRelIntersects',
      inSR: '4326',
      outSR: '4326',
      outFields: '*',
      returnGeometry: 'true'
    });
    const urls = [`${fsBase}?${fsParams}`];

    // 2) Open Data GeoJSON (ArcGIS Hub auto file) – sometimes this works when FS blocks
    // Source dataset id used earlier:
    urls.push('https://opendata.arcgis.com/datasets/cdfc2d7bc0464bf090ac4897232619e1_0.geojson');

    // 3) Same Hub file via "hub.arcgis.com/api" with a basic where; some hubs require this
    const hubQuery =
      'https://hub.arcgis.com/api/datasets/cdfc2d7bc0464bf090ac4897232619e1_0' +
      '/FeatureServer/0/query?where=1%3D1&f=geojson&outFields=*';
    urls.push(hubQuery);

    return urls;
  }

  function driveBcUrls() {
    // Some Open511 deployments accept "bounding_box", some "bbox".
    const base = 'https://api.open511.gov.bc.ca/events';
    const common = { format: 'geojson', event_type: 'INCIDENT,CONSTRUCTION' };
    const p1 = new URLSearchParams({ ...common, bounding_box: bboxCsv }); // variant A
    const p2 = new URLSearchParams({ ...common, bbox: bboxCsv });         // variant B
    const urls = [`${base}?${p1}`, `${base}?${p2}`];

    // Fallback: remove bbox filter (whole province) and filter client-side later.
    const p3 = new URLSearchParams(common);
    urls.push(`${base}?${p3}`);

    return urls;
  }

  /* =============== Styling merger =============== */
  const liveStyleWrapper = (orig) => (feature) => {
    if (feature.getProperty('__live')) {
      if (feature.getProperty('__kind') === 'polygon') return feature.getProperty('__style');
      if (feature.getProperty('__kind') === 'point')   return { icon: feature.getProperty('__icon') };
    }
    return orig(feature);
  };

  /* =============== State =============== */
  const liveFeatures = [];
  let button;

  function clearLive() {
    liveFeatures.forEach(f => map.data.remove(f));
    liveFeatures.length = 0;
  }

  /* =============== Fetch helper with fallbacks =============== */
  async function fetchFirstWorking(name, urls) {
    for (const raw of urls) {
      const u = `${withCors(raw)}&nocache=${Date.now()}`;
      try {
        const res = await fetch(u, { cache: 'no-store' });
        if (!res.ok) {
          console.warn(`[live-layer] ${name}: ${res.status} at`, raw);
          continue;
        }
        const data = await res.json().catch(() => null);
        if (!data || !data.type || !data.features) {
          console.warn(`[live-layer] ${name}: response not GeoJSON at`, raw);
          continue;
        }
        console.log(`[live-layer] ${name}: OK`, raw);
        return data;
      } catch (e) {
        console.warn(`[live-layer] ${name}: fetch error at`, raw, e);
      }
    }
    throw new Error(`${name}: no working endpoint`);
  }

  /* =============== Client-side bbox filter (for fallbacks without bbox) =============== */
  function withinBbox([lon, lat]) {
    return lon >= BBOX.west && lon <= BBOX.east && lat >= BBOX.south && lat <= BBOX.north;
  }
  function filterGeoJsonToBbox(gj) {
    if (!gj?.features) return gj;
    const out = { ...gj, features: [] };
    for (const f of gj.features) {
      try {
        const g = f.geometry;
        let hit = false;
        if (g?.type === 'Point') {
          hit = withinBbox(g.coordinates);
        } else if (g?.type === 'MultiPoint') {
          hit = g.coordinates.some(withinBbox);
        } else if (g?.type === 'LineString') {
          hit = g.coordinates.some(withinBbox);
        } else if (g?.type === 'MultiLineString') {
          hit = g.coordinates.flat().some(withinBbox);
        } else if (g?.type === 'Polygon') {
          hit = g.coordinates.flat().some(withinBbox);
        } else if (g?.type === 'MultiPolygon') {
          hit = g.coordinates.flat(2).some(withinBbox);
        }
        if (hit) out.features.push(f);
      } catch { /* ignore bad feature */ }
    }
    return out;
  }

  /* =============== Add one feed to map =============== */
  async function addFeed(def) {
    const { name, kind, style, icon, urls } = def;

    const gj = await fetchFirstWorking(name, urls());
    const gjTrimmed =
      name === 'driveBC' && !/bbox|bounding_box/.test(urls().join(','))
        ? filterGeoJsonToBbox(gj)
        : gj;

    // Tag features for style routing
    gjTrimmed.features.forEach(ft => {
      ft.properties ??= {};
      ft.properties.__live = true;
      ft.properties.__kind = kind;
      ft.properties.__feed = name;
    });

    const feats = map.data.addGeoJson(gjTrimmed);
    feats.forEach(f => {
      f.setProperty('__live', true);
      f.setProperty('__kind', kind);
      f.setProperty('__feed', name);
      if (kind === 'polygon') f.setProperty('__style', style);
      if (kind === 'point')   f.setProperty('__icon',  icon);
      liveFeatures.push(f);
    });
  }

  /* =============== Public reload =============== */
  async function reloadLive() {
    if (button) { button.disabled = true; button.textContent = '⟳ …'; }
    clearLive();

    const feeds = [
      {
        name: 'wildfirePerimeters',
        kind: 'polygon',
        urls: wildfireUrls,
        style: {
          fillColor: '#E64A19',
          fillOpacity: 0.25,
          strokeColor: '#BF360C',
          strokeWeight: 1.2
        }
      },
      {
        name: 'driveBC',
        kind: 'point',
        urls: driveBcUrls,
        icon: {
          path: 'M0,-10 L10,0 L0,10 L-10,0 Z',
          fillColor: '#F50057',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 1.5,
          scale: 1
        }
      }
    ];

    // Try feeds one-by-one but keep going even if one fails
    for (const f of feeds) {
      try { await addFeed(f); }
      catch (e) { console.warn(`[live-layer] ${f.name} failed:`, e.message); }
    }

    // Ensure style wrapper is active
    map.data.setStyle(liveStyleWrapper(styleFeature));

    if (button) { button.disabled = false; button.textContent = '⟳ Live'; }
  }

  /* =============== UI button =============== */
  function makeButton() {
    if (document.getElementById('refreshLiveBtn')) return;
    button = document.createElement('button');
    button.id = 'refreshLiveBtn';
    button.title = 'Load / refresh wildfire & DriveBC events';
    button.textContent = '⟳ Live';
    button.style.cssText = `
      position:absolute; top:10px; right:58px; z-index:9;
      padding:6px 12px; font-weight:600; border:1px solid #c7c7c7;
      background:#fff; border-radius:10px; cursor:pointer;
      box-shadow:0 2px 8px rgba(0,0,0,.15);
    `;
    button.addEventListener('click', reloadLive);
    document.body.appendChild(button);
  }

  /* =============== Boot (wait for map/styleFeature) =============== */
  (function initAddon(tryN = 0) {
    if (!window.map || !window.styleFeature) {
      if (tryN < 60) return void setTimeout(() => initAddon(tryN + 1), 100);
      console.warn('[live-layer] map/styleFeature not available – giving up');
      return;
    }
    console.log('%c[live-layer] addon loaded v2024-07-31-c', 'color:#03A9F4;font-weight:bold');
    map.data.setStyle(liveStyleWrapper(styleFeature));
    makeButton();
  })();
})();
