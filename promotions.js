((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ScreenClearPromotions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const text = element => (element?.textContent || "").replace(/\s+/g, " ").trim();
  const isGetPro = element => /^Get Pro$/i.test(text(element) || element.getAttribute("aria-label") || "");

  function createHider(document) {
    const hidden = new Map();
    return function hidePromotions() {
      const targets = new Set();
      const controls = [...document.querySelectorAll('button,a,[role="button"]')].filter(isGetPro);
      for (const control of controls) {
        targets.add(control);
        const parent = control.parentElement;
        // Remove the dedicated wrapper's flex gap as well, without hiding the nav.
        if (parent?.tagName === "DIV" && parent.children.length === 1 && text(parent) === text(control) && !parent.hasAttribute("role")) {
          targets.add(parent);
        }
      }
      for (const banner of document.querySelectorAll("aside")) {
        if (banner.querySelector('img[alt$=" screen"],main,[role="main"]')) continue;
        if (![...banner.querySelectorAll('button,a,[role="button"]')].some(isGetPro)) continue;
        const legacy = [...banner.querySelectorAll("h1,h2,h3,[role='heading']")]
          .some(heading => /^Access all\s+[\d,.\s]+\s+screens[.!]?$/i.test(text(heading)));
        const copy = text(banner);
        const inline = /Upgrade\s+(?:for|to)\s+full\s+access\s+to\b/i.test(copy) &&
          /\bother\s+apps\s+and\s+sites\b/i.test(copy);
        if (legacy || inline) targets.add(banner);
      }
      // React sometimes reuses the same element for a different action after navigation.
      // Restore only styles this hider owns; never leave a recycled Save button hidden.
      for (const [element, previous] of hidden) {
        if (!element.isConnected) { hidden.delete(element); continue; }
        if (targets.has(element)) continue;
        if (element.style.getPropertyValue("display") === "none" && element.style.getPropertyPriority("display") === "important") {
          if (previous.value) element.style.setProperty("display", previous.value, previous.priority);
          else element.style.removeProperty("display");
        }
        hidden.delete(element);
      }
      for (const element of targets) {
        const value = element.style.getPropertyValue("display");
        const priority = element.style.getPropertyPriority("display");
        if (value === "none" && priority === "important") continue;
        hidden.set(element, { value, priority });
        element.style.setProperty("display", "none", "important");
      }
    };
  }
  return { createHider };
});
