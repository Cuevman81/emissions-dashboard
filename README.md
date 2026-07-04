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
* **Stack Parameters**: Unit-level stack data from CAMD monitor plans (EGUs) or NEI release points, with EPA RSEI industry-median fallbacks for AERMOD screening; supports manual CSV upload.

### Toxics
* **TRI HAPs Inventory & Trends**: Multi-year Toxics Release Inventory air releases with historical trend charts, auto-synced from EPA Envirofacts.
* **NEI 2020/2023 Toggle**: Dynamic toggle between National Emissions Inventory cycles for facility CAP and HAP data.
* **§112 HAP Major Source Screen**: NEI-based screening against the CAA §112 major-source thresholds (10 tpy single HAP / 25 tpy combined), with PTE caveats.
* **Ambient Context**: Nearest EPA AQS monitor lookup with pollutant coverage for each facility.

### NAAQS
* **Official EPA Design Values**: Ingests EPA's official annual design value reports (xlsx) directly — the authoritative source, typically months ahead of other feeds — with the ArcGIS FeatureServer as history/fallback.
* **Attainment & Trends**: CFR-compliant certified Design Values for all criteria pollutants, 10+ year trend charts against the standards, and quarterly data-completeness indicators.

---

## Data Sources

1. **EPA ECHO API** — Real-time Clean Air Act (CAA) regulated facility inventories (with committed seed fallback for cold starts).
2. **EPA CAMD / CAMPD** — Apportioned annual CEMS emissions and monitor-plan stack parameters for EGUs.
3. **EPA National Emissions Inventory (NEI)** — 2020 (ArcGIS) and 2023 (locally parsed from GAFTP) point-source data for Mississippi.
4. **EPA Toxics Release Inventory (TRI)** — Multi-year release summaries via Envirofacts.
5. **EPA Air Quality Design Value Reports** — Official annual xlsx reports (primary NAAQS source).
6. **EPA ArcGIS FeatureServer** — NAAQS design value history and NEI 2020 layers.
7. **EPA AQS Service** — Ambient monitor parameters, daily samples, and annual statistics.

---

## Tech Stack

* **Framework**: [Next.js](https://nextjs.org/) 16 (App Router, webpack build)
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
   Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

---

## Automated Data Freshness

A daily GitHub Action (`.github/workflows/data-freshness-check.yml`) audits the upstream EPA sources — NEI GAFTP dataset version, NAAQS design value years, new TRI reporting years, ECHO facility inventory drift, and new CAMD data years — and opens a GitHub Issue when an update is available.

---

## Deployment on Vercel

This application is fully optimized for serverless deployment on Vercel:
* **Serverless Caching**: Automatically falls back to `/tmp` in serverless environments for API response caches, preventing read-only filesystem crashes.
* **Stateless Operation**: Pre-compiled datasets (NEI 2023, TRI emissions, facility seed) are packed with the build for instant load times without external database dependencies; sync endpoints are disabled serverlessly, and data updates flow through the daily GitHub Action + redeploy.
* **Cold-Start Resilience**: The facility roster is served from a committed seed file within a bounded time budget when live EPA APIs are slow.
* **Security Headers**: `nosniff`, frame protection, referrer and permissions policies applied globally.

Remember to set `AQS_EMAIL`, `AQS_KEY`, and `EPA_CAMD_API_KEY` in the Vercel project's environment variables.
