document.getElementById('unblur-mobbin').addEventListener('click', () => {
  try {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      chrome.scripting.executeScript({
        target: {tabId: tabs[0].id},
        func: () => {
          document.dispatchEvent(new CustomEvent('MobbinUnblur_AutoRun'));
        }
      }, () => {
        setTimeout(() => {
          chrome.tabs.reload(tabs[0].id);
        }, 300);
      });
    });
  } catch(e) {}
});
