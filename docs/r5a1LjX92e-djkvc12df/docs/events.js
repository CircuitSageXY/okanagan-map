/* docs/events.js ---------------------------------------------------------- */
/*  LIVE-LAYER ADD-ON for Okanagan Route Planner (GitHub Pages)              */
/*  Feeds: BC Wildfire Service + DriveBC Open511                             */
/* ------------------------------------------------------------------------ */
(() => {

  /* ───────── FEED CATALOG ─────────
     If you change geography or add feeds, just extend this list.
     Each entry returns GeoJSON and is styled client-side.
  */
  const FEEDS = {
    wildfires: {
      /* Fire perimeters (polygons) – BC Wildfire “current season” layer */
      url: 'https://your-proxy.workers.dev/?u=' +
           encodeURIComponent('https://opendata.arcgis.com/datasets/cdfc2d7bc0464bf090ac4897232619e1_0.geojson'),
      kind: 'polygon',
      style: {
        fillColor: '#E64A19',
        fillOpacity: 0.25,
        strokeColor: '#BF360C',
        strokeWeight: 1.2
      }
    },

    drivebc: {
      /* Road events (points + short polylines) – DriveBC Open511 */
      /* Filters: within Central-Okanagan bounding box, only closures/incidents */
      url: 'https://your-proxy.workers.dev/?u=' +
           encodeURIComponent('https://api.open511.gov.bc.ca/events?format=geojson'
             + '&bbox=-119.8,49.6,-119.15,50.2'
             + '&event_type=INCIDENT,CONSTRUCTION')
             /* add &road_class=primary,secondary if you want fewer items */,
      kind: 'point',
      icon: {
        /* simple diamond marker – tweak as you like */
        path: 'M0,-10 L10,0 L0,10 L-10,0 Z',
        fillColor: '#F50057',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 1.5,
        scale: 1      /* Maps scales vectors in screen px */
      }
    }
  };

  /* ───────── INTERNALS (no edits needed) ───────── */
  const liveFeatures = [];      // holds feature refs so we can clear quickly
  let button;                   // the “⟳ Live” button element

  /**
   * Remove previous live features from the map data layer.
   */
  function clearLive() {
    liveFeatures.forEach(f => map.data.remove(f));
    liveFeatures.length = 0;
  }

  /**
   * Add one feed to the map and remember its features.
   */
  async function addFeed(feed) {
    try {
      const res = await fetch(feed.url, { cache: 'no-store' });
      const gj  = await res.json();

      // Tag every feature so our shared style function can recognise it.
      gj.features.forEach(ft => {
        ft.properties.__live = true;
        ft.properties.__kind = feed.kind;
      });

      const feats = map.data.addGeoJson(gj);
      feats.forEach(f => {
        f.setProperty('__live',  true);
        f.setProperty('__kind',  feed.kind);
        if (feed.kind === 'polygon') f.setProperty('__style', feed.style);
        if (feed.kind === 'point')   f.setProperty('__icon',  feed.icon);
        liveFeatures.push(f);
      });

    } catch (err) { console.warn('Live-layer fetch failed:', err); }
  }

  /**
   * Style handler merged onto your existing styleFeature().
   */
  function liveStyleWrapper(origStyleFn) {
    return function(feature) {
      if (feature.getProperty('__live')) {

        if (feature.getProperty('__kind') === 'polygon')
          return feature.getProperty('__style');

        if (feature.getProperty('__kind') === 'point')
          return { icon: feature.getProperty('__icon') };
      }
      /* fall through to the original polygon styling  */
      return origStyleFn(feature);
    };
  }

  /**
   * One-click refresh: clear, refetch, redraw.
   */
  async function reloadLive() {
    if (button) { button.disabled = true; button.textContent = '⟳...'; }
    clearLive();

    for (const key of Object.keys(FEEDS)) await addFeed(FEEDS[key]);

    // force Maps to restyle live features (the wrapper covers both)
    map.data.setStyle(liveStyleWrapper(styleFeature));

    if (button) { button.disabled = false; button.textContent = '⟳ Live'; }
  }

  /**
   * Create the floating “⟳ Live” button (top-right, under your Areas tab).
   */
  function makeButton() {
    button = document.createElement('button');
    button.id = 'refreshLiveBtn';
    button.title = 'Load / refresh live wildfire & DriveBC events';
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

  /*  Boot - wait until the global 'map' exists (your init creates it).  */
  function initAddon() {
    if (!window.map || !window.styleFeature) {   // wait a tick
      setTimeout(initAddon, 80);
      return;
    }
    makeButton();
    // **optional**: load once automatically on page load
    // reloadLive();
  }

  initAddon();
})();
