/* docs/events.js ---------------------------------------------------------- */
/*  LIVE-LAYER ADD-ON for Okanagan Route Planner (GitHub Pages)              */
/*  Feeds: BC Wildfire Service + DriveBC Open511                             */
/* ------------------------------------------------------------------------ */
(() => {

  /* ───────── FEED CATALOG ─────────
     Add or remove feeds here. Each entry must return GeoJSON.
  */
  const FEEDS = {
    /* 1. BC Wildfire – current fire-perimeter polygons
       The ArcGIS Feature-Server speaks CORS already, so no proxy is needed.       */
    wildfires: {
      url:
        'https://services1.arcgis.com/0p6zH2HnUoEH12XH/ArcGIS/rest/services/' +
        'Current_fire_perimeters/FeatureServer/0/query?' +
        // limit to Central-Okanagan envelope (≈ same bbox as the map)
        'geometry=-119.8,49.6,-119.15,50.2' +
        '&geometryType=esriGeometryEnvelope' +
        '&outFields=*' +
        '&outSR=4326' +
        '&f=geojson',
      kind: 'polygon',
      style: {
        fillColor:   '#E64A19',
        fillOpacity: 0.25,
        strokeColor:'#BF360C',
        strokeWeight: 1.4
      }
    },

    /* 2. DriveBC – incidents / construction points & tiny polylines          */
    drivebc: {
      // NB: the Open511 API lacks permissive CORS; we’ll fetch through a proxy.
      url:
        'https://api.open511.gov.bc.ca/events?format=geojson'  +
        '&bbox=-119.8,49.6,-119.15,50.2' +
        '&event_type=INCIDENT,CONSTRUCTION',
      kind: 'point',
      icon: {
        path: 'M0,-10 L10,0 L0,10 L-10,0 Z',  // simple diamond
        fillColor:   '#F50057',
        fillOpacity: 1,
        strokeColor: '#FFFFFF',
        strokeWeight: 1.5,
        scale: 1
      }
    }
  };

  /* ───────── BASIC CORS HELPERS ───────── */
  const PROXIES = [
    u => u,                                                             // try direct first
    u => 'https://cors.isomorphic-git.org/' + u,
    u => 'https://thingproxy.freeboard.io/fetch/' + u,
    u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u)
  ];

  async function fetchGeoJSON(url) {
    for (const wrap of PROXIES) {
      const proxied = wrap(url);
      try {
        const res  = await fetch(proxied, { cache:'no-store' });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();          // will throw on invalid JSON
        if (data && data.type === 'FeatureCollection') return data;
      } catch (e) {
        /* silently try next proxy */
      }
    }
    throw new Error('All proxy attempts failed for\n' + url);
  }

  /* ───────── INTERNALS (no edits below) ───────── */
  const liveFeatures = [];
  let   button;

  function clearLive() {
    liveFeatures.forEach(f => map.data.remove(f));
    liveFeatures.length = 0;
  }

  /* Add one feed, push ref(s) into liveFeatures so we can clear them later */
  async function addFeed(feed) {
    const gj = await fetchGeoJSON(feed.url);

    // tag + style per feature, then add to map
    gj.features.forEach(ft => {
      ft.properties.__live = true;
      ft.properties.__kind = feed.kind;
    });

    const feats = map.data.addGeoJson(gj);
    feats.forEach(f => {
      f.setProperty('__live', true);
      f.setProperty('__kind', feed.kind);
      if (feed.kind === 'polygon') f.setProperty('__style', feed.style);
      if (feed.kind === 'point')   f.setProperty('__icon',  feed.icon);
      liveFeatures.push(f);
    });
  }

  /* Style wrapper – falls through to the app’s original styleFeature() */
  function liveStyleWrapper(orig) {
    return function(feature) {
      if (feature.getProperty('__live')) {
        if (feature.getProperty('__kind') === 'polygon')
          return feature.getProperty('__style');
        if (feature.getProperty('__kind') === 'point')
          return { icon: feature.getProperty('__icon') };
      }
      return orig(feature);
    };
  }

  /* Main refresh routine */
  async function reloadLive() {
    if (!window.map || !window.styleFeature) return;  // not ready yet

    button.disabled = true;
    button.textContent = '⟳…';

    clearLive();

    let loadedAnything = false;
    for (const key of Object.keys(FEEDS)) {
      try {
        await addFeed(FEEDS[key]);
        loadedAnything = true;
      } catch (err) {
        console.warn('[live-layer]', key, err.message);
      }
    }

    // re-apply style pipeline
    map.data.setStyle(liveStyleWrapper(styleFeature));

    if (!loadedAnything) {
      alert('Live-layer: nothing could be loaded (network / CORS problem).');
    }

    button.disabled = false;
    button.textContent = '⟳ Live';
  }

  /* Create the floating button */
  function makeButton() {
    button = document.createElement('button');
    button.id = 'refreshLiveBtn';
    button.type = 'button';
    button.textContent = '⟳ Live';
    button.title = 'Load / refresh live wildfire & DriveBC events';
    button.style.cssText = `
      position:absolute; top:10px; right:58px; z-index:9;
      padding:6px 12px; font-weight:600; border:1px solid #c7c7c7;
      background:#fff; border-radius:10px; cursor:pointer;
      box-shadow:0 2px 8px rgba(0,0,0,.15);
    `;
    button.addEventListener('click', reloadLive);
    document.body.appendChild(button);
  }

  /* Boot: wait until the main app has created `map` & `styleFeature` */
  (function init() {
    if (window.map && window.styleFeature) {
      makeButton();
      // auto-refresh once on first load (optional – uncomment if desired)
      // reloadLive();
    } else {
      setTimeout(init, 80);
    }
  })();

})();
