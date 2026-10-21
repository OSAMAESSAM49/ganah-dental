# Third-party assets

All of these are stored in this folder so the app works offline, without any CDN.

| Asset | Where | License |
|---|---|---|
| IBM Plex Sans Arabic (fallback font) | `vendor/fonts/ibm-plex-sans-arabic/` | SIL Open Font License 1.1 (`OFL.txt`) |
| Lucide icons (SVG paths) | `js/core/icons.js` | ISC, Copyright (c) Lucide Contributors |
| fflate 0.8.2 (zip for backups) | `vendor/fflate/fflate.js` | MIT, Copyright (c) 2023 Arjun Barrett (`vendor/fflate/LICENSE`) |
| ExcelJS 4.4.0 (Excel export, loaded only when exporting) | `vendor/exceljs/exceljs.min.js` | MIT, Copyright (c) 2014-2019 Guyon Roche (`vendor/exceljs/LICENSE`) |

## Thmanyah font (not included on purpose)

The Thmanyah font license does not allow the font files to be hosted or made downloadable on a website. They are therefore not in this repository.

On a device where Thmanyah Sans is installed, the app uses it through CSS `local()`. Every other device shows IBM Plex Sans Arabic.

Charts are drawn by the app itself as SVG (`js/components/chart.js`), so no chart library is needed.
