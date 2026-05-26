// popup.js — Mobbin Unblur PRO
// Reads enabled state from chrome.storage.local (key: "unblurEnabled")
// Sends MobbinUnblur_Enable / MobbinUnblur_Disable to the active tab's content script

const btn       = document.getElementById('toggleBtn');
const icon      = document.getElementById('toggleIcon');
const state     = document.getElementById('toggleState');
const hint      = document.getElementById('toggleHint');
const label     = document.getElementById('statusLabel');
const card      = document.getElementById('toggleCard');

let enabled = false;

function applyUI(on) {
  enabled = on;
  btn.classList.toggle('on', on);
  card.classList.toggle('active', on);
  label.classList.toggle('active', on);
  state.classList.toggle('on', on);
  hint.classList.toggle('active', on);
  icon.textContent  = on ? '🔓' : '🔒';
  state.textContent = on ? 'ON'  : 'OFF';
  label.textContent = on ? 'UNBLUR ACTIVE' : 'UNBLUR OFF';
  hint.innerHTML    = on
    ? 'Unblurring all screens on<br>this Mobbin page…'
    : 'Click to unblur all screens<br>on this Mobbin page';
}

// Read current state for the active tab
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (!tabs[0]) return;
  const tabId = tabs[0].id;
  chrome.storage.local.get(['unblurEnabled_' + tabId], (res) => {
    applyUI(!!res['unblurEnabled_' + tabId]);
  });
});

btn.addEventListener('click', () => {
  const next = !enabled;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    const tabId = tabs[0].id;

    // Persist state for this tab
    chrome.storage.local.set({ ['unblurEnabled_' + tabId]: next });

    // Update badge
    chrome.action.setBadgeText({ text: next ? 'ON' : '', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#7c3aed', tabId });

    // Tell content script to enable/disable
    const eventName = next ? 'MobbinUnblur_Enable' : 'MobbinUnblur_Disable';
    chrome.scripting.executeScript({
      target: { tabId },
      func: (evtName) => {
        document.dispatchEvent(new CustomEvent(evtName));
      },
      args: [eventName]
    });

    applyUI(next);
  });
});
