# MS DEQ Air Division Dashboard

An interactive web application designed for air quality analysis, Prevention of Significant Deterioration (PSD) cumulative impact screening, National Ambient Air Quality Standards (NAAQS) compliance tracking, and Air Toxics evaluation.

Designed for the **Mississippi Department of Environmental Quality (MDEQ) Air Division**.

---

## Key Features

* **Interactive Proximity Map**: Map facilities statewide, calculate distances within custom radii, and filter by permit classification (Title V Major, Synthetic Minor, Minor/Other) and data source.
* **Federal Class I Areas Overlay**: Map national wilderness areas and parks subject to regional haze and PSD increment regulations.
* **NEI 2023 Point Source Integration**: Dynamic toggle between 2020 and 2023 National Emissions Inventory (NEI) datasets for Criteria Air Pollutant (CAP) and Hazardous Air Pollutant (HAP) modeling.
* **Toxics Release Inventory (TRI) Trends**: Analyze historical HAP releases and emissions trajectories.
* **EPA AQS Monitor Live Feeds**: Connects directly to EPA's AQS service to identify active monitoring networks, coordinate parameters, and view site details.
* **NAAQS Attainment & Trends**: Dynamic queries connecting to the EPA ArcGIS FeatureServer to retrieve CFR-compliant certified Design Values (DVs) for criteria pollutants, including 10-year trends and data completeness indicators.

---

## Data Sources

1. **EPA ECHO API**: Real-time Clean Air Act (CAA) regulated facility inventories.
2. **EPA National Emissions Inventory (NEI)**: 2020 and 2023 Point Source data (locally parsed and compiled for Mississippi).
3. **EPA Toxics Release Inventory (TRI)**: Multi-year release summaries.
4. **EPA ArcGIS FeatureServer**: Live, CFR-compliant NAAQS Design Value records.
5. **EPA AQS Service**: Ambient monitor parameters and sample metadata.

---

## Tech Stack

* **Framework**: [Next.js](https://nextjs.org/) (App Router, Turbopack)
* **Frontend**: React, Tailwind CSS
* **Mapping**: Leaflet, [react-leaflet](https://react-leaflet.js.org/)
* **Charts**: [Recharts](https://recharts.org/)
* **State Management**: Consolidated React `useReducer` state machine
* **Accessibility**: Fully WCAG 2.1 compliant (ARIA landmarks, labels, keyboard navigation)

---

## Getting Started

### Prerequisites

* Node.js (v18 or higher)
* npm (v9 or higher)

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

3. Run the development server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

---

## Deployment on Vercel

This application is fully optimized for serverless deployment on Vercel:
* **Serverless Caching**: Automatically falls back to `/tmp` in serverless environments for writing temporary API logs and session caches, preventing read-only filesystem crashes.
* **Stateless Operation**: Pre-compiled datasets (NEI 2023, TRI emissions) are packed with the build for instant load times without external database dependencies.
