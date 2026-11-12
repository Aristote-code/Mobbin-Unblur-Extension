(() => {
  "use strict";

  // Optional: paste the DECODED value of Mobbin's existing `image` parameter
  // here. Leave empty to preserve each image's current watermark parameter.
  // URLSearchParams encodes it; do not paste an already URL-encoded value.
  const WATERMARK = "";
  const INTERVAL_MS = 2000;
  const DEBOUNCE_MS = 16;
  const MAX_LOOKUPS = 12;
  const MAX_DOWNLOADS = 8;
  const MAX_BACKGROUND_DOWNLOADS = 4;
  const SELECTOR = 'img[src*="bytescale.mobbin.com"]';
  const FILTER_PROPERTIES = [
    "filter",
    "-webkit-filter",
    "backdrop-filter",
    "-webkit-backdrop-filter"
  ];
  const observerOptions = {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src", "srcset", "sizes", "style", "class"]
  };
  let pending = null;
  const knownOverlays = new WeakSet();
  const resolvingImages = new WeakMap();
  const resolutionCache = new Map();
  const resolutionQueue = [];
  const downloadQueue = [];
  const activeDownloads = new Set();
  let activeResolutions = 0;

  function applyImageSource(img, target) {
    // Responsive candidates otherwise take precedence over img.src.
    img.removeAttribute("srcset");
    img.removeAttribute("sizes");
    const picture = img.closest("picture");
    if (picture) {
      for (const source of picture.querySelectorAll("source[srcset]")) {
        if (source.getAttribute("srcset") !== target) source.setAttribute("srcset", target);
        source.removeAttribute("sizes");
      }
    }
    if (img.getAttribute("src") !== target) img.setAttribute("src", target);
  }

  function viewportPriority(img) {
    if (!img.isConnected) return Number.POSITIVE_INFINITY;
    const rect = img.getBoundingClientRect();
    const height = window.innerHeight;
    if (rect.bottom > 0 && rect.top < height) return 0;
    // Fetch the next rows before older, offscreen rows when scrolling down.
    return rect.top >= height ? rect.top - height + 1 : height - rect.bottom + 1;
  }

  function jobPriority(job) {
    let priority = Number.POSITIVE_INFINITY;
    for (const img of job.images) {
      if (imageURL(img.getAttribute("src"))?.href === job.url.href) {
        priority = Math.min(priority, viewportPriority(img));
      }
    }
    return priority;
  }

  function finishJob(job, target) {
    job.state = target ? "ready" : "failed";
    job.resolve(target);
  }

  function startDownload(job) {
    const probe = new Image();
    job.state = "downloading";
    job.probe = probe;
    activeDownloads.add(job);
    const finish = valid => {
      if (job.probe !== probe) return;
      clearTimeout(job.timeout);
      probe.onload = probe.onerror = null;
      job.probe = null;
      activeDownloads.delete(job);
      finishJob(job, valid ? job.target : null);
      drainDownloads();
    };
    job.timeout = setTimeout(() => finish(false), 15000);
    probe.crossOrigin = "anonymous";
    probe.referrerPolicy = "no-referrer";
    probe.fetchPriority = jobPriority(job) === 0 ? "high" : "low";
    probe.onload = () => finish(probe.naturalWidth >= 256);
    probe.onerror = () => finish(false);
    probe.src = job.target;
  }

  function suspendDownload(job) {
    // Keep the discovered path and promise: this is not a failed lookup.
    const probe = job.probe;
    job.probe = null;
    clearTimeout(job.timeout);
    probe.onload = probe.onerror = null;
    probe.removeAttribute("src");
    activeDownloads.delete(job);
    job.state = "download-queued";
    downloadQueue.push(job);
  }

  function drainDownloads() {
    for (const job of [...activeDownloads]) {
      const priority = jobPriority(job);
      if (priority > window.innerHeight * 2) suspendDownload(job);
      else job.probe.fetchPriority = priority === 0 ? "high" : "low";
    }
    downloadQueue.sort((a, b) => jobPriority(a) - jobPriority(b));
    while (downloadQueue.length) {
      const job = downloadQueue[0];
      const priority = jobPriority(job);
      // Preload nearby mounted cards, not a large backlog far from the viewport.
      if (priority > window.innerHeight * 2) break;
      if (activeDownloads.size >= MAX_DOWNLOADS) {
        if (priority !== 0) break;
        const offscreen = [...activeDownloads]
          .filter(active => jobPriority(active) > 0)
          .sort((a, b) => jobPriority(b) - jobPriority(a))[0];
        if (!offscreen) break;
        suspendDownload(offscreen);
      }
      const backgroundCount = [...activeDownloads].filter(active => jobPriority(active) > 0).length;
      if (priority > 0 && backgroundCount >= MAX_BACKGROUND_DOWNLOADS) break;
      downloadQueue.shift();
      startDownload(job);
    }
  }

  async function discoverOriginal(originalURL) {
    // Live-tested: /raw/ returns a JSON error naming the exact original file.
    // The corresponding public /image/<file> URL can serve the sharp original.
    // Never guess IDs, alter enc, or discard the current preview on failure.
    const rawURL = new URL(originalURL.href);
    if (!/^\/[^/]+\/image\//.test(rawURL.pathname)) return null;
    rawURL.pathname = rawURL.pathname.replace(/^(\/[^/]+)\/image\//, "$1/raw/");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(rawURL.href, {
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal
      });
      if (!response.headers.get("content-type")?.includes("json")) {
        await response.body?.cancel();
        return null;
      }
      const payload = await response.json();
      const path = payload?.error?.details?.filePathNotFound;
      if (
        payload?.error?.code !== "file_not_found" ||
        typeof path !== "string" ||
        !/^\/mobbin\.com\/prod\/content\/app_screens\/[0-9a-f-]+\.(?:png|jpe?g|webp)$/i.test(path)
      ) return null;
      const target = new URL(originalURL.href);
      const account = target.pathname.split("/")[1];
      target.pathname = `/${account}/image${path}`;
      target.search = new URLSearchParams({ f: "webp", w: "1920", q: "85", fit: "shrink-cover" }).toString();
      target.hash = "";
      return target.href;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  function drainResolutionQueue() {
    resolutionQueue.sort((a, b) => jobPriority(a) - jobPriority(b));
    while (activeResolutions < MAX_LOOKUPS && resolutionQueue.length) {
      if (!Number.isFinite(jobPriority(resolutionQueue[0]))) break;
      const job = resolutionQueue.shift();
      job.state = "looking-up";
      activeResolutions++;
      discoverOriginal(job.url).then(target => {
        if (!target) return finishJob(job, null);
        // Release the small lookup slot before waiting for the image download.
        job.target = target;
        job.state = "download-queued";
        downloadQueue.push(job);
        drainDownloads();
      }, () => finishJob(job, null)).finally(() => {
        activeResolutions--;
        drainResolutionQueue();
      });
    }
  }

  function resolveTinyPreview(img, originalURL) {
    if (!originalURL.searchParams.has("enc")) return;
    const widths = [...(img.getAttribute("srcset") || "").matchAll(/\s(\d+)w\s*(?:,|$)/g)]
      .map(match => Number(match[1]));
    // Do not replace normal responsive images or app logos.
    if (!widths.length || Math.max(...widths) > 32) return;
    const key = originalURL.href;
    if (!resolutionCache.has(key)) {
      // Resolve paths ahead of image preloads without walking an entire long list.
      if (viewportPriority(img) > window.innerHeight * 4) return;
      if (resolutionCache.size >= 512) {
        const entries = [...resolutionCache.values()];
        const evicted = entries.find(entry =>
          ["lookup-queued", "download-queued"].includes(entry.state) && !Number.isFinite(jobPriority(entry))
        ) || entries.find(entry => entry.state === "ready" || entry.state === "failed")
          || entries.find(entry => ["lookup-queued", "download-queued"].includes(entry.state));
        if (!evicted) return;
        resolutionCache.delete(evicted.url.href);
        for (const queue of [resolutionQueue, downloadQueue]) {
          const index = queue.indexOf(evicted);
          if (index !== -1) queue.splice(index, 1);
        }
        finishJob(evicted, null);
      }
      const job = { url: originalURL, images: new Set(), state: "lookup-queued" };
      job.promise = new Promise(resolve => { job.resolve = resolve; });
      resolutionCache.set(key, job);
      resolutionQueue.push(job);
    }
    const job = resolutionCache.get(key);
    const previous = resolvingImages.get(img);
    if (previous === job) return;
    // Virtualized lists can recycle a node while its older image is still loading.
    // Let the new screenshot start now; do not wait for that obsolete request.
    previous?.images.delete(img);
    job.images.add(img);
    resolvingImages.set(img, job);
    job.promise.then(target => {
      // React may have recycled this node for another screenshot while loading.
      if (target && img.isConnected && imageURL(img.getAttribute("src"))?.href === key) {
        applyImageSource(img, target);
      }
    }).finally(() => {
      job.images.delete(img);
      if (resolvingImages.get(img) === job) resolvingImages.delete(img);
    });
  }

  function imageURL(raw) {
    let url;
    try {
      url = new URL(raw, document.baseURI);
    } catch {
      return null;
    }
    // A substring match alone would also accept unrelated hosts/paths.
    if (url.protocol !== "https:" || url.hostname !== "bytescale.mobbin.com") {
      return null;
    }
    return url;
  }

  function rewrittenURL(originalURL) {
    const url = new URL(originalURL.href);
    // Observed on the signed-in site: distinct screenshots share /file.webp
    // and differ through an opaque `enc` query value. Dropping it discards
    // their distinguishing information. This rewrite only supports plain URLs.
    if (url.searchParams.has("enc")) return null;
    // Logos are not screenshot previews. Adding watermark transforms to them
    // caused HTTP 400 errors in the live Chrome session.
    if (url.pathname.includes("/app_logos/")) return null;
    const watermark = WATERMARK || url.searchParams.get("image") || "";
    // The requested transform requires an actual watermark asset. Never send
    // image= with an empty value: this was rejected by the CDN in live testing.
    if (!watermark.trim()) return null;
    url.search = "";
    url.hash = "";
    url.search = new URLSearchParams([
      ["f", "webp"],
      ["w", "1920"],
      ["q", "85"],
      ["fit", "shrink-cover"],
      ["extend-bottom", "120"],
      ["image", watermark],
      ["gravity", "bottom"],
      ["v", "1.0"]
    ]).toString();
    return url.href;
  }

  function clearFilters(element) {
    for (const property of FILTER_PROPERTIES) {
      if (
        element.style.getPropertyValue(property) !== "none" ||
        element.style.getPropertyPriority(property) !== "important"
      ) {
        element.style.setProperty(property, "none", "important");
      }
    }
  }

  function clearSiblingOverlays(img) {
    // Live Mobbin cards use an empty backdrop-blurred DIV beside the image.
    const card = img.closest("picture")?.parentElement || img.parentElement;
    if (!card) return;
    for (const sibling of card.children) {
      if (
        sibling.tagName !== "DIV" ||
        sibling.childElementCount !== 0 ||
        sibling.textContent.trim() !== ""
      ) continue;
      if (!knownOverlays.has(sibling)) {
        const style = getComputedStyle(sibling);
        if (
          !style.filter.includes("blur(") &&
          !style.getPropertyValue("backdrop-filter").includes("blur(") &&
          !style.getPropertyValue("-webkit-backdrop-filter").includes("blur(")
        ) continue;
        knownOverlays.add(sibling);
      }
      clearFilters(sibling);
      // These empty overlays also tint the screenshot white.
      if (
        sibling.style.getPropertyValue("background-color") !== "transparent" ||
        sibling.style.getPropertyPriority("background-color") !== "important"
      ) sibling.style.setProperty("background-color", "transparent", "important");
    }
  }

  function updateImage(img) {
    const originalURL = imageURL(img.getAttribute("src"));
    if (!originalURL || originalURL.pathname.includes("/app_logos/")) return;
    const target = rewrittenURL(originalURL);

    // Preserve opaque responsive URLs unless the tiny-preview fallback succeeds.
    if (target) {
      applyImageSource(img, target);
    } else {
      resolveTinyPreview(img, originalURL);
    }

    clearFilters(img);
    clearSiblingOverlays(img);
    // A filter on a parent affects the whole rendered subtree; overriding
    // just the img cannot undo it. Stop before document-wide body/html.
    for (
      let ancestor = img.parentElement;
      ancestor && ancestor !== document.body && ancestor !== document.documentElement;
      ancestor = ancestor.parentElement
    ) {
      if (ancestor.tagName === "DIV") clearFilters(ancestor);
    }
  }

  function hideUpgradeBanners() {
    // The large sticky promotion is an ASIDE, separate from screenshot cards.
    // Match its heading and CTA so unrelated sidebars stay visible.
    for (const banner of document.querySelectorAll("aside")) {
      const hasHeading = [...banner.querySelectorAll("h1,h2,h3,[role='heading']")]
        .some(heading => /^Access all\s+[\d,.\s]+\s+screens[.!]?$/i.test(
          heading.textContent.trim()
        ));
      if (!hasHeading) continue;
      const hasCTA = [...banner.querySelectorAll("button,a")]
        .some(control => /^Get Pro$/i.test(control.textContent.trim()));
      if (!hasCTA || banner.querySelector('img[alt$=" screen"]')) continue;
      if (
        banner.style.getPropertyValue("display") !== "none" ||
        banner.style.getPropertyPriority("display") !== "important"
      ) banner.style.setProperty("display", "none", "important");
    }
  }

  function scan() {
    if (pending !== null) {
      clearTimeout(pending);
      pending = null;
    }
    // Our own attribute edits must not enqueue another observer pass.
    // This is synchronous: React cannot interleave a render inside the scan.
    observer.disconnect();
    try {
      hideUpgradeBanners();
      // Start visible/nearby images first, not just the first DOM nodes.
      const images = [...document.querySelectorAll(SELECTOR)]
        .map(img => ({ img, priority: viewportPriority(img) }))
        .sort((a, b) => a.priority - b.priority);
      for (const { img } of images) updateImage(img);
      drainResolutionQueue();
      drainDownloads();
    } finally {
      observer.observe(document.documentElement, observerOptions);
    }
  }

  function scheduleScan() {
    // Coalesce mutation bursts, with a fixed deadline under continuous updates.
    if (pending === null) pending = setTimeout(scan, DEBOUNCE_MS);
  }

  const observer = new MutationObserver(scheduleScan);

  function start() {
    scan();
    setInterval(scan, INTERVAL_MS);
    window.addEventListener("pageshow", scan);
    // Wake immediately for scrolling, including when React reuses existing nodes.
    document.addEventListener("scroll", scheduleScan, { passive: true, capture: true });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scan();
    });
  }

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "SCREENCLEAR_STATUS") {
        sendResponse({ active: true });
        return false;
      }
      if (message?.type === "SCREENCLEAR_REFRESH") {
        scan();
        sendResponse({ active: true });
        return false;
      }
      return false;
    });
  }
  start();
})();
