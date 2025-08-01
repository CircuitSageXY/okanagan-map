/* docs/events.js ---------------------------------------------------------- */
/*  LIVE-LAYER ADD-ON for Okanagan Route Planner (GitHub Pages)              */
/*  Feeds: BC Wildfire Service + DriveBC Open511                             */
/* ------------------------------------------------------------------------ */
(() => {
  /* ───────── 1.  SETTINGS (tweak if you like) ───────── */

  /* Your own Cloudflare-Worker (recommended, zero CORS issues).            *
   * Leave blank ('') until you deploy one – everything will still work     *
   * through the fall-back helpers.                                         *
   * Format:  'https://my-worker.subdomain.workers.dev/?u='                 */
  const MY_PROXY = '';          // ← add later, or keep '' for auto-fallback

  /* Public CORS helpers (rate-limited but fine for casual use). */
  const FALLBACK_PROXIES = [
    'https://cors.isomorphic-git.org/',                // no query param
    'https://r.jina.ai/http://',                       // prepends http(s)://
  ];

  /* Central-Okanagan bounding-box for DriveBC (long1,lat1,long2,lat2) */
  const OK_BBOX = '-119.8,49.6,-119.15,50.2';

  /* ───────── 2.  FEED CATALOG ───────── */
  const FEEDS = {
    wildfire: {
      src:
        'https://opendata.arcgis.com/datasets/cdfc2d7bc0464bf090ac4897232619e1_0.geojson',
      kind: 'polygon',
      style: {
        fillColor: '#E64A19',
        fillOpacity: 0.25,
        strokeColor: '#BF360C',
        strokeWeight: 1.2,
      },
    },
    drivebc: {
      src:
        `https://api.open511.gov.bc.ca/events?format=geojson&bbox=${OK_BBOX}` +
        '&event_type=INCIDENT,CONSTRUCTION',
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

  /* ───────── 3.  INTERNALS (no edits needed) ───────── */

  const liveFeatures = [];  // keep handles so we can clear later
  let   liveBtn;           // the “⟳ Live” button element

  /* Utility – build a list of candidate URLs to try                           *
   * order: (a) no proxy, (b) MY_PROXY, (c) fall-back helpers.                 */
  function candidateURLs(raw) {
    const list = [raw];
    if (MY_PROXY) list.push(MY_PROXY + encodeURIComponent(raw));
    FALLBACK_PROXIES.forEach((p) =>
      list.push(
        p.endsWith('?u=') || p.endsWith('?u=')
          ? p + encodeURIComponent(raw)
          : p + raw.replace(/^https?:\/\//, '')
      )
    );
    return list;
  }

  /* Fetch that walks through the candidate list until one succeeds. */
  async function fetchWithFallback(rawUrl) {
    const tries = candidateURLs(rawUrl);
    for (const u of tries) {
      try {
        const res = await fetch(u, { cache: 'no-store' });
        if (res.ok) {
          console.info('[live-layer] ✓', rawUrl, 'via', u);
          return res.json();
        }
        console.warn('[live-layer] ×', rawUrl, res.status, res.statusText);
      } catch (e) {
        console.warn('[live-layer] ×', rawUrl, e.message);
      }
    }
    throw new Error('all fetch attempts failed for ' + rawUrl);
  }

  /* Remove previous live features from the map. */
  function clearLive() {
    liveFeatures.forEach((f) => map.data.remove(f));
    liveFeatures.length = 0;
  }

  /* Add one feed, tag its features, remember handles. */
  async function addFeed(name, def) {
    const gj = await fetchWithFallback(def.src);

    (gj.features || []).forEach((f) => {
      f.properties.__live = name;
      f.properties.__kind = def.kind;
    });

    const feats = map.data.addGeoJson(gj);
    feats.forEach((f) => {
      f.setProperty('__live', name);
      f.setProperty('__kind', def.kind);
      if (def.kind === 'polygon') f.setProperty('__style', def.style);
      if (def.kind === 'point')   f.setProperty('__icon',  def.icon);
      liveFeatures.push(f);
    });
  }

  /* Merge with the host page’s styleFeature(). */
  function wrapStyle(orig) {
    return function (feat) {
      const live = feat.getProperty('__live');
      if (live) {
        return feat.getProperty('__kind') === 'polygon'
          ? feat.getProperty('__style')
          : { icon: feat.getProperty('__icon') };
      }
      return orig(feat);
    };
  }

  /* Refresh handler. */
  async function reloadLive() {
    if (liveBtn) {
      liveBtn.disabled = true;
      liveBtn.textContent = '⟳…';
    }

    clearLive();
    try {
      for (const [name, def] of Object.entries(FEEDS)) await addFeed(name, def);
    } catch (e) {
      console.error('[live-layer] giving up –', e.message);
    }

    map.data.setStyle(wrapStyle(styleFeature));

    if (liveBtn) {
      liveBtn.disabled = false;
      liveBtn.textContent = '⟳ Live';
    }
  }

  /* UI injection. */
  function makeButton() {
    liveBtn = document.createElement('button');
    liveBtn.id = 'refreshLiveBtn';
    liveBtn.textContent = '⟳ Live';
    liveBtn.title = 'Load / refresh wildfire & DriveBC layers';
    liveBtn.style.cssText = `
      position:absolute; top:10px; right:58px; z-index:9;
      padding:6px 12px; border:1px solid #c7c7c7;
      background:#fff; border-radius:10px; cursor:pointer;
      font-weight:600; box-shadow:0 2px 8px rgba(0,0,0,.15);
    `;
    liveBtn.onclick = reloadLive;
    document.body.appendChild(liveBtn);
  }

  /* Wait until the main script has created `map` & `styleFeature`. */
  (function init() {
    if (!window.map || !window.styleFeature) {
      setTimeout(init, 80);
      return;
    }
    makeButton();
    // reloadLive();   // ← uncomment to auto-load once on page open
  })();
})();
