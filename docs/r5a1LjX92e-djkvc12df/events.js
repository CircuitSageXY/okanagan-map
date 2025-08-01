/* docs/events.js ---------------------------------------------------------- */
/*  LIVE-LAYER ADD-ON for Okanagan Route Planner (GitHub Pages)              */
/*  Feeds: BC Wildfire Service + DriveBC Open511                             */
/* ------------------------------------------------------------------------ */
(() => {
  /* ──────── CONFIG ──────── */

  /* 1.  Where should we pipe the upstream requests?
         – If you already deployed a Worker, put its HTTPS origin here.
         – If you’re only testing, use the public helper below
           (it *will* rate-limit, so don’t rely on it in prod).               */
  const MY_PROXY = 'https://okanagan-live.<yourname>.workers.dev/?u='; // ← CHANGE ME
  // const MY_PROXY = 'https://cors.isomorphic-git.org/';              // quick test

  /* 2.  Bounding-box for DriveBC (long1,lat1,long2,lat2). */
  const OK_BBOX = '-119.8,49.6,-119.15,50.2';

  /* 3.  GeoJSON feeds to load – extend/replace as you like.  */
  const FEEDS = {
    /** Fire perimeters – BC Wildfire “current season” */
    wildfires: {
      url:
        MY_PROXY +
        encodeURIComponent(
          'https://opendata.arcgis.com/datasets/cdfc2d7bc0464bf090ac4897232619e1_0.geojson'
        ),
      kind: 'polygon',
      style: {
        fillColor: '#E64A19',
        fillOpacity: 0.25,
        strokeColor: '#BF360C',
        strokeWeight: 1.2,
      },
    },

    /** Road incidents / construction – DriveBC Open 511 */
    drivebc: {
      url:
        MY_PROXY +
        encodeURIComponent(
          `https://api.open511.gov.bc.ca/events?format=geojson&bbox=${OK_BBOX}&event_type=INCIDENT,CONSTRUCTION`
        ),
      kind: 'point',
      icon: {
        /* simple diamond marker */
        path: 'M0,-10 L10,0 L0,10 L-10,0 Z',
        fillColor: '#F50057',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 1.5,
        scale: 1,
      },
    },
  };

  /* ──────── INTERNALS (do not edit) ──────── */

  /** Holds references so we can remove old live features quickly */
  const liveFeatures = [];

  /** “⟳ Live” button element */
  let button;

  /**
   * Remove every feature previously added by the live layer.
   */
  function clearLive() {
    liveFeatures.forEach((f) => map.data.remove(f));
    liveFeatures.length = 0;
  }

  /**
   * Fetch a feed, add it to the data layer, remember the features.
   */
  async function addFeed(def) {
    try {
      const res = await fetch(def.url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const gj = await res.json();

      // annotate each GeoJSON feature so the style wrapper can recognise it
      gj.features.forEach((ft) => {
        ft.properties.__live = true;
        ft.properties.__kind = def.kind;
      });

      const feats = map.data.addGeoJson(gj);
      feats.forEach((f) => {
        f.setProperty('__live', true);
        f.setProperty('__kind', def.kind);
        if (def.kind === 'polygon') f.setProperty('__style', def.style);
        if (def.kind === 'point') f.setProperty('__icon', def.icon);
        liveFeatures.push(f);
      });
    } catch (err) {
      console.warn('Live-layer fetch failed:', err);
    }
  }

  /**
   * Style handler that defers to the original styleFeature()
   * but intercepts items tagged “__live”.
   */
  function liveStyleWrapper(origStyleFn) {
    return function (feature) {
      if (feature.getProperty('__live')) {
        if (feature.getProperty('__kind') === 'polygon') {
          return feature.getProperty('__style');
        }
        if (feature.getProperty('__kind') === 'point') {
          return { icon: feature.getProperty('__icon') };
        }
      }
      return origStyleFn(feature); // default polygons
    };
  }

  /**
   * One-click refresh handler.
   */
  async function reloadLive() {
    if (button) {
      button.disabled = true;
      button.textContent = '⟳…';
    }

    clearLive();
    for (const k of Object.keys(FEEDS)) await addFeed(FEEDS[k]);

    // Re-install the style wrapper so new features paint instantly.
    map.data.setStyle(liveStyleWrapper(styleFeature));

    if (button) {
      button.disabled = false;
      button.textContent = '⟳ Live';
    }
  }

  /**
   * Inject the floating “⟳ Live” button.
   */
  function makeButton() {
    button = document.createElement('button');
    button.id = 'refreshLiveBtn';
    button.textContent = '⟳ Live';
    button.title = 'Load / refresh live wildfire + DriveBC layers';
    button.style.cssText = `
      position:absolute; top:10px; right:58px; z-index:9;
      padding:6px 12px; border:1px solid #c7c7c7;
      background:#fff; border-radius:10px; cursor:pointer;
      font-weight:600; box-shadow:0 2px 8px rgba(0,0,0,.15);
    `;
    button.addEventListener('click', reloadLive);
    document.body.appendChild(button);
  }

  /**
   * Wait until the main page has created `map` and `styleFeature`,
   * then install the add-on.
   */
  function initAddon() {
    if (!window.map || !window.styleFeature) {
      setTimeout(initAddon, 80);
      return;
    }
    makeButton();

    /* OPTIONAL: uncomment to auto-load once when the page opens
       (still refreshable later via the button)                       */
    // reloadLive();
  }

  initAddon();
})();
