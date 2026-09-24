# MS DEQ Air Division Dashboard

An interactive web application designed for air quality analysis, Prevention of Significant Deterioration (PSD) screening, National Ambient Air Quality Standards (NAAQS) compliance tracking, and Air Toxics evaluation.

Designed for the **Mississippi Department of Environmental Quality (MDEQ) Air Division**.

---

## Key Features

### Facility Inventory
* **Interactive Proximity Map**: Map facilities statewide, calculate distances within custom radii, and filter by permit classification (Title V Major, Synthetic Minor, Minor/Other), data source, and industry sector.
* **Federal Class I Areas Overlay**: Map national wilderness areas and parks subject to regional haze and PSD increment regulations.
* **CSV Export**: Bulk export of facilities within a radius, enriched with NEI criteria pollutant or TRI HAP data (with proper CSV escaping for Excel).

### PSD / Emissions
* **Live CAMD/CEMS Data for EGUs**: SO₂, NOₓ, and CO₂ mass fetched live from EPA CAMPD for power plants, with multi-year historical trend charts; blended with NEI values for PM, VOC, CO, and Lead.
* **PSD Significance Screener**: Compares actual and PTE emissions against the Significant Emission Rates of 40 CFR 52.21(b)(23) — including PM (25), PM10 (15), PM2.5 (10), H₂SO₄ mist (7), fluorides (3), H₂S/TRS (10).
* **Applicability Indicators**: PSD major-source check (100 tpy listed categories / 250 tpy otherwise, using actuals as a PTE floor) and a GHG Step-2 indicator against the 75,000 tpy CO₂e significance level (UARG "anyway source" framework).
* **Class I Area Proximity**: Distance screening against South-Central US mandatory Class I areas (Breton, Sipsey, Caney Creek, Upper Buffalo, Mingo, Hercules-Glades) with the ~300 km FLAG Federal Land Manager notification zone flagged.
* **Minor Source Baseline Dates**: County-by-county PSD baseline date tracker for NO₂, SO₂, PM₁₀, and PM₂.₅.
* **Stack Parameters**: Stack data for AERMOD screening from CAMD monitor plans (EGUs), else the 2023 NEI release points (Mississippi stacks, with EPA's data-quality flags), else labeled EPA RSEI industry-median estimates; supports manual CSV upload.

### Toxics
* **TRI HAPs Inventory & Trends**: Multi-year Toxics Release Inventory air releases with historical trend charts, auto-synced from EPA Envirofacts.
* **NEI 2020/2023 Toggle**: Dynamic toggle between National Emissions Inventory cycles for facility CAP and HAP data.
* **§112 HAP Major Source Screen**: NEI-based screening against the CAA §112 major-source thresholds (10 tpy single HAP / 25 tpy combined), with PTE caveats.
* **Ambient Context**: Nearest EPA AQS monitor lookup with pollutant coverage for each facility.

### NAAQS
* **Official EPA Design Values**: Ingests EPA's official annual design value reports (xlsx) directly — the authoritative source, typically months ahead of other feeds — with the ArcGIS FeatureServer as history/fallback.
* **Attainment & Trends**: CFR-compliant certified Design Values for all criteria pollutants except lead, 10+ year trend charts against the standards, and quarterly data-completeness indicators.

---

## Data Sources

1. **EPA ECHO API** — Real-time Clean Air Act (CAA) regulated facility inventories (with committed seed fallback for cold starts).
2. **EPA CAMD / CAMPD** — Apportioned annual CEMS emissions and monitor-plan stack parameters for EGUs.
3. **EPA National Emissions Inventory (NEI)** — 2020 (ArcGIS) and 2023 (locally parsed from GAFTP) point-source data for Mississippi, including 2023 release-point stack parameters from the NEI point flat file (`scripts/sync_nei_stacks.mjs`).
4. **EPA Toxics Release Inventory (TRI)** — Multi-year release summaries via Envirofacts.
5. **EPA Air Quality Design Value Reports** — Official annual xlsx reports (primary NAAQS source).
6. **EPA ArcGIS FeatureServer** — NAAQS design value history and NEI 2020 layers.
7. **EPA AQS Service** — Ambient monitor locations and the parameters each monitor measures.

---

## Tech Stack

* **Framework**: [Next.js](https://nextjs.org/) 16 (App Router; `npm run dev` uses webpack, production builds use Turbopack)
* **Frontend**: React 19, Tailwind CSS
* **Mapping**: Leaflet, [react-leaflet](https://react-leaflet.js.org/)
* **Charts**: [Recharts](https://recharts.org/)
* **Spreadsheet Parsing**: [exceljs](https://github.com/exceljs/exceljs) (EPA design value report ingestion)
* **State Management**: Consolidated React `useReducer` state machine
* **Accessibility**: WCAG 2.1 (ARIA landmarks, labels, keyboard navigation)

---

## Getting Started

### Prerequisites

* Node.js v20.9 or higher (required by Next.js 16)
* npm v10 or higher

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Cuevman81/emissions-dashboard.git
   cd emissions-dashboard
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables — create `.env.local` in the project root:
   ```bash
   # EPA AQS credentials (register at https://aqs.epa.gov/aqsweb/documents/data_api.html)
   AQS_EMAIL=your_email@example.com
   AQS_KEY=your_aqs_key

   # EPA CAMD/CAMPD API key (register at https://www.epa.gov/power-sector/cam-api-portal)
   EPA_CAMD_API_KEY=your_camd_key
   ```
   The app runs without these, but AQS monitor feeds and CAMD EGU emissions will be unavailable.

4. Run the development server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) to view it in your browser. On the first page load, the local server checks EPA for newer TRI and NEI 2023 data and syncs any it finds into `src/lib/`. The NEI facility summary zip is about 39 MB; the NEI point flat file behind the stack parameters is about 253 MB and is downloaded only when EPA posts a new one (or run `node scripts/sync_nei_stacks.mjs`). Both need `unzip`.

---

## Automated Data Freshness

A daily GitHub Action (`.github/workflows/data-freshness-check.yml`) audits the upstream EPA sources — NEI GAFTP dataset versions (facility summary and point flat file), new TRI reporting years, ECHO facility inventory drift, and new CAMD data years (only when the `EPA_CAMD_API_KEY` repository secret is set) — and opens a GitHub Issue when an update is available. It also checks that both NAAQS design value sources still answer (the app picks up new design value years at runtime), and the run fails if any check errors.

---

## Deployment on Vercel

This application is fully optimized for serverless deployment on Vercel:
* **Serverless Caching**: Automatically falls back to `/tmp` in serverless environments for API response caches, preventing read-only filesystem crashes.
* **Stateless Operation**: Pre-compiled datasets (NEI 2023 emissions and stack parameters, TRI emissions, facility seed) are packed with the build for instant load times without external database dependencies; sync endpoints are disabled serverlessly; the daily GitHub Action flags data updates, which are then synced locally, committed and redeployed.
* **Cold-Start Resilience**: The facility roster is served from a committed seed file within a bounded time budget when live EPA APIs are slow.
* **Security Headers**: `nosniff`, frame protection, referrer and permissions policies, and a Content-Security-Policy applied globally. Production builds enforce the full CSP, so a new third-party host (tile server, CDN) must be added to `CSP_PRODUCTION` in `next.config.ts`.

Remember to set `AQS_EMAIL`, `AQS_KEY`, and `EPA_CAMD_API_KEY` in the Vercel project's environment variables.

---

## Maintainer & Contact

This application is maintained by:

**Rodney Cuevas**
Manager — Air Quality Management Branch
Mississippi Department of Environmental Quality, Air Division

For comments, questions, bug reports, or suggestions: [RCuevas@mdeq.ms.gov](mailto:RCuevas@mdeq.ms.gov)

---

## Disclaimer

* **Screening tool only.** This dashboard is provided for informational and preliminary screening purposes. It does **not** constitute a regulatory applicability determination, permit decision, compliance certification, or official position of the Mississippi Department of Environmental Quality or the U.S. Environmental Protection Agency.
* **Verify against official sources.** All data are retrieved from publicly available EPA systems (ECHO, CAMPD, NEI, TRI, AQS, and design value reports) and are presented "as is," without warranty of accuracy, completeness, or timeliness. Upstream EPA datasets are revised over time; values shown here may lag or differ from current agency records. Confirm any value used in a permit application or regulatory analysis against the official source of record.
* **Not legal advice.** References to statutes and regulations (e.g., 40 CFR 52.21, CAA §112) are provided for convenience only. Consult the current Code of Federal Regulations, applicable Mississippi air regulations, and MDEQ staff for authoritative requirements.
* **Estimated values are labeled.** Where measured data are unavailable (e.g., stack parameters), the application substitutes clearly labeled industry-standard estimates that are unsuitable for final modeling without verification.
* **Applicability screens are simplified.** PSD and §112 indicators use reported *actual* emissions as a floor for potential to emit (PTE) and approximate source-category classifications; actual applicability depends on PTE, permit limits, and project-specific emissions increases.
* **Third-party content.** Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
