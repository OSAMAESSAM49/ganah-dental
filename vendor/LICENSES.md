# Third-party assets

All of these are stored in this folder so the app works offline, without any CDN.

| Asset | Where | License |
|---|---|---|
| IBM Plex Sans Arabic (fallback font) | `vendor/fonts/ibm-plex-sans-arabic/` | SIL Open Font License 1.1 (`OFL.txt`) |
| Lucide icons (SVG paths) | `js/core/icons.js` | ISC, Copyright (c) Lucide Contributors |

## Thmanyah font (not included on purpose)

The Thmanyah font license does not allow the font files to be hosted or made downloadable on a website. They are therefore not in this repository.

On a device where Thmanyah Sans is installed, the app uses it through CSS `local()`. Every other device shows IBM Plex Sans Arabic.

Libraries added in later phases (ExcelJS, Chart.js, fflate) will be listed here with their licenses.
