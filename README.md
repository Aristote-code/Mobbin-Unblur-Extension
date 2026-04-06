# Mobbin Unblur Extension

A Chrome extension that unblurs screenshots on [Mobbin](https://mobbin.com) and removes upgrade overlays for a clean browsing experience.

## Features

- Unblurs all Mobbin screenshots in full resolution (3840px)
- Removes the white overlay on image cards
- Hides the "Access all screens" upgrade banner
- Enables image drag, selection, and right-click saving
- Works on all Chromium-based browsers (Chrome, Edge, Arc, Brave, Atlas, etc.)

## Installation

### Step 1 — Download the extension

**Option A: Clone with Git**

```bash
git clone https://github.com/Aristote-code/Mobbin-Unblur-Extension.git
```

**Option B: Download ZIP**

1. Click the green **Code** button at the top of this page
2. Click **Download ZIP**
3. Extract the ZIP file to a folder on your computer

### Step 2 — Load in your browser

1. Open your browser and go to `chrome://extensions` (or `edge://extensions`, `brave://extensions`, etc.)
2. Turn on **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the folder containing the extension files (`manifest.json`, `unblur.js`, etc.)
5. The extension icon should appear in your toolbar

### Step 3 — Use it

1. Go to [mobbin.com](https://mobbin.com) and browse any app screens
2. The extension runs automatically — images will be unblurred as they load
3. Click the extension icon in the toolbar and press **Unblur** to manually trigger a re-scan

## Troubleshooting

**Images not unblurring?**
- Click the extension icon and press the Unblur button
- Try refreshing the page

**Seeing errors in the extensions page?**
- Close all Mobbin tabs
- Go to the extensions page and click **Clear all** on the errors panel
- Click the reload icon on the extension
- Open a fresh Mobbin tab

**Extension not loading?**
- Make sure **Developer mode** is enabled
- Make sure you selected the correct folder (the one with `manifest.json` in it)

## Files

| File | Description |
|------|-------------|
| `manifest.json` | Extension configuration |
| `unblur.js` | Main content script — rewrites image URLs and hides overlays |
| `unblur.css` | CSS overrides to remove blurs, overlays, and upgrade banners |
| `popup.html` | Extension popup UI |
| `popup.js` | Popup button logic |
| `icon.png` | Extension icon |

## License

MIT
