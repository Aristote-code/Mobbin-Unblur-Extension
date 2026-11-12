# ScreenClear for Mobbin

ScreenClear 1.1.1 improves eligible screenshot previews on Mobbin. This replaces the repository's older Mobbin Unblur PRO / Glass Edition implementation.

## Install

1. Clone this repository, or select **Code → Download ZIP** and extract it.
2. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
3. Enable **Developer mode** and select **Load unpacked**.
4. Select the folder containing `manifest.json`.
5. Open or refresh a signed-in Mobbin tab.

```bash
git clone https://github.com/Aristote-code/Mobbin-Unblur-Extension.git
```

The extension runs automatically. Its popup reports whether the current Mobbin tab is supported and provides a refresh button.

## What it does

- Resolves eligible tiny encrypted screenshot previews using the public CDN's original-file lookup.
- Keeps the existing image if lookup or image validation fails.
- Prioritizes visible images and nearby rows while scrolling.
- Limits concurrent lookups and downloads and caches resolved paths.
- Handles responsive image sources and recycled list items.
- Clears screenshot blur filters and matching empty overlays.
- Hides the matching “Access all screens” upgrade banner.

The script preserves opaque `enc` parameters during discovery, validates discovered screenshot paths, and avoids rewriting app logos. Full images are requested as WebP at up to 1920px wide. Availability depends on Mobbin's current CDN behavior.

## Updating from the older extension

Pull the latest repository, select **Reload** on the extensions page, then refresh your Mobbin tabs. When installing ScreenClear from a separate folder, disable the older extension to avoid running both implementations together.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Manifest V3 configuration and Mobbin content-script matches |
| `content.js` | Image discovery, download scheduling, and page adjustments |
| `popup.html`, `popup.css`, `popup.js` | Status and manual refresh controls |
| `icons/` | Toolbar and extension icons |

## Verification

```bash
node --check content.js
node --check popup.js
python3 -m json.tool manifest.json
```

GitHub Actions also checks that the manifest's referenced scripts, popup, and icons exist.

Unofficial and not affiliated with Mobbin. This repository previously identified its license as MIT.
