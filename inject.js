// Mobbin Unblur PRO — page-context injector
// Runs in the page's JS world (manifest "world": "MAIN") so it can read
// window.next.router, hook the page's fetch/XHR, and access __NEXT_DATA__.
// Builds a map from bytescale image-asset UUID → screen route UUID by
// observing API responses, then handles click-bypass navigation requests
// dispatched from the isolated-world content script (unblur.js).
(function(){
  if (window.__mobbinUnblurInjected) return;
  window.__mobbinUnblurInjected = true;

  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const UUID_RE_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const WATERMARK_ID = '94cdc612-6b0c-4ad7-b99c-500f420f8b98';
  const LOG = '[MobbinUnblur][page]';

  // image-asset UUID (lowercase) → screen route UUID
  const screenMap = new Map();

  // Encrypted bytescale URL OR its enc-token → path-based bytescale URL that
  // points at the same asset without paywall blur. Populated by observing
  // pairs of (encrypted, path-based) URLs that appear together in Mobbin's
  // data (React props, API responses, __NEXT_DATA__).
  const assetUrlMap = new Map();

  // enc-token → screen UUID. Used when Mobbin only sends encrypted URLs:
  // we store the enc token → screen UUID mapping, so if we later receive
  // a path-based URL for that screen we can pair them retroactively.
  const screenEncTokenMap = new Map();

  // A real path-based asset URL contains a UUID somewhere in the path.
  // Critically: must NOT match Mobbin's encrypted endpoint (`/file.webp` with `enc=` in query).
  const PATH_RE = /https?:\/\/[^"'\s]*bytescale\.mobbin\.com\/[^"'\s]*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[^"'\s]*/gi;
  const ENC_RE  = /https?:\/\/[^"'\s]*bytescale\.mobbin\.com\/[^"'\s]*\/file\.webp\?enc=[A-Za-z0-9._-]+/gi;
  function isUsablePathUrl(u) {
    if (typeof u !== 'string') return false;
    if (u.indexOf('bytescale.mobbin.com') === -1) return false;
    if (u.indexOf('/file.webp') !== -1) return false;     // Encrypted endpoint — never usable as a path
    if (u.indexOf('?enc=') !== -1) return false;          // Defensive
    // Path-based URLs must contain at least one UUID-shaped segment
    return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(u);
  }
  function encTokenOf(u){
    if (typeof u !== 'string') return null;
    const i = u.indexOf('enc=');
    if (i < 0) return null;
    return u.slice(i + 4).split('&')[0];
  }

  function isUuidNonWatermark(s) {
    if (typeof s !== 'string') return null;
    const m = s.match(UUID_RE);
    if (!m) return null;
    if (m[0].toLowerCase() === WATERMARK_ID.toLowerCase()) return null;
    return m[0];
  }

  function indexScreen(screen) {
    if (!screen || typeof screen !== 'object') return;
    const screenId = isUuidNonWatermark(screen.id)
                   || isUuidNonWatermark(screen.uuid)
                   || isUuidNonWatermark(screen.screenId);
    if (!screenId) return;
    const seen = new Set();
    function scan(s) {
      if (typeof s !== 'string') return;
      const matches = s.match(UUID_RE_G) || [];
      for (const m of matches) {
        const lc = m.toLowerCase();
        if (lc === WATERMARK_ID.toLowerCase()) continue;
        if (lc === screenId.toLowerCase()) continue;
        if (seen.has(lc)) continue;
        seen.add(lc);
        screenMap.set(lc, screenId);
      }
    }
    const imgFields = ['imageUrl','image','screenshot','thumbnail','previewUrl','preview',
                       'asset','mediaUrl','assetUrl','original','url','src','file','path'];
    for (const f of imgFields) {
      const v = screen[f];
      if (typeof v === 'string') scan(v);
      else if (v && typeof v === 'object') {
        for (const k of Object.keys(v)) {
          if (typeof v[k] === 'string') scan(v[k]);
        }
      }
    }
    if (Array.isArray(screen.assets)) {
      for (const a of screen.assets) {
        if (typeof a === 'string') scan(a);
        else if (a && typeof a === 'object') {
          for (const k of Object.keys(a)) if (typeof a[k] === 'string') scan(a[k]);
        }
      }
    }
    // Asset URL pairing: collect every bytescale string we can see on this screen
    // object (shallow), then pair encrypted URLs with path-based URLs from the
    // same object — they describe the same asset.
    try {
      const pathUrls = [];
      const encUrls = [];
      function pickUrls(s){
        if (typeof s !== 'string' || s.indexOf('bytescale.mobbin.com') === -1) return;
        const ms = s.match(ENC_RE) || []; for (const m of ms) encUrls.push(m);
        const ps = s.match(PATH_RE) || []; for (const m of ps) pathUrls.push(m);
      }
      function walkShallow(o, depth){
        if (!o || depth > 4) return;
        if (typeof o === 'string') { pickUrls(o); return; }
        if (Array.isArray(o)) { for (const x of o) walkShallow(x, depth+1); return; }
        if (typeof o !== 'object') return;
        for (const k of Object.keys(o)) walkShallow(o[k], depth+1);
      }
      walkShallow(screen, 0);
      if (pathUrls.length && encUrls.length) {
        let pathPick = null;
        for (const p of pathUrls) {
          if (!isUsablePathUrl(p)) continue;
          if (/94cdc612-6b0c-4ad7-b99c-500f420f8b98/i.test(p)) continue;
          pathPick = p;
          break;
        }
        if (pathPick) {
          for (const enc of encUrls) {
            assetUrlMap.set(enc, pathPick);
            const t = encTokenOf(enc); if (t) assetUrlMap.set('enc:' + t, pathPick);
          }
        }
      }
    } catch(_) {}

    // Additional: index any screen UUID we found, paired with all enc tokens we saw,
    // so if we later get the path URL from a different response we can pair them.
    try {
      const screenId = isUuidNonWatermark(screen.id)
                     || isUuidNonWatermark(screen.uuid)
                     || isUuidNonWatermark(screen.screenId);
      if (screenId) {
        function gatherEncTokens(o, depth, tokens) {
          if (!o || depth > 4) return;
          if (typeof o === 'string') {
            const t = encTokenOf(o); if (t) tokens.add(t);
            return;
          }
          if (Array.isArray(o)) { for (const x of o) gatherEncTokens(x, depth+1, tokens); return; }
          if (typeof o !== 'object') return;
          for (const k of Object.keys(o)) gatherEncTokens(o[k], depth+1, tokens);
        }
        const tokens = new Set();
        gatherEncTokens(screen, 0, tokens);
        for (const t of tokens) {
          if (!screenEncTokenMap.has(t)) screenEncTokenMap.set(t, screenId);
        }
      }
    } catch(_) {}
  }

  function deepWalk(obj, depth) {
    depth = depth || 0;
    if (!obj || depth > 8) return;
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        try { deepWalk(obj[i], depth + 1); } catch(_) {}
      }
      return;
    }
    if (typeof obj !== 'object') return;
    const hasUuidId =
      (typeof obj.id === 'string' && UUID_RE.test(obj.id)) ||
      (typeof obj.uuid === 'string' && UUID_RE.test(obj.uuid)) ||
      (typeof obj.screenId === 'string' && UUID_RE.test(obj.screenId));
    const hasImageField = Object.keys(obj).some(k => /image|screenshot|thumbnail|preview|asset/i.test(k));
    const isExplicitScreen = obj.__typename === 'Screen' || obj.__typename === 'AppScreen' || obj.__typename === 'MobbinScreen';
    if (isExplicitScreen || (hasUuidId && hasImageField)) indexScreen(obj);
    for (const k of Object.keys(obj)) {
      try { deepWalk(obj[k], depth + 1); } catch(_) {}
    }
  }

  function maybeIndexResponse(url, text) {
    if (!text || text.length > 8_000_000) return;
    // Try direct JSON
    try {
      const json = JSON.parse(text);
      deepWalk(json);
      return;
    } catch(_) {}
    // Try line-delimited JSON / Next.js RSC chunks
    const lines = text.split('\n');
    for (const line of lines) {
      const t = line && line.trim();
      if (!t) continue;
      // RSC stream lines look like: 1:["foo",{...}] etc. Try to find JSON-ish substrings.
      const colonIdx = t.indexOf(':');
      const candidate = colonIdx >= 0 ? t.slice(colonIdx + 1) : t;
      if (!candidate || (candidate[0] !== '{' && candidate[0] !== '[' && candidate[0] !== '"')) continue;
      try {
        const j = JSON.parse(candidate);
        deepWalk(j);
      } catch(_) {}
    }
    // Raw URL pairing pass: scan the entire response text for path-based bytescale URLs
    // (including low-res `w=15` thumbnails) and pair them with any encrypted URLs in the
    // same response. This catches cases where JSON parsing fails but both URL types exist
    // in the same API payload — common in Next.js RSC/flight data.
    try {
      if (text.indexOf('bytescale.mobbin.com') === -1) return;
      const rawPathUrls = text.match(new RegExp(PATH_RE.source, 'gi')) || [];
      const rawEncUrls  = text.match(new RegExp(ENC_RE.source, 'gi')) || [];
      if (rawPathUrls.length && rawEncUrls.length) {
        let pathPick = null;
        for (const p of rawPathUrls) {
          if (!isUsablePathUrl(p)) continue;
          if (/94cdc612-6b0c-4ad7-b99c-500f420f8b98/i.test(p)) continue;
          pathPick = p;
          break;
        }
        if (pathPick) {
          let added = 0;
          for (const enc of rawEncUrls) {
            if (!assetUrlMap.has(enc)) { assetUrlMap.set(enc, pathPick); added++; }
            const t = encTokenOf(enc);
            if (t && !assetUrlMap.has('enc:' + t)) { assetUrlMap.set('enc:' + t, pathPick); added++; }
          }
          if (added) {
            try { console.debug(LOG, 'raw URL pairing: found', rawPathUrls.length, 'path + ', rawEncUrls.length, 'enc URLs in response, added', added, 'mappings'); } catch(_) {}
            try { rewriteEncryptedImages(); } catch(_) {}
          }
        }
      }
    } catch(_) {}
  }

  // --- Hook fetch ---
  try {
    const origFetch = window.fetch;
    window.fetch = function() {
      const args = arguments;
      const promise = origFetch.apply(this, args);
      promise.then(function(resp) {
        try {
          const url = (typeof args[0] === 'string') ? args[0] : (args[0] && args[0].url) || '';
          if (!resp || !resp.clone) return;
          const cloned = resp.clone();
          cloned.text().then(function(text) {
            try { maybeIndexResponse(url, text); } catch(_) {}
          }).catch(function() {});
        } catch(_) {}
      }, function() {});
      return promise;
    };
  } catch(_) {}

  // --- Hook XHR ---
  try {
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      this.__muUrl = url;
      return origOpen.apply(this, arguments);
    };
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
      this.addEventListener('load', function() {
        try { maybeIndexResponse(this.__muUrl || '', this.responseText); } catch(_) {}
      });
      return origSend.apply(this, arguments);
    };
  } catch(_) {}

  // --- Read screen data straight from React fibers on rendered cells ---
  // Mobbin renders each card via a `ScreenCell` component (data-sentry-component="ScreenCell")
  // and the grid via `ScreensGrid`. Both receive screen props that contain the screen's id
  // and image URL, regardless of whether the card is rendered as a clickable <a> or a locked <div>.
  function readFiberAt(el) {
    try {
      const k = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      return k ? el[k] : null;
    } catch(_) { return null; }
  }

  // Permissive: feeds every object-shaped prop value into indexScreen, which
  // self-filters (only stores entries when the object has a non-watermark UUID id
  // AND a string field that contains another non-watermark UUID — i.e. an image asset).
  function harvestPropsFromFiber(rootFiber, depthLimit) {
    if (!rootFiber) return;
    let fiber = rootFiber;
    for (let depth = 0; fiber && depth < (depthLimit || 30); depth++, fiber = fiber.return) {
      try {
        const props = fiber.memoizedProps;
        if (!props || typeof props !== 'object') continue;
        for (const k of Object.keys(props)) {
          const v = props[k];
          if (!v || typeof v !== 'object') continue;
          indexScreen(v);
          if (Array.isArray(v)) {
            for (let i = 0; i < v.length; i++) {
              const item = v[i];
              if (item && typeof item === 'object') indexScreen(item);
            }
          }
        }
      } catch(_) {}
    }
  }

  // Walk fiber from every bytescale image. Catches locked cards (which don't
  // carry data-sentry-component="ScreenCell") because their image is still in the DOM.
  function harvestFromAllImages() {
    try {
      const imgs = document.querySelectorAll('img[src*="bytescale.mobbin.com"]');
      for (const img of imgs) harvestPropsFromFiber(readFiberAt(img), 50);
    } catch(_) {}
  }

  function harvestFromCells() {
    try {
      let cells = Array.from(document.querySelectorAll('[data-sentry-component="ScreenCell"], [data-sentry-source-file="ScreenCell.tsx"]'));
      for (const cell of cells) harvestPropsFromFiber(readFiberAt(cell), 30);
    } catch(_) {}
  }

  function harvestFromGrid() {
    try {
      const grid = document.querySelector('[data-sentry-component="ScreensGrid"]') || document.querySelector('[data-sentry-source-file="ScreensGrid.tsx"]');
      if (!grid) return;
      harvestPropsFromFiber(readFiberAt(grid), 40);
    } catch(_) {}
  }

  function harvestFromAnchors() {
    try {
      document.querySelectorAll('a[href*="/screens/"]').forEach(function(a){
        const href = a.getAttribute('href') || '';
        const screenMatch = href.match(UUID_RE);
        if (!screenMatch) return;
        const screenId = screenMatch[0];
        if (screenId.toLowerCase() === WATERMARK_ID.toLowerCase()) return;
        a.querySelectorAll('img[src*="bytescale.mobbin.com"]').forEach(function(img){
          const src = (img.src || '').split('?')[0];
          const all = src.match(UUID_RE_G) || [];
          for (const m of all) {
            const lc = m.toLowerCase();
            if (lc === WATERMARK_ID.toLowerCase()) continue;
            if (lc === screenId.toLowerCase()) continue;
            screenMap.set(lc, screenId);
          }
        });
      });
    } catch(_) {}
  }

  // Scan all ScreenCell DOM nodes: walk each one's fiber looking for a pair of
  // (encrypted URL, path-based URL) in the same props subtree, and pre-populate
  // assetUrlMap so rewriteEncryptedImages can rewrite even before img.src is set.
  function harvestUrlsFromCellFibers() {
    try {
      // Also scan all img elements with encrypted srcs for their fiber path URLs
      const encImgs = document.querySelectorAll('img[src*="file.webp"][src*="enc="]');
      let added = 0;
      for (const img of encImgs) {
        const encSrc = img.src || '';
        if (!encSrc) continue;
        // Already mapped
        if (assetUrlMap.has(encSrc)) continue;
        const pathUrl = fiberPathUrl(img);
        if (pathUrl) {
          assetUrlMap.set(encSrc, pathUrl);
          const t = encTokenOf(encSrc);
          if (t) assetUrlMap.set('enc:' + t, pathUrl);
          added++;
        }
      }
      if (added) {
        try { console.debug(LOG, 'harvestUrlsFromCellFibers: pre-mapped', added, 'encrypted → path pairs'); } catch(_) {}
      }
    } catch(_) {}
  }

  // --- Index __NEXT_DATA__ (initial SSR payload), then harvest from rendered DOM ---
  function indexInitial() {
    try { if (window.__NEXT_DATA__) deepWalk(window.__NEXT_DATA__); } catch(_) {}
    harvestFromAnchors();
    harvestFromCells();
    harvestFromGrid();
    harvestFromAllImages();
    harvestUrlsFromCellFibers();
    // After each harvest pass, try to rewrite any encrypted images we now have
    // the asset pairing for.
    try { rewriteEncryptedImages(); } catch(_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', indexInitial);
  } else { indexInitial(); }
  setTimeout(indexInitial, 1500);
  setTimeout(indexInitial, 4000);
  // Re-index on DOM mutations (new cards added on scroll)
  try {
    const mo = new MutationObserver(function(){
      // debounce
      clearTimeout(mo.__t);
      mo.__t = setTimeout(function(){
        indexInitial();
        rewriteEncryptedImages();
      }, 250);
    });
    if (document.body) mo.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded', function(){ mo.observe(document.body, { childList: true, subtree: true }); });
  } catch(_) {}

  // Apply the same query-string rewrite unblur.js's unifiedUrl does, in one step,
  // so we don't depend on unblur.js re-running after we change src.
  function fullUnblurUrl(pathUrl) {
    if (!pathUrl) return pathUrl;
    const base = String(pathUrl).split('?')[0];
    return base + '?f=webp&w=3840&q=85&fit=shrink-cover&extend-bottom=120&image=%2Fmobbin.com%2Fprod%2Fwatermark%2F1.0%2F' + WATERMARK_ID + '%2F3840&gravity=bottom&v=1.0';
  }

  // Rewrite every <img src="...file.webp?enc=..."> to the fully-unblurred path-based
  // equivalent. Uses two strategies:
  //   1. assetUrlMap lookup (populated by API response interception)
  //   2. React fiber walk — each ScreenCell has screenUrl/imageUrl props with the
  //      path-based URL even when the DOM img.src is encrypted.
  const rewroteImg = new WeakSet();

  // Walk the React fiber tree from a DOM element looking for a usable bytescale path URL
  // in props named screenUrl, imageUrl, fullpageScreenUrl, url, src, image, thumbnail, etc.
  // This is the primary unblur strategy now that Mobbin encrypts all img.src attributes.
  function fiberPathUrl(el) {
    try {
      const fk = Object.keys(el).find(function(k){ return k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'); });
      if (!fk) return null;
      let fiber = el[fk];
      const URL_PROP_NAMES = ['screenUrl','imageUrl','fullpageScreenUrl','originalUrl','assetUrl','url','src','image','thumbnail','previewUrl','screenshot','mediaUrl','cdnUrl'];
      for (let depth = 0; fiber && depth < 50; depth++, fiber = fiber.return) {
        try {
          const props = fiber.memoizedProps;
          if (!props || typeof props !== 'object') continue;
          // Direct string props
          for (const k of URL_PROP_NAMES) {
            const v = props[k];
            if (typeof v === 'string' && isUsablePathUrl(v)) return v;
          }
          // One level nested (props.screen.screenUrl, props.data.imageUrl, etc.)
          for (const k of Object.keys(props)) {
            const v = props[k];
            if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
            for (const sk of URL_PROP_NAMES) {
              const sv = v[sk];
              if (typeof sv === 'string' && isUsablePathUrl(sv)) return sv;
            }
            // Also scan all string values of the nested object for bytescale path URLs
            for (const sk of Object.keys(v)) {
              const sv = v[sk];
              if (typeof sv === 'string' && sv.indexOf('bytescale.mobbin.com') !== -1 && isUsablePathUrl(sv)) return sv;
            }
          }
          // Also scan all top-level string prop values for bytescale path URLs
          for (const k of Object.keys(props)) {
            const v = props[k];
            if (typeof v === 'string' && v.indexOf('bytescale.mobbin.com') !== -1 && isUsablePathUrl(v)) return v;
          }
        } catch(_) {}
      }
    } catch(_) {}
    return null;
  }

  function rewriteEncryptedImages() {
    try {
      const imgs = document.querySelectorAll('img[src*="file.webp"][src*="enc="]');
      if (!imgs.length) return;
      let n = 0;
      for (const img of imgs) {
        if (rewroteImg.has(img)) continue;
        const src = img.src || '';

        // Strategy 1: assetUrlMap (populated by API interception)
        let pathUrl = assetUrlMap.get(src);
        if (!pathUrl) {
          const t = encTokenOf(src);
          if (t) pathUrl = assetUrlMap.get('enc:' + t);
        }

        // Strategy 2: React fiber walk — finds screenUrl/imageUrl in ScreenCell props
        if (!pathUrl) pathUrl = fiberPathUrl(img);

        if (!pathUrl || !isUsablePathUrl(pathUrl)) continue;
        rewroteImg.add(img);
        try {
          if (img.hasAttribute('srcset')) img.removeAttribute('srcset');
          if (img.hasAttribute('sizes')) img.removeAttribute('sizes');
        } catch(_) {}
        try { img.src = fullUnblurUrl(pathUrl); } catch(_) { continue; }
        n++;
      }
      if (n) { try { console.log(LOG, 'rewriteEncryptedImages — unblurred', n, 'img(s)'); } catch(_) {} }
    } catch(_) {}
  }

  setTimeout(rewriteEncryptedImages, 1500);
  setTimeout(rewriteEncryptedImages, 4000);

  // Diagnostic surface — type window.__MobbinUnblur_diag in console.
  // Also exposes window.__MobbinUnblur_reharvest() to manually re-run all harvest paths.
  try {
    Object.defineProperty(window, '__MobbinUnblur_diag', {
      configurable: true,
      get: function() {
        const sentryCells = document.querySelectorAll('[data-sentry-component="ScreenCell"]').length;
        const grid = document.querySelector('[data-sentry-component="ScreensGrid"]');
        const gridFiber = grid ? readFiberAt(grid) : null;
        const anchors = document.querySelectorAll('a[href*="/screens/"]').length;
        const bytescaleImgs = document.querySelectorAll('img[src*="bytescale.mobbin.com"]').length;
        const encImgs = document.querySelectorAll('img[src*="file.webp"][src*="enc="]').length;
        return {
          screenMapSize: screenMap.size,
          sample: Array.from(screenMap.entries()).slice(0, 5),
          assetMapSize: assetUrlMap.size,
          assetSample: Array.from(assetUrlMap.entries()).slice(0, 3).map(function(p){
            return [String(p[0]).slice(0, 80), String(p[1]).slice(0, 80)];
          }),
          encryptedImagesInDom: encImgs,
          hasNextData: !!window.__NEXT_DATA__,
          hasNextRouter: !!(window.next && window.next.router && typeof window.next.router.push === 'function'),
          sentryScreenCells: sentryCells,
          screenAnchorsInDom: anchors,
          bytescaleImagesInDom: bytescaleImgs,
          gridFiberAvailable: !!gridFiber
        };
      }
    });
    window.__MobbinUnblur_reharvest = function() {
      const before = screenMap.size;
      indexInitial();
      console.debug(LOG, 're-harvest:', before, '→', screenMap.size);
      return screenMap.size;
    };
  } catch(_) {}

  function navigate(target) {
    if (!target) return;
    try { console.log(LOG, 'navigate →', target); } catch(_) {}
    let usedRouter = false;
    try {
      if (window.next && window.next.router && typeof window.next.router.push === 'function') {
        window.next.router.push(target);
        usedRouter = true;
      }
    } catch(_) {}
    if (!usedRouter) {
      try {
        history.pushState({}, '', target);
        window.dispatchEvent(new PopStateEvent('popstate'));
      } catch(_) {
        try { window.location.href = target; } catch(_) {}
        return;
      }
    }
    // Always schedule the rollback — applies whether we used router.push or pushState.
    // If neither rendered the modal in 600ms, roll back so the user stays where they were
    // instead of being stranded on a 404 (which scrolls to top).
    setTimeout(function () {
      try {
        const hasModal = document.querySelector('[role="dialog"], [class*="ScreenModal"], [class*="screen-modal"], [class*="ScreenDetail"]');
        if (!hasModal && (window.location.pathname || '').includes(target)) {
          try { console.warn(LOG, 'navigate failed to render modal — rolling back', target); } catch(_) {}
          try { history.back(); } catch(_) {}
        }
      } catch(_) {}
    }, 600);
  }

  // Names of fields that, when present together, distinguish a Screen object from
  // an App / User / Flow / Category. (Apps have `slug`/`iconUrl`/`platforms`; Users have
  // `email`/`avatarUrl`; Flows have `screens`/`firstScreen`. Screens have image-related
  // fields and platform/category metadata.)
  const SCREEN_FIELD_HINTS = [
    'imageAssetId','imageAsset','imageUrl','imageURL','image','screenshot','thumbnail',
    'screenName','screenTitle','platform','platforms','category','categories','section',
    'sections','flowName','app','appId','appName','width','height','aspectRatio',
    'previewUrl','preview','blurhash','order','position'
  ];

  // Permissive screen-detection. Returns a screen UUID if there's reasonable evidence
  // the object is a Screen — but rejects naked-UUID objects that could be Apps, Users, Flows.
  // Strong signals (any 1 is enough): __typename, a bytescale URL anywhere, ≥3 screen-shaped fields.
  function isProbablyScreen(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const id = isUuidNonWatermark(obj.id) || isUuidNonWatermark(obj.uuid) || isUuidNonWatermark(obj.screenId);
    if (!id) return null;
    if (obj.__typename === 'Screen' || obj.__typename === 'AppScreen' || obj.__typename === 'MobbinScreen') return id;
    // Look for a literal bytescale URL anywhere shallow
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'string' && v.indexOf('bytescale.mobbin.com') !== -1) return id;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const sk of Object.keys(v)) {
          const sv = v[sk];
          if (typeof sv === 'string' && sv.indexOf('bytescale.mobbin.com') !== -1) return id;
        }
      }
    }
    // Count screen-shaped field names. Require ≥3 to accept (rules out Apps/Users/Flows
    // which typically share at most 1–2 of these names).
    let screenSignals = 0;
    const objKeys = Object.keys(obj);
    for (const k of objKeys) {
      if (SCREEN_FIELD_HINTS.indexOf(k) !== -1) screenSignals++;
    }
    // Disqualify obvious non-screens: anything with App/User/Flow-distinctive fields
    const notScreen = objKeys.indexOf('slug') !== -1 || objKeys.indexOf('iconUrl') !== -1 ||
                      objKeys.indexOf('email') !== -1 || objKeys.indexOf('avatarUrl') !== -1 ||
                      objKeys.indexOf('firstScreen') !== -1 || objKeys.indexOf('screens') !== -1;
    if (!notScreen && screenSignals >= 3) return id;
    return null;
  }

  // Walk the React fiber tree from a specific DOM node, looking for an ancestor
  // fiber whose props contain a Screen object. Trusts `props.screen` by convention
  // (just needs a UUID id), and uses isProbablyScreen for everything else.
  function findScreenUuidFromElement(el) {
    let fiber = readFiberAt(el);
    if (!fiber) return null;
    for (let depth = 0; fiber && depth < 60; depth++, fiber = fiber.return) {
      try {
        const props = fiber.memoizedProps;
        if (!props || typeof props !== 'object') continue;
        // 1. Trust `props.screen` (named exactly 'screen') with a UUID id — by convention
        // a prop literally called `screen` carries the screen entity, not an App or User.
        if (props.screen && typeof props.screen === 'object' && !Array.isArray(props.screen)) {
          const id = isUuidNonWatermark(props.screen.id) || isUuidNonWatermark(props.screen.uuid) || isUuidNonWatermark(props.screen.screenId);
          if (id) return id;
        }
        // 2. Any other object-shaped prop value, validated by isProbablyScreen
        for (const k of Object.keys(props)) {
          if (k === 'screen') continue; // already handled
          const v = props[k];
          if (!v || typeof v !== 'object') continue;
          if (Array.isArray(v)) {
            for (let i = 0; i < v.length; i++) {
              const id = isProbablyScreen(v[i]);
              if (id) return id;
            }
          } else {
            const id = isProbablyScreen(v);
            if (id) return id;
          }
        }
      } catch(_) {}
    }
    return null;
  }

  function dumpFiberKeys(el) {
    try {
      let fiber = readFiberAt(el);
      const out = [];
      for (let d = 0; fiber && d < 12; d++, fiber = fiber.return) {
        const p = fiber.memoizedProps;
        const compName = (fiber.type && (fiber.type.displayName || fiber.type.name || '')) || '';
        out.push({
          depth: d,
          comp: compName,
          propKeys: p && typeof p === 'object' ? Object.keys(p).slice(0, 12) : null
        });
      }
      return out;
    } catch(e) { return [{ error: String(e) }]; }
  }

  document.addEventListener('MobbinUnblur_Navigate', function(ev) {
    try {
      const detail = (ev && ev.detail) || {};
      try { console.log(LOG, 'navigate event received', detail); } catch(_) {}
      let target = detail.target;
      // Strategy 0: if we have the clicked element's id, walk its fiber tree first.
      // Works for encrypted-URL images where we can't extract an asset UUID.
      if (!target && detail.clickElementId) {
        try {
          const el = document.querySelector('[data-mobbin-click="' + detail.clickElementId + '"]');
          if (el) {
            const sid = findScreenUuidFromElement(el);
            try { el.removeAttribute('data-mobbin-click'); } catch(_) {}
            if (sid) target = '/screens/' + sid;
          }
        } catch(_) {}
      }
      if (!target && detail.imageAssetUuid) {
        const lc = String(detail.imageAssetUuid).toLowerCase();
        let screenUuid = screenMap.get(lc);

        // JIT 1: find the matching image and try a direct fiber-based lookup
        if (!screenUuid) {
          try {
            const imgs = document.querySelectorAll('img[src*="bytescale.mobbin.com"]');
            for (let i = 0; i < imgs.length; i++) {
              const path = (imgs[i].src || '').split('?')[0].toLowerCase();
              if (path.indexOf(lc) === -1) continue;
              // Try direct walk-and-find
              screenUuid = findScreenUuidFromElement(imgs[i]);
              if (screenUuid) {
                screenMap.set(lc, screenUuid); // cache
                break;
              }
              // Fall back: harvest props (might index it via image-field heuristic)
              harvestPropsFromFiber(readFiberAt(imgs[i]), 60);
              screenUuid = screenMap.get(lc);
              if (screenUuid) break;
              // Final attempt: walk parent elements' fibers too
              let cur = imgs[i].parentElement;
              for (let d = 0; cur && d < 6 && !screenUuid; d++, cur = cur.parentElement) {
                screenUuid = findScreenUuidFromElement(cur);
              }
              if (screenUuid) {
                screenMap.set(lc, screenUuid);
                break;
              }
              // Last resort: log fiber tree shape so we can diagnose
              try { console.log(LOG, 'fiber inspect for', lc, dumpFiberKeys(imgs[i])); } catch(_) {}
            }
          } catch(_) {}
        }
        if (screenUuid) target = '/screens/' + screenUuid;
        else {
          try {
            console.warn(LOG, '⚠️ could not resolve screen for asset', lc,
                         '| screenMap size:', screenMap.size,
                         '| sentryScreenCells:', document.querySelectorAll('[data-sentry-component="ScreenCell"]').length,
                         '| bytescaleImgs:', document.querySelectorAll('img[src*="bytescale.mobbin.com"]').length);
          } catch(_) {}
        }
      }
      if (target) {
        navigate(target);
      } else if (detail.fallbackAnchorHref) {
        // We preventDefault'd the click but couldn't resolve a screen modal target.
        // Honor the original anchor's intent so the user isn't stuck where they were.
        try { console.log(LOG, 'fallback → natural anchor href', detail.fallbackAnchorHref); } catch(_) {}
        try {
          if (window.next && window.next.router && typeof window.next.router.push === 'function') {
            window.next.router.push(detail.fallbackAnchorHref);
          } else {
            window.location.href = detail.fallbackAnchorHref;
          }
        } catch(_) {
          try { window.location.href = detail.fallbackAnchorHref; } catch(_) {}
        }
      }
    } catch(_) {}
  });

  try { console.debug(LOG, 'inject.js loaded; fetch+XHR hooked'); } catch(_) {}
})();
