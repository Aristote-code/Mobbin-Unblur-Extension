// Mobbin Unblur PRO — page-context injector v7.0
// Runs in the page's JS world (manifest "world": "MAIN") so it can read
// window.next.router, hook the page's fetch/XHR, and access __NEXT_DATA__.
//
// v7.0 — New primary strategy: UUID extraction + path URL construction.
// Since Mobbin encrypts all img.src values, we extract the asset UUID from
// React fiber props (screenUrl / imageUrl contain the path URL even when img.src
// is encrypted) and construct the full-res path URL directly.
(function(){
  if (window.__mobbinUnblurInjected) return;
  window.__mobbinUnblurInjected = true;

  const UUID_RE   = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const UUID_RE_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const WATERMARK_ID = '94cdc612-6b0c-4ad7-b99c-500f420f8b98';
  const LOG = '[MobbinUnblur][page]';

  // ── URL helpers ──────────────────────────────────────────────────────────────
  const PATH_RE = /https?:\/\/[^\s"'<>]*bytescale\.mobbin\.com\/[^\s"'<>]*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[^\s"'<>]*/gi;
  const ENC_RE  = /https?:\/\/[^\s"'<>]*bytescale\.mobbin\.com\/[^\s"'<>]*\/file\.webp\?enc=[A-Za-z0-9._%-]+/gi;

  function isUsablePathUrl(u) {
    if (typeof u !== 'string') return false;
    if (u.indexOf('bytescale.mobbin.com') === -1) return false;
    if (u.indexOf('/file.webp') !== -1) return false;
    if (u.indexOf('?enc=') !== -1) return false;
    return UUID_RE.test(u);
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

  // ── Bytescale account prefix ──────────────────────────────────────────────────
  // Looks like "FW25bBB" — extracted from any bytescale URL on the page.
  // All screens share the same account prefix, so we only need to find it once.
  let _accountPrefix = null;
  function getAccountPrefix() {
    if (_accountPrefix) return _accountPrefix;
    try {
      // Try from existing image src attributes
      const imgs = document.querySelectorAll('img[src*="bytescale.mobbin.com"]');
      for (const img of imgs) {
        const m = (img.src || '').match(/bytescale\.mobbin\.com\/([A-Za-z0-9]{6,12})\//);
        if (m) { _accountPrefix = m[1]; return _accountPrefix; }
      }
      // Try from HTML source
      const m2 = document.documentElement.innerHTML.match(/bytescale\.mobbin\.com\/([A-Za-z0-9]{6,12})\//);
      if (m2) { _accountPrefix = m2[1]; return _accountPrefix; }
    } catch(_) {}
    return null;
  }

  // ── Build fully-unblurred URL ─────────────────────────────────────────────────
  function fullUnblurUrl(pathUrl) {
    if (!pathUrl) return pathUrl;
    const base = String(pathUrl).split('?')[0];
    return base + '?f=webp&w=3840&q=85&fit=shrink-cover&extend-bottom=120' +
           '&image=%2Fmobbin.com%2Fprod%2Fwatermark%2F1.0%2F' + WATERMARK_ID +
           '%2F3840&gravity=bottom&v=1.0';
  }

  // Construct a path URL from a UUID and known account prefix.
  // Tries the most common Mobbin path template first.
  function buildPathFromUuid(uuid, account) {
    if (!uuid || !account) return null;
    // Primary template: /image/mobbin.com/prod/content/app_screens/{uuid}.png
    return 'https://bytescale.mobbin.com/' + account + '/image/mobbin.com/prod/content/app_screens/' + uuid + '.png';
  }

  // ── screenMap: image-asset UUID → screen route UUID ──────────────────────────
  const screenMap = new Map();

  // ── assetUrlMap: encrypted URL or enc-token → path URL ───────────────────────
  const assetUrlMap = new Map();

  // ── rewroteImg: WeakSet of img elements already rewritten ────────────────────
  const rewroteImg = new WeakSet();

  // ── React fiber helpers ──────────────────────────────────────────────────────
  function readFiberAt(el) {
    try {
      const k = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      return k ? el[k] : null;
    } catch(_) { return null; }
  }

  // Walk the fiber tree from el, collecting all string values that look like
  // usable bytescale path URLs. Returns the first one found, or null.
  // Searches up to `depthLimit` fiber ancestors.
  function fiberPathUrl(el, depthLimit) {
    try {
      let fiber = readFiberAt(el);
      if (!fiber) return null;

      const NAMED = [
        'screenUrl','imageUrl','fullpageScreenUrl','originalUrl','assetUrl',
        'cdnUrl','mediaUrl','previewUrl','screenshot','thumbnail'
      ];

      for (let d = 0; fiber && d < (depthLimit || 60); d++, fiber = fiber.return) {
        try {
          const p = fiber.memoizedProps;
          if (!p || typeof p !== 'object') continue;

          // 1. Named string props at top level
          for (const k of NAMED) {
            if (typeof p[k] === 'string' && isUsablePathUrl(p[k])) return p[k];
          }

          // 2. All string props at top level
          for (const k of Object.keys(p)) {
            const v = p[k];
            if (typeof v === 'string' && v.indexOf('bytescale.mobbin.com') !== -1 && isUsablePathUrl(v)) {
              return v;
            }
          }

          // 3. One level nested objects (props.screen, props.data, props.item, etc.)
          for (const k of Object.keys(p)) {
            const v = p[k];
            if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
            // Named props in nested object
            for (const sk of NAMED) {
              if (typeof v[sk] === 'string' && isUsablePathUrl(v[sk])) return v[sk];
            }
            // All string props in nested object
            for (const sk of Object.keys(v)) {
              const sv = v[sk];
              if (typeof sv === 'string' && sv.indexOf('bytescale.mobbin.com') !== -1 && isUsablePathUrl(sv)) {
                return sv;
              }
            }
          }
        } catch(_) {}
      }
    } catch(_) {}
    return null;
  }

  // Extract any non-watermark UUID from fiber props (from screen objects).
  // Used as fallback to construct a path URL if no path URL is found.
  function fiberAssetUuid(el) {
    try {
      let fiber = readFiberAt(el);
      if (!fiber) return null;

      const SCREEN_UUID_KEYS = ['imageAssetId','assetId','screenUrl','imageUrl','fullpageScreenUrl'];

      for (let d = 0; fiber && d < 60; d++, fiber = fiber.return) {
        try {
          const p = fiber.memoizedProps;
          if (!p || typeof p !== 'object') continue;

          // Try to find a UUID in screenUrl/imageUrl path
          for (const k of SCREEN_UUID_KEYS) {
            const v = p[k];
            if (typeof v === 'string') {
              const uuids = v.match(UUID_RE_G) || [];
              for (const u of uuids) {
                if (u.toLowerCase() !== WATERMARK_ID.toLowerCase()) return u;
              }
            }
          }

          // Try nested objects
          for (const k of Object.keys(p)) {
            const v = p[k];
            if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
            for (const sk of SCREEN_UUID_KEYS) {
              const sv = v[sk];
              if (typeof sv === 'string') {
                const uuids = sv.match(UUID_RE_G) || [];
                for (const u of uuids) {
                  if (u.toLowerCase() !== WATERMARK_ID.toLowerCase()) return u;
                }
              }
            }
            // Also look at imageAssetId / assetId directly
            if (typeof v.imageAssetId === 'string') {
              const u = isUuidNonWatermark(v.imageAssetId);
              if (u) return u;
            }
            if (typeof v.assetId === 'string') {
              const u = isUuidNonWatermark(v.assetId);
              if (u) return u;
            }
          }
        } catch(_) {}
      }
    } catch(_) {}
    return null;
  }

  // ── Core rewrite: encrypted → path ──────────────────────────────────────────
  function rewriteEncryptedImages() {
    try {
      const imgs = document.querySelectorAll('img[src*="file.webp"][src*="enc="]');
      if (!imgs.length) return;

      const account = getAccountPrefix();
      let n = 0;

      for (const img of imgs) {
        if (rewroteImg.has(img)) continue;
        const src = img.src || '';

        // ── Strategy 1: assetUrlMap (populated by API interception / raw text scan)
        let pathUrl = assetUrlMap.get(src);
        if (!pathUrl) {
          const t = encTokenOf(src);
          if (t) pathUrl = assetUrlMap.get('enc:' + t);
        }

        // ── Strategy 2: React fiber — look for screenUrl/imageUrl path prop
        if (!pathUrl) pathUrl = fiberPathUrl(img);

        // ── Strategy 3: Extract UUID from fiber, construct path URL
        if (!pathUrl && account) {
          const uuid = fiberAssetUuid(img);
          if (uuid) pathUrl = buildPathFromUuid(uuid, account);
        }

        if (!pathUrl || !isUsablePathUrl(pathUrl)) continue;

        rewroteImg.add(img);
        try { if (img.hasAttribute('srcset')) img.removeAttribute('srcset'); } catch(_) {}
        try { if (img.hasAttribute('sizes'))  img.removeAttribute('sizes');  } catch(_) {}
        try { img.src = fullUnblurUrl(pathUrl); } catch(_) { continue; }
        n++;
      }

      if (n) {
        try { console.log(LOG, 'rewriteEncryptedImages — unblurred', n, 'img(s)'); } catch(_) {}
      }
    } catch(_) {}
  }

  // ── indexScreen: builds screenMap for navigation bypass ──────────────────────
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
                       'asset','mediaUrl','assetUrl','original','url','src','file','path',
                       'screenUrl','fullpageScreenUrl','cdnUrl'];
    for (const f of imgFields) {
      const v = screen[f];
      if (typeof v === 'string') scan(v);
      else if (v && typeof v === 'object') {
        for (const k of Object.keys(v)) {
          if (typeof v[k] === 'string') scan(v[k]);
        }
      }
    }

    // Also pair enc URLs with path URLs found in the same object
    try {
      const pathUrls = [];
      const encUrls  = [];
      function pickUrls(s){
        if (typeof s !== 'string' || s.indexOf('bytescale.mobbin.com') === -1) return;
        const ms = s.match(new RegExp(ENC_RE.source, 'gi')) || [];
        for (const m of ms) encUrls.push(m);
        const ps = s.match(new RegExp(PATH_RE.source, 'gi')) || [];
        for (const m of ps) pathUrls.push(m);
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
    const hasImageField = Object.keys(obj).some(k => /image|screenshot|thumbnail|preview|asset|screenUrl/i.test(k));
    const isExplicitScreen = obj.__typename === 'Screen' || obj.__typename === 'AppScreen' || obj.__typename === 'MobbinScreen';
    if (isExplicitScreen || (hasUuidId && hasImageField)) indexScreen(obj);
    for (const k of Object.keys(obj)) {
      try { deepWalk(obj[k], depth + 1); } catch(_) {}
    }
  }

  // ── maybeIndexResponse: scan API response text for URL pairings ──────────────
  function maybeIndexResponse(url, text) {
    if (!text || text.length > 8_000_000) return;
    // Try direct JSON
    try {
      const json = JSON.parse(text);
      deepWalk(json);
    } catch(_) {}
    // Try RSC / line-delimited JSON
    try {
      const lines = text.split('\n');
      for (const line of lines) {
        const t = line && line.trim();
        if (!t) continue;
        const colonIdx = t.indexOf(':');
        const candidate = colonIdx >= 0 ? t.slice(colonIdx + 1) : t;
        if (!candidate || (candidate[0] !== '{' && candidate[0] !== '[' && candidate[0] !== '"')) continue;
        try { deepWalk(JSON.parse(candidate)); } catch(_) {}
      }
    } catch(_) {}
    // Raw URL pairing: scan for any path URL + enc URL in the same response
    try {
      if (text.indexOf('bytescale.mobbin.com') === -1) return;
      const rawPathUrls = text.match(new RegExp(PATH_RE.source, 'gi')) || [];
      const rawEncUrls  = text.match(new RegExp(ENC_RE.source, 'gi'))  || [];
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
            try { console.debug(LOG, 'raw URL pairing: added', added, 'mappings from response'); } catch(_) {}
            try { rewriteEncryptedImages(); } catch(_) {}
          }
        }
      }
    } catch(_) {}
  }

  // ── Hook fetch ───────────────────────────────────────────────────────────────
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

  // ── Hook XHR ─────────────────────────────────────────────────────────────────
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

  // ── Harvest fiber props from DOM elements ────────────────────────────────────
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

  function harvestFromAllImages() {
    try {
      const imgs = document.querySelectorAll('img[src*="bytescale.mobbin.com"]');
      for (const img of imgs) harvestPropsFromFiber(readFiberAt(img), 50);
    } catch(_) {}
  }

  function harvestFromCells() {
    try {
      const cells = Array.from(document.querySelectorAll('[data-sentry-component="ScreenCell"], [data-sentry-source-file="ScreenCell.tsx"]'));
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

  // ── indexInitial: full harvest + rewrite pass ────────────────────────────────
  function indexInitial() {
    try { if (window.__NEXT_DATA__) deepWalk(window.__NEXT_DATA__); } catch(_) {}
    harvestFromAnchors();
    harvestFromCells();
    harvestFromGrid();
    harvestFromAllImages();
    try { rewriteEncryptedImages(); } catch(_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', indexInitial);
  } else { indexInitial(); }
  setTimeout(indexInitial, 800);
  setTimeout(indexInitial, 2000);
  setTimeout(indexInitial, 5000);

  // Re-index on DOM mutations (new cards added on scroll)
  try {
    const mo = new MutationObserver(function(){
      clearTimeout(mo.__t);
      mo.__t = setTimeout(function(){
        indexInitial();
        rewriteEncryptedImages();
      }, 250);
    });
    if (document.body) mo.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded', function(){ mo.observe(document.body, { childList: true, subtree: true }); });
  } catch(_) {}

  setTimeout(rewriteEncryptedImages, 1000);
  setTimeout(rewriteEncryptedImages, 3000);
  setTimeout(rewriteEncryptedImages, 6000);

  // ── Diagnostic ───────────────────────────────────────────────────────────────
  try {
    Object.defineProperty(window, '__MobbinUnblur_diag', {
      configurable: true,
      get: function() {
        const encImgs   = document.querySelectorAll('img[src*="file.webp"][src*="enc="]');
        const rewritten = document.querySelectorAll('img[src*="bytescale.mobbin.com"][src*="w=3840"]');
        const allByte   = document.querySelectorAll('img[src*="bytescale.mobbin.com"]');
        const anchors   = document.querySelectorAll('a[href*="/screens/"]');
        const grid      = document.querySelector('[data-sentry-component="ScreensGrid"]');
        return {
          accountPrefix: _accountPrefix || getAccountPrefix(),
          screenMapSize: screenMap.size,
          assetMapSize: assetUrlMap.size,
          encryptedImagesInDom: encImgs.length,
          rewrittenImages: rewritten.length,
          totalBytescaleImages: allByte.length,
          screenAnchorsInDom: anchors.length,
          gridFiberAvailable: !!(grid && readFiberAt(grid)),
          sample_assetMap: Array.from(assetUrlMap.entries()).slice(0,3).map(p => [String(p[0]).slice(0,60), String(p[1]).slice(0,60)]),
        };
      }
    });
    window.__MobbinUnblur_reharvest = function() {
      indexInitial();
      rewriteEncryptedImages();
      return window.__MobbinUnblur_diag;
    };
    window.__MobbinUnblur_forceRewrite = rewriteEncryptedImages;
  } catch(_) {}

  // ── Navigation: ScreenCell click bypass ─────────────────────────────────────
  // (isProbablyScreen, findScreenUuidFromElement, navigate, onMobbinUnblurNavigate)
  const SCREEN_FIELD_HINTS = [
    'imageAssetId','imageAsset','imageUrl','imageURL','image','screenshot','thumbnail',
    'screenName','screenTitle','platform','platforms','category','categories','section',
    'sections','flowName','app','appId','appName','width','height','aspectRatio',
    'previewUrl','preview','blurhash','order','position','screenUrl','fullpageScreenUrl'
  ];

  function isProbablyScreen(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const id = isUuidNonWatermark(obj.id) || isUuidNonWatermark(obj.uuid) || isUuidNonWatermark(obj.screenId);
    if (!id) return null;
    if (obj.__typename === 'Screen' || obj.__typename === 'AppScreen' || obj.__typename === 'MobbinScreen') return id;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'string' && v.indexOf('bytescale.mobbin.com') !== -1) return id;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const sk of Object.keys(v)) {
          if (typeof v[sk] === 'string' && v[sk].indexOf('bytescale.mobbin.com') !== -1) return id;
        }
      }
    }
    let screenSignals = 0;
    const objKeys = Object.keys(obj);
    for (const k of objKeys) {
      if (SCREEN_FIELD_HINTS.indexOf(k) !== -1) screenSignals++;
    }
    const notScreen = objKeys.indexOf('slug') !== -1 || objKeys.indexOf('iconUrl') !== -1 ||
                      objKeys.indexOf('email') !== -1 || objKeys.indexOf('avatarUrl') !== -1 ||
                      objKeys.indexOf('firstScreen') !== -1 || objKeys.indexOf('screens') !== -1;
    if (!notScreen && screenSignals >= 3) return id;
    return null;
  }

  function findScreenUuidFromElement(el) {
    let fiber = readFiberAt(el);
    if (!fiber) return null;
    for (let depth = 0; fiber && depth < 60; depth++, fiber = fiber.return) {
      try {
        const props = fiber.memoizedProps;
        if (!props || typeof props !== 'object') continue;
        if (props.screen && typeof props.screen === 'object' && !Array.isArray(props.screen)) {
          const id = isUuidNonWatermark(props.screen.id) || isUuidNonWatermark(props.screen.uuid) || isUuidNonWatermark(props.screen.screenId);
          if (id) return id;
        }
        for (const k of ['href','to','as','url','pathname']) {
          const v = props[k];
          if (typeof v === 'string' && v.includes('/screens/')) {
            const u = isUuidNonWatermark(v); if (u) return u;
          }
        }
        for (const k of Object.keys(props)) {
          if (k === 'screen') continue;
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

  function extractImageAssetUuid(cardEl){
    try{
      let img = null;
      if(cardEl && cardEl.tagName === 'IMG' && cardEl.src && cardEl.src.indexOf('bytescale.mobbin.com') !== -1){
        img = cardEl;
      } else if(cardEl && cardEl.querySelector){
        img = cardEl.querySelector('img[src*="bytescale.mobbin.com"]');
      }
      if(!img || !img.src) return null;
      const path = img.src.split('?')[0];
      const all = path.match(new RegExp(UUID_RE.source, 'gi')) || [];
      for(const m of all){ if(m.toLowerCase() !== WATERMARK_ID.toLowerCase()) return m; }
    }catch(e){}
    return null;
  }

  function dispatchNavigate(detail){
    try{ document.dispatchEvent(new CustomEvent('MobbinUnblur_Navigate', { detail: detail })); }
    catch(e){}
  }

  function onCapturedClick(ev){
    try{
      if(ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      const t = ev.target;
      if(!t || !t.tagName) return;
      if(t.tagName !== 'IMG') return;
      if(!t.src || t.src.indexOf('bytescale.mobbin.com') === -1) return;

      const a = t.closest && t.closest('a[href]');
      let fallbackAnchorHref = null;
      if(a){
        const h = a.getAttribute('href') || '';
        if(h && h !== '#'){
          if(/(^\/|\/)screens\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(h)){
            return; // real /screens/UUID anchor — browser handles it natively
          }
          fallbackAnchorHref = h;
        }
      }

      // ── Primary: resolve screen UUID from the React fiber RIGHT NOW ──────────
      // Walk the clicked img AND its DOM ancestors (up to 10 levels) because
      // the ScreenCell fiber lives on a parent div, not on the <img> itself.
      // This works for ALL images — 1st, 5th, 50th — no screenMap needed.
      let screenUuid = null;
      try {
        screenUuid = findScreenUuidFromElement(t);
        if (!screenUuid) {
          let cur = t.parentElement;
          for (let d = 0; cur && d < 10 && !screenUuid; d++, cur = cur.parentElement) {
            screenUuid = findScreenUuidFromElement(cur);
          }
        }
      } catch(_) {}

      if (screenUuid) {
        ev.preventDefault();
        ev.stopPropagation();
        try { console.log(LOG, 'click: fiber navigate → /screens/' + screenUuid); } catch(_) {}
        navigate('/screens/' + screenUuid);
        return;
      }

      // ── Fallback: async dispatch with imageAssetUuid → screenMap lookup ────
      const imageAssetUuid = extractImageAssetUuid(t);
      if(!imageAssetUuid) return;
      ev.preventDefault();
      ev.stopPropagation();
      const detail = { imageAssetUuid };
      if(fallbackAnchorHref) detail.fallbackAnchorHref = fallbackAnchorHref;
      try { console.log(LOG, 'click: async dispatch', detail); } catch(_) {}
      dispatchNavigate(detail);
    }catch(e){}
  }

  function navigate(target) {
    if (!target) return;
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
    setTimeout(function() {
      try {
        const hasModal = document.querySelector('[role="dialog"], [class*="ScreenModal"], [class*="screen-modal"], [class*="ScreenDetail"]');
        if (!hasModal && (window.location.pathname || '').includes(target)) {
          try { history.back(); } catch(_) {}
        }
      } catch(_) {}
    }, 600);
  }

  document.addEventListener('MobbinUnblur_Navigate', function(ev) {
    try {
      const detail = (ev && ev.detail) || {};
      let target = detail.target;
      if (!target && detail.imageAssetUuid) {
        const lc = String(detail.imageAssetUuid).toLowerCase();
        let screenUuid = screenMap.get(lc);
        if (!screenUuid) {
          try {
            const imgs = document.querySelectorAll('img[src*="bytescale.mobbin.com"]');
            for (let i = 0; i < imgs.length; i++) {
              const path = (imgs[i].src || '').split('?')[0].toLowerCase();
              if (path.indexOf(lc) === -1) continue;
              screenUuid = findScreenUuidFromElement(imgs[i]);
              if (screenUuid) { screenMap.set(lc, screenUuid); break; }
              harvestPropsFromFiber(readFiberAt(imgs[i]), 60);
              screenUuid = screenMap.get(lc);
              if (screenUuid) break;
              let cur = imgs[i].parentElement;
              for (let d = 0; cur && d < 6 && !screenUuid; d++, cur = cur.parentElement) {
                screenUuid = findScreenUuidFromElement(cur);
              }
              if (screenUuid) { screenMap.set(lc, screenUuid); break; }
            }
          } catch(_) {}
        }
        if (screenUuid) target = '/screens/' + screenUuid;
      }
      if (target) {
        navigate(target);
      } else if (detail.fallbackAnchorHref) {
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

  try { document.addEventListener('click', onCapturedClick, true); } catch(_) {}

  try { console.debug(LOG, 'v7.0 loaded — fiber+UUID strategy active'); } catch(_) {}
})();
