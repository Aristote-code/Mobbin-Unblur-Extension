(() => {
  "use strict";

  const refresh = document.querySelector("#refresh");
  const status = document.querySelector("#status");
  let activeTab = null;

  function setSupported(supported) {
    refresh.disabled = !supported;
    status.textContent = supported
      ? "Working on this Mobbin tab"
      : "Open a Mobbin tab to use ScreenClear";
  }

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    activeTab = tabs[0] || null;
    if (!activeTab?.id) return setSupported(false);
    chrome.tabs.sendMessage(activeTab.id, { type: "SCREENCLEAR_STATUS" }, response => {
      setSupported(!chrome.runtime.lastError && Boolean(response?.active));
    });
  });

  refresh.addEventListener("click", () => {
    if (!activeTab?.id) return;
    refresh.disabled = true;
    status.textContent = "Refreshing previews…";
    chrome.tabs.sendMessage(activeTab.id, { type: "SCREENCLEAR_REFRESH" }, response => {
      setSupported(!chrome.runtime.lastError && Boolean(response?.active));
    });
  });
})();
