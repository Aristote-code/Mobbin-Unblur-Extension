// Mobbin Unblur PRO v6.5.2
(function(){
  'use strict';

  const WATERMARK_ID = '94cdc612-6b0c-4ad7-b99c-500f420f8b98';

  function unifiedUrl(url){
    if(!url || !url.includes('bytescale.mobbin.com')) return url;
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
      if(processed.has(img) || !img.src) return;
      const orig = img.src;
      processed.add(img);
      const nu = unifiedUrl(orig);
      if(nu !== orig){ originalUrls.set(img, orig); img.src = nu; }
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
  }

  initialize();
})();
