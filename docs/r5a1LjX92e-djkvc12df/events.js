/* docs/events.js ----------------------------------------------------------
   LIVE-LAYER ADD-ON  v2024-07-31
   Shows:
      • BC Wildfire-Service “current fire PERIMETERS”
      • DriveBC Open511 road incidents / construction within Central Okanagan
   ------------------------------------------------------------------------ */

(() => {
  /*──────────────────────────────────────────────────────────────────────────
    CONFIG – add/edit feeds in one place
  ──────────────────────────────────────────────────────────────────────────*/
  const FEEDS = {
    wildfirePerimeters: {
      /*
        ArcGIS FeatureServer (layer 0) – *always* supports JSON & CORS.
        We crop to your map’s bbox to keep the payload small.
      */
      url: (() => {
        const srv =
          'https://services1.arcgis.com/0p6zH2HnUoEH12XH/ArcGIS/rest/services/' +
          'Current_fire_perimeters/FeatureServer/0/query';
        const params = new URLSearchParams({
          f: 'geojson',
          outFields: '*',
          outSR: 4326,
          geometry: '-119.8,49.6,-119.15,50.2', // xmin,ymin,xmax,ymax
          geometryType: 'esriGeometryEnvelope',
        });
        return `${srv}?${params.toString()}`;
      })(),
      kind: 'polygon',
      style: {
        fillColor: '#E64A19',
        fillOpacity: 0.25,
        strokeColor: '#BF360C',
        strokeWeight: 1.2,
      },
    },

    driveBC: {
      /* DriveBC Open511 – CORS OK; returns point + short-polyline GeoJSON */
      url: (() => {
        const api = 'https://api.open511.gov.bc.ca/events';
        const p = new URLSearchParams({
          format: 'geojson',
          bbox: '-119.8,49.6,-119.15,50.2',
          event_type: 'INCIDENT,CONSTRUCTION',
        });
        return `${api}?${p.toString()}`;
      })(),
      kind: 'point',
      icon: {
        path: 'M0,-10 L10,0 L0,10 L-10,0 Z',
        fillColor: '#F50057',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 1.5,
        scale: 1,
      },
    },
  };

  /*──────────────────────────────────────────────────────────────────────────
    INTERNALS  – no edits below here
  ──────────────────────────────────────────────────────────────────────────*/
  const liveFeatures = [];
  let   button;

  /* util ▸ tiny CORS helper – prepends only when remote host ≠ ours */
  function cors(url) {
    const NEEDS_PROXY = !url.startsWith(location.origin);
    return NEEDS_PROXY ? `https://corsproxy.io/?${encodeURIComponent(url)}` : url;
  }

  /* Load one feed and remember its features */
  async function addFeed(feedKey) {
    const feed = FEEDS[feedKey];
    const fetchURL = `${cors(feed.url)}&nocache=${Date.now()}`;

    try {
      const res = await fetch(fetchURL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const gj = await res.json();

      gj.features?.forEach((ft) => {
        ft.properties ??= {};
        ft.properties.__live = true;
        ft.properties.__kind = feed.kind;
        ft.properties.__feed = feedKey;
      });

      const feats = map.data.addGeoJson(gj);
      feats.forEach((f) => {
        f.setProperty('__live', true);
        f.setProperty('__kind', feed.kind);
        f.setProperty('__feed', feedKey);
        if (feed.kind === 'polygon') f.setProperty('__style', feed.style);
        if (feed.kind === 'point')   f.setProperty('__icon', feed.icon);
        liveFeatures.push(f);
      });
    } catch (err) {
      console.warn(`[live-layer] ${feedKey} failed:`, err);
    }
  }

  /* Remove previous live overlay */
  function clearLive() {
    liveFeatures.forEach((f) => map.data.remove(f));
    liveFeatures.length = 0;
  }

  /* Style wrapper merges with main styleFeature() */
  const liveStyle = (orig) => (feat) => {
    if (feat.getProperty('__live')) {
      return feat.getProperty('__kind') === 'polygon'
        ? feat.getProperty('__style')
        : { icon: feat.getProperty('__icon') };
    }
    return orig(feat);
  };

  /* Main refresh routine */
  async function reloadLive() {
    if (button) {
      button.disabled = true;
      button.textContent = '⟳ …';
    }
    clearLive();

    /* serial keeps rate-limits happy, but you could parallelise */
    for (const k of Object.keys(FEEDS)) await addFeed(k);

    map.data.setStyle(liveStyle(styleFeature));

    if (button) {
      button.disabled = false;
      button.textContent = '⟳ Live';
    }
  }

  /* Make the floating button */
  function makeButton() {
    if (document.getElementById('refreshLiveBtn')) return; // already there

    button = document.createElement('button');
    button.id = 'refreshLiveBtn';
    button.textContent = '⟳ Live';
    button.title = 'Load / refresh wildfire & DriveBC layers';
    button.style.cssText = `
        position:absolute; top:10px; right:58px; z-index:9;
        padding:6px 12px; font-weight:600; border:1px solid #c7c7c7;
        background:#fff; border-radius:10px; cursor:pointer;
        box-shadow:0 2px 8px rgba(0,0,0,.15);
      `;
    button.onclick = reloadLive;
    document.body.appendChild(button);
  }

  /* Boot once the global map is ready */
  function initAddon(attempt = 0) {
    if (!window.map || !window.styleFeature) {
      if (attempt < 50) setTimeout(() => initAddon(attempt + 1), 100);
      return;
    }
    console.log('%c[live-layer] addon loaded v2024-07-31', 'color:#03A9F4;font-weight:bold');
    map.data.setStyle(liveStyle(styleFeature)); // ensure wrapper even without clicks
    makeButton();
    /* optional: auto-load on page entry
       reloadLive();
    */
  }

  initAddon();
})();
