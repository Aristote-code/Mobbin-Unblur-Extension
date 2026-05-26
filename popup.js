// popup.js — Mobbin Unblur PRO v7.3.1
// Uses chrome.action.getBadgeText to track state — no storage permission needed.

const btn   = document.getElementById('toggleBtn');
const icon  = document.getElementById('toggleIcon');
const state = document.getElementById('toggleState');
const hint  = document.getElementById('toggleHint');
const label = document.getElementById('statusLabel');
const card  = document.getElementById('toggleCard');

let enabled = false;
let currentTabId = null;

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

// Read current ON/OFF state from the toolbar badge (no storage needed)
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (!tabs || !tabs[0]) return;
  currentTabId = tabs[0].id;

  try {
    chrome.action.getBadgeText({ tabId: currentTabId }, (text) => {
      applyUI(text === 'ON');
    });
  } catch (_) {
    applyUI(false); // default to OFF if badge unavailable
  }
});

btn.addEventListener('click', () => {
  if (!currentTabId) return;
  const next = !enabled;

  // Update badge
  try {
    chrome.action.setBadgeText({ text: next ? 'ON' : '', tabId: currentTabId });
    chrome.action.setBadgeBackgroundColor({ color: '#7c3aed', tabId: currentTabId });
  } catch (_) {}

  // Tell the content scripts to enable or disable
  const eventName = next ? 'MobbinUnblur_Enable' : 'MobbinUnblur_Disable';
  try {
    chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: (evtName) => {
        document.dispatchEvent(new CustomEvent(evtName));
      },
      args: [eventName]
    });
  } catch (_) {}

  applyUI(next);
});
