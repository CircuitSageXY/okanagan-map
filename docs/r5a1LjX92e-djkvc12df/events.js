/* docs/events.js ----------------------------------------------------------
   LIVE-LAYER ADD-ON  v2024-07-31-b
   ------------------------------------------------------------------------ */
(() => {
  /* ───── CONFIG ───── */
  const FEEDS = {
    wildfirePerimeters: {
      /* BCWS current perimeters – ArcGIS FeatureServer layer 0 */
      url: (() => {
        const base =
          'https://services1.arcgis.com/0p6zH2HnUoEH12XH/ArcGIS/rest/services/' +
          'Current_fire_perimeters/FeatureServer/0/query';
        const p = new URLSearchParams({
          f: 'geojson',
          where: '1=1',                          // ← REQUIRED
          geometry: '-119.8,49.6,-119.15,50.2',
          geometryType: 'esriGeometryEnvelope',
          inSR: 4326,
          spatialRel: 'esriSpatialRelIntersects',
          outFields: '*',
          outSR: 4326,
        });
        return `${base}?${p.toString()}`;
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
      /* DriveBC Open511 – use bounding_box (not bbox) */
      url: (() => {
        const base = 'https://api.open511.gov.bc.ca/events';
        const p = new URLSearchParams({
          format: 'geojson',
          bounding_box: '-119.8,49.6,-119.15,50.2', // ← correct param name
          event_type: 'INCIDENT,CONSTRUCTION',
        });
        return `${base}?${p.toString()}`;
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

  /* ───── INTERNALS ───── */
  const liveFeatures = [];
  let button;

  /* add proxy only when host differs */
  const cors = (u) =>
    u.startsWith(location.origin) ? u : `https://corsproxy.io/?${encodeURIComponent(u)}`;

  async function addFeed(key) {
    const feed = FEEDS[key];
    const url = `${cors(feed.url)}&nocache=${Date.now()}`;

    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      const gj = await res.json();

      gj.features?.forEach((ft) => {
        ft.properties ??= {};
        ft.properties.__live = true;
        ft.properties.__kind = feed.kind;
        ft.properties.__feed = key;
      });

      const feats = map.data.addGeoJson(gj);
      feats.forEach((f) => {
        f.setProperty('__live', true);
        f.setProperty('__kind', feed.kind);
        f.setProperty('__feed', key);
        if (feed.kind === 'polygon') f.setProperty('__style', feed.style);
        if (feed.kind === 'point') f.setProperty('__icon', feed.icon);
        liveFeatures.push(f);
      });
    } catch (e) {
      console.warn(`[live-layer] ${key} failed:`, e);
    }
  }

  function clearLive() {
    liveFeatures.forEach((f) => map.data.remove(f));
    liveFeatures.length = 0;
  }

  const liveStyle = (orig) => (feat) => {
    if (feat.getProperty('__live')) {
      return feat.getProperty('__kind') === 'polygon'
        ? feat.getProperty('__style')
        : { icon: feat.getProperty('__icon') };
    }
    return orig(feat);
  };

  async function reloadLive() {
    if (button) {
      button.disabled = true;
      button.textContent = '⟳ …';
    }
    clearLive();
    for (const k of Object.keys(FEEDS)) await addFeed(k);
    map.data.setStyle(liveStyle(styleFeature));
    if (button) {
      button.disabled = false;
      button.textContent = '⟳ Live';
    }
  }

  function makeButton() {
    if (document.getElementById('refreshLiveBtn')) return;
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

  function initAddon(tryN = 0) {
    if (!window.map || !window.styleFeature) {
      if (tryN < 50) setTimeout(() => initAddon(tryN + 1), 100);
      return;
    }
    console.log('%c[live-layer] addon loaded v2024-07-31-b', 'color:#03A9F4;font-weight:bold');
    map.data.setStyle(liveStyle(styleFeature));
    makeButton();
  }

  initAddon();
})();
