// Mobbin Unblur PRO v7.0.0
(function(){
  'use strict';

  const WATERMARK_ID = '94cdc612-6b0c-4ad7-b99c-500f420f8b98';

  function unifiedUrl(url){
    if(!url || !url.includes('bytescale.mobbin.com')) return url;
    // Mobbin uses two URL formats:
    //   1. Path-based: .../prod/content/.../<asset-uuid>... — the path identifies the
    //      asset, query is just transform params. Safe to rewrite the query.
    //   2. Encrypted: .../prod/file.webp?enc=<token> — the file path is opaque and
    //      ENCODED IN THE QUERY. Stripping the query 404s the image. Leave alone.
    if(url.indexOf('file.webp') !== -1 && url.indexOf('enc=') !== -1) return url;
    const base = url.split('?')[0];
    const target = `f=webp&w=3840&q=85&fit=shrink-cover&extend-bottom=120&image=%2Fmobbin.com%2Fprod%2Fwatermark%2F1.0%2F${WATERMARK_ID}%2F3840&gravity=bottom&v=1.0`;
    return `${base}?${target}`;
  }

  function protectSetters(){
    try{
      const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        get: d.get,
        set: function(value){
          try{ d.set.call(this, value); }catch(e){}
        }
      });
    }catch(e){}
  }

  const originalUrls = new WeakMap();
  const processed = new WeakSet();

  function processImage(img){
    try{
      if(!img.src) return;
      const orig = img.src;
      if(orig.indexOf('bytescale.mobbin.com') === -1) return;
      // Don't skip encrypted images on first pass — inject.js (MAIN world) may later
      // rewrite their src to a path-based URL via assetUrlMap, and we need to pick that up.
      const isEncrypted = orig.indexOf('file.webp') !== -1 && orig.indexOf('enc=') !== -1;
      if(processed.has(img) && !isEncrypted) return;
      // Always strip srcset/sizes on bytescale images — Mobbin's srcset entries are
      // malformed (multiple 'w' descriptors, mix of 'x' and 'w') which floods the
      // console with parse errors, and we'd rather the browser use only our src anyway.
      try { if (img.hasAttribute('srcset')) img.removeAttribute('srcset'); } catch(_){}
      try { if (img.hasAttribute('sizes')) img.removeAttribute('sizes'); } catch(_){}
      const nu = unifiedUrl(orig);
      if(nu !== orig){
        // Only mark as fully processed when we successfully rewrote the URL
        processed.add(img);
        originalUrls.set(img, orig);
        img.src = nu;
      } else if(!isEncrypted) {
        // Path-based URL that unifiedUrl didn't change (already has our params) — mark done.
        processed.add(img);
      }
      // If encrypted and unifiedUrl returned unchanged, leave NOT in processed
      // so that when inject.js rewrites img.src we can process the new path URL.
    }catch(e){}
  }

  function processAll(){
    try{ document.querySelectorAll('img[src*="bytescale.mobbin.com"]').forEach(processImage); }catch(e){}
  }

  function hideUpgradeOverlay(){
    try{
      const candidates = document.querySelectorAll(
        'aside, body > div, body > section, body > aside, [style*="position: fixed"], [style*="position:fixed"]'
      );
      for(const el of candidates){
        const text = el.innerText || '';
        if(
          (text.includes('Access all') && text.includes('screens')) ||
          (text.includes('unlimited access') && text.includes('month')) ||
          (text.includes('Supporting over') && text.includes('designers'))
        ){
          el.style.setProperty('display', 'none', 'important');
        }
      }
    }catch(e){}
  }

  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const LOG = '[MobbinUnblur]';
  let diagRan = false;

  function findCardRoot(el){
    if(!el || el.nodeType !== 1) return null;
    let cur = el;
    for(let i=0; i<8 && cur; i++){
      try{
        if((cur.matches && cur.matches('img[src*="bytescale.mobbin.com"], a[href*="/screens/"]')) ||
           (cur.querySelector && cur.querySelector('img[src*="bytescale.mobbin.com"], a[href*="/screens/"]'))){
          return cur;
        }
      }catch(e){}
      cur = cur.parentElement;
    }
    return null;
  }

  function isScreenUuid(value){
    if(typeof value !== 'string') return null;
    const m = value.match(UUID_RE);
    if(!m) return null;
    if(m[0].toLowerCase() === WATERMARK_ID.toLowerCase()) return null;
    return m[0];
  }

  // Walk the React fiber tree from a DOM node, looking for props that identify a
  // screen UUID. Only accepts UUIDs from sources we trust (anchor-like hrefs that
  // contain /screens/, props explicitly named screenId/screenUuid, objects with
  // __typename === 'Screen', etc.). Avoids generic `id`/`uuid` props which on
  // Mobbin tend to be the image asset UUID (a 404 trap).
  function findScreenUuidViaReact(el){
    if(!el || typeof el !== 'object') return null;
    try{
      const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if(!fiberKey) return null;
      let fiber = el[fiberKey];
      for(let depth=0; fiber && depth<40; depth++, fiber = fiber.return){
        try{
          const props = fiber.memoizedProps;
          if(!props || typeof props !== 'object') continue;
          for(const k of ['href','to','as','url','pathname']){
            const v = props[k];
            if(typeof v === 'string' && v.includes('/screens/')){
              const u = isScreenUuid(v); if(u) return u;
            }
          }
          for(const k of ['screenId','screenUuid','screenID','screen_id']){
            const u = isScreenUuid(props[k]); if(u) return u;
          }
          for(const k of Object.keys(props)){
            const v = props[k];
            if(!v || typeof v !== 'object') continue;
            if(v.__typename === 'Screen' || /screen/i.test(k)){
              for(const sk of ['id','uuid','screenId','screenUuid']){
                const u = isScreenUuid(v[sk]); if(u) return u;
              }
            }
          }
        }catch(e){}
      }
    }catch(e){}
    return null;
  }

  function extractScreenUuid(cardEl){
    if(!cardEl) return null;
    try{
      // 1. Working anchor: most reliable when present (covers cards 1–3).
      const a = (cardEl.matches && cardEl.matches('a[href*="/screens/"]')) ? cardEl
              : (cardEl.querySelector && cardEl.querySelector('a[href*="/screens/"]'));
      if(a){ const u = isScreenUuid(a.getAttribute('href') || ''); if(u) return u; }

      // 2. Explicit screen-related data attributes on card or descendants.
      const attrs = ['data-screen-id','data-screen-uuid','data-screenid'];
      for(const at of attrs){
        let v = cardEl.getAttribute && cardEl.getAttribute(at);
        if(!v && cardEl.querySelector){ const sub = cardEl.querySelector(`[${at}]`); v = sub && sub.getAttribute(at); }
        const u = isScreenUuid(v); if(u) return u;
      }

      // 3. React fiber introspection — covers cards 4+ that don't have a working anchor.
      const u = findScreenUuidViaReact(cardEl);
      if(u) return u;

      // Intentionally NOT falling back to bytescale image URL or outerHTML regex —
      // those yield the image asset UUID, which 404s on /screens/<uuid>.
    }catch(e){}
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
    catch(e){ try{ console.warn(LOG, 'dispatch failed', e); }catch(_){} }
  }

  function onCapturedClick(ev){
    try{
      if(ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      const t = ev.target;
      if(!t || !t.tagName) return;
      // Strict: only fire on direct clicks on a bytescale image. Locked cards have
      // pointer-events:none on the wrapper and pointer-events:auto only on the <img>
      // (via unblur.css), so a click on a locked card always lands on the img itself.
      // Every other element on the page (search, buttons, nav, app cards) is something
      // other than a bytescale img — we must never touch them.
      if(t.tagName !== 'IMG') return;
      if(!t.src || t.src.indexOf('bytescale.mobbin.com') === -1) return;
      // Anchor classification:
      //   - /screens/UUID    → real screen anchor (clickable cards). Leave alone.
      //   - none             → naked locked card. Override.
      //   - everything else  → Mobbin redirects locked clicks here (app screens list, upgrade,
      //                        signin, etc). Try to override with screen modal; fall back to
      //                        the original anchor URL if we can't resolve a screen UUID.
      const a = t.closest && t.closest('a[href]');
      let fallbackAnchorHref = null;
      if(a){
        const h = a.getAttribute('href') || '';
        if(h && h !== '#' && h !== ''){
          if(/(^|\/)screens\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(h)){
            try{ console.log(LOG, 'click bypass: skipped (real screen anchor)', h); }catch(_){}
            return;
          }
          fallbackAnchorHref = h;
          try{ console.log(LOG, 'click bypass: overriding non-screen anchor', h); }catch(_){}
        }
      }

      const imageAssetUuid = extractImageAssetUuid(t);
      // Even if we can't extract an asset UUID (e.g. encrypted file.webp URLs),
      // tag the element so inject.js can fiber-walk it directly. This is the only
      // path to a screen UUID for encrypted-locked cards.
      const clickId = '__mu_' + Math.random().toString(36).slice(2, 10);
      try{ t.setAttribute('data-mobbin-click', clickId); }catch(_){}
      setTimeout(()=>{ try{ t.removeAttribute('data-mobbin-click'); }catch(_){} }, 5000);

      ev.preventDefault();
      ev.stopPropagation();
      const detail = { clickElementId: clickId };
      if(imageAssetUuid) detail.imageAssetUuid = imageAssetUuid;
      if(fallbackAnchorHref) detail.fallbackAnchorHref = fallbackAnchorHref;
      try{ console.log(LOG, 'click bypass dispatch', detail); }catch(_){}
      dispatchNavigate(detail);
    }catch(e){}
  }

  function runDiagnostics(){
    try{
      const imgs = Array.from(document.querySelectorAll('img[src*="bytescale.mobbin.com"]'));
      if(imgs.length < 5) return;
      const cards = []; const seen = new Set();
      for(const img of imgs){
        let cur = img.parentElement;
        for(let d=0; d<8 && cur; d++){
          try{
            const r = cur.getBoundingClientRect();
            if(r.width > 200 && r.height > 100 && !seen.has(cur)){ seen.add(cur); cards.push(cur); break; }
          }catch(e){}
          cur = cur.parentElement;
        }
        if(cards.length >= 6) break;
      }
      const dump = (label, el)=>{
        try{
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width/2;
          const cy = Math.max(0, Math.min(window.innerHeight-1, r.top + r.height/2));
          const top = document.elementsFromPoint(cx, cy)[0];
          const aEl = el.querySelector('a[href*="/screens/"]') || el.closest('a');
          console.groupCollapsed(`${LOG} diag ${label}`);
          console.log('tag:', el.tagName, '| classes:', String(el.className||'').slice(0,200));
          console.log('outerHTML[0..240]:', String(el.outerHTML||'').slice(0,240));
          console.log('closest a href:', aEl && aEl.getAttribute && aEl.getAttribute('href'));
          console.log('a pointer-events:', aEl ? getComputedStyle(aEl).pointerEvents : '(no anchor)');
          console.log('card pointer-events:', getComputedStyle(el).pointerEvents);
          console.log('topmost element at center:', top && top.tagName, '| classes:', String((top && top.className)||'').slice(0,200));
          // Bytescale image URL (image asset UUID — NOT a valid screen route UUID, just for debug)
          const bImg = el.querySelector && el.querySelector('img[src*="bytescale.mobbin.com"]');
          console.log('bytescale image src[0..200]:', bImg ? String(bImg.src||'').slice(0,200) : '(none)');
          // React fiber intro
          let fiberKey = null;
          try{ fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')); }catch(_){}
          console.log('react fiber key found:', !!fiberKey);
          console.log('react-derived screen uuid:', findScreenUuidViaReact(el));
          if(fiberKey){
            try{
              let fiber = el[fiberKey]; const propSamples = [];
              for(let d=0; fiber && d<8; d++, fiber = fiber.return){
                const p = fiber.memoizedProps;
                if(p && typeof p === 'object'){
                  propSamples.push({ depth:d, keys:Object.keys(p).slice(0,12), href:p.href, to:p.to, screenId:p.screenId });
                }
              }
              console.log('fiber prop samples (depth 0..7):', propSamples);
            }catch(_){}
          }
          console.log('extracted uuid:', extractScreenUuid(el));
          console.groupEnd();
        }catch(e){ try{ console.warn(LOG, 'diag dump failed for', label, e); }catch(_){} }
      };
      if(cards[0]) dump('card0 (expected clickable)', cards[0]);
      if(cards[4]) dump('card4 (expected locked)', cards[4]);
      if(cards[5]) dump('card5 (expected locked)', cards[5]);
      console.log(`${LOG} diagnostic complete. Cards inspected: ${cards.length}`);
    }catch(e){ try{ console.warn(LOG, 'diagnostics failed', e); }catch(_){} }
  }

  function initialize(){
    try{ protectSetters(); }catch(e){}

    const run = ()=>{
      try{ processAll(); }catch(e){}
      try{ hideUpgradeOverlay(); }catch(e){}
    };

    if(document.body){ run(); } else { document.addEventListener('DOMContentLoaded', run); }

    try{
      const io = new IntersectionObserver((entries)=>{ entries.forEach(e=>{ try{ if(e.isIntersecting && e.target.tagName==='IMG') processImage(e.target); }catch(e2){} }); }, {rootMargin:'60px', threshold:.01});
      document.querySelectorAll('img[src*="bytescale.mobbin.com"]').forEach(n=>{ try{ io.observe(n); }catch(e){} });
    }catch(e){}

    let t; window.addEventListener('scroll', ()=>{ clearTimeout(t); t=setTimeout(run, 300); }, {passive:true});

    try{
      new MutationObserver((muts)=>{
        try{ hideUpgradeOverlay(); }catch(e){}
        muts.forEach(m=>{ m.addedNodes.forEach(node=>{ try{ if(node.nodeType===1){ if(node.tagName==='IMG' && node.src?.includes('bytescale.mobbin.com')) processImage(node); node.querySelectorAll?.('img[src*="bytescale.mobbin.com"]').forEach(processImage); } }catch(e){} }); });
      }).observe(document.body || document.documentElement, {childList:true, subtree:true});
    }catch(e){}

    setInterval(run, 700);
    document.addEventListener('MobbinUnblur_AutoRun', run);

    try{ document.addEventListener('click', onCapturedClick, true); }catch(e){}

    try{
      const diagInterval = setInterval(()=>{
        try{
          if(diagRan){ clearInterval(diagInterval); return; }
          if(document.querySelectorAll('img[src*="bytescale.mobbin.com"]').length >= 5){
            runDiagnostics(); diagRan = true; clearInterval(diagInterval);
          }
        }catch(e){}
      }, 500);
      setTimeout(()=>{ try{ clearInterval(diagInterval); }catch(e){} }, 30000);
    }catch(e){}
  }

  initialize();
})();
