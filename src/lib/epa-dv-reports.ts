// ─────────────────────────────────────────────────────────────────────────────
// EPA Official Design Value Reports (xlsx) ingestion
//
// EPA publishes the authoritative criteria-pollutant design values as Excel
// workbooks on https://www.epa.gov/air-trends/air-quality-design-values. These
// reports are released months before the same numbers appear in the ArcGIS
// "Air_Quality_Design_Values_for_Criteria_Pollutants" FeatureServer, so they are
// the most up-to-date source for the current design-value year.
//
// This module:
//   1. Discovers the latest report URL per pollutant by scraping the index page
//      (filenames carry an embedded release date, so we never hardcode them).
//   2. Downloads + caches each workbook (7-day TTL).
//   3. Parses the per-site "Table 5 — Site/Monitor Status" tab into the same
//      DesignValue shape the NAAQS route already serves.
//
// The route uses this as the PRIMARY source for the latest year and falls back
// to ArcGIS automatically if discovery, download, or parsing fails.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

const INDEX_URL = 'https://www.epa.gov/air-trends/air-quality-design-values';
const CACHE_DIR = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), 'src', 'cache');
const FILE_TTL = 7 * 24 * 60 * 60 * 1000;        // cached workbooks: 7 days
const DISCOVERY_TTL = 24 * 60 * 60 * 1000;        // discovered URLs: 24 hours

export interface XlsxDesignValue {
  siteId: string;
  siteName: string;
  county: string;
  lat: number;
  lon: number;
  pollutant: string;
  metric: string;
  designValue: number;
  naaqs: number;
  units: string;
  status: 'Attainment' | 'Exceedance';
  years: number[];
}

export interface XlsxCompleteness {
  siteId: string;
  siteName: string;
  pollutant: string;
  year: number;
  quarter: number;
  observationPct: number;
  sufficient: boolean;
}

export interface XlsxTrendPoint {
  siteId: string;
  siteName: string;
  pollutant: string;
  metric: string;
  year: number;
  value: number;
  naaqs: number;
  units: string;
}

export interface XlsxResult {
  dvs: XlsxDesignValue[];
  completeness: XlsxCompleteness[];
  trendPoints: XlsxTrendPoint[];
}

// One entry per design-value table we extract. `tabKeyword` disambiguates the
// multiple "Table 5" tabs within a workbook (e.g. PM2.5 Annual vs 24-hr).
interface TableConfig {
  tabKeyword: string | null;   // substring required in the Table-5 tab title (null = single table)
  pollutant: string;           // grouping label shown in the UI
  metric: string;              // metric label (must match the ArcGIS route's labels)
  naaqs: number;
  units: string;
  threeYear: boolean;          // true → years = [end-2, end-1, end]; false → [end]
  completenessPollutant?: string; // label used for completeness rows (if the tab has them)
}

// File-prefix → pollutant tables. Prefixes match EPA's `{prefix}_designvalues_*.xlsx`.
const REPORTS: Record<string, TableConfig[]> = {
  o3: [
    { tabKeyword: null, pollutant: 'O3', metric: '8-hr 4th Max (3-yr avg)', naaqs: 0.070, units: 'ppm', threeYear: true, completenessPollutant: 'Ozone' },
  ],
  pm25: [
    { tabKeyword: 'Annual', pollutant: 'PM2.5', metric: 'Annual Mean (3-yr avg)', naaqs: 9.0, units: 'µg/m³', threeYear: true, completenessPollutant: 'PM2.5 Annual' },
    { tabKeyword: '24-hr', pollutant: 'PM2.5', metric: '24-hr 98th Pctl (3-yr avg)', naaqs: 35, units: 'µg/m³', threeYear: true, completenessPollutant: 'PM2.5' },
  ],
  pm10: [
    { tabKeyword: null, pollutant: 'PM10', metric: 'Est. Exceedance Days (3-yr avg)', naaqs: 1, units: 'days', threeYear: true },
  ],
  so2: [
    { tabKeyword: '1-hour', pollutant: 'SO2', metric: '1-hr 99th Pctl (3-yr avg)', naaqs: 75, units: 'ppb', threeYear: true },
  ],
  no2: [
    { tabKeyword: 'Annual', pollutant: 'NO2', metric: 'Annual Mean', naaqs: 53, units: 'ppb', threeYear: false },
    { tabKeyword: '1-hour', pollutant: 'NO2', metric: '1-hr 98th Pctl (3-yr avg)', naaqs: 100, units: 'ppb', threeYear: true },
  ],
  co: [
    { tabKeyword: '8-hour', pollutant: 'CO', metric: '8-hr 2nd Max', naaqs: 9, units: 'ppm', threeYear: false },
    { tabKeyword: '1-hour', pollutant: 'CO', metric: '1-hr 2nd Max', naaqs: 35, units: 'ppm', threeYear: false },
  ],
};

interface DiscoveredReport { url: string; endYear: number; }

let discoveryCache: { reports: Record<string, DiscoveredReport>; time: number } | null = null;

/**
 * Scrape the EPA index page for the newest workbook per pollutant.
 * Filenames look like `o3_designvalues_2023_2025_final_06_08_26.xlsx`; we pick
 * the entry with the greatest end-year for each prefix.
 */
export async function discoverReports(): Promise<Record<string, DiscoveredReport>> {
  const now = Date.now();
  if (discoveryCache && now - discoveryCache.time < DISCOVERY_TTL) {
    return discoveryCache.reports;
  }

  const res = await fetch(INDEX_URL, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Index page HTTP ${res.status}`);
  const html = await res.text();

  const reports: Record<string, DiscoveredReport> = {};
  const re = /https?:\/\/[^"'\s]*?\/([a-z0-9]+)_designvalues_(\d{4})_(\d{4})_final_[^"'\s]*?\.xlsx/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const prefix = m[1].toLowerCase();
    if (!REPORTS[prefix]) continue;          // ignore pollutants we don't surface (e.g. pb/lead)
    const endYear = parseInt(m[3]);
    const url = m[0];
    if (!reports[prefix] || endYear > reports[prefix].endYear) {
      reports[prefix] = { url, endYear };
    }
  }

  if (Object.keys(reports).length === 0) throw new Error('No design-value workbooks found on index page');
  discoveryCache = { reports, time: now };
  return reports;
}

/** Greatest end-year across all discovered reports (the "latest available" year). */
export async function getXlsxLatestYear(): Promise<number | null> {
  try {
    const reports = await discoverReports();
    const years = Object.values(reports).map(r => r.endYear);
    return years.length ? Math.max(...years) : null;
  } catch {
    return null;
  }
}

/** Download a workbook to the cache (7-day TTL) and return its local path. */
async function getCachedWorkbook(prefix: string, report: DiscoveredReport): Promise<string> {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch { /* best effort */ }

  const cachePath = path.join(CACHE_DIR, `dv_report_${prefix}_${report.endYear}.xlsx`);
  if (fs.existsSync(cachePath)) {
    const stats = fs.statSync(cachePath);
    if (Date.now() - stats.mtimeMs < FILE_TTL) return cachePath;
  }

  const res = await fetch(report.url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Workbook ${prefix} HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 10000 || buf[0] !== 0x50 /* 'P' (PK zip) */) {
    throw new Error(`Workbook ${prefix} did not return a valid xlsx (${buf.length} bytes)`);
  }
  fs.writeFileSync(cachePath, buf);
  return cachePath;
}

// ─── Cell + header helpers ───────────────────────────────────────────────────

function cellVal(cell: ExcelJS.Cell | undefined): any {
  if (!cell) return null;
  const v = cell.value as any;
  if (v == null) return null;
  if (typeof v === 'object') {
    if ('result' in v) return v.result;       // formula
    if ('text' in v) return v.text;           // hyperlink / rich text
    if (Array.isArray(v.richText)) return v.richText.map((r: any) => r.text).join('');
    return null;
  }
  return v;
}

function toNum(v: any): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.eE+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Locate the header row (1-indexed) containing both "State Name" and "AQS Site ID". */
function findHeaderRow(ws: ExcelJS.Worksheet): number {
  for (let r = 1; r <= 12; r++) {
    const vals = (ws.getRow(r).values as any[]) || [];
    const joined = vals.map(x => (x == null ? '' : String(cellValRaw(x)))).join('|');
    if (joined.includes('State Name') && joined.includes('AQS Site ID')) return r;
  }
  return -1;
}

// header cells from ws.getRow().values can be plain strings or rich objects
function cellValRaw(v: any): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('result' in v) return String(v.result ?? '');
    if ('text' in v) return String(v.text ?? '');
    if (Array.isArray(v.richText)) return v.richText.map((r: any) => r.text).join('');
    return '';
  }
  return String(v);
}

/** Map header text → column index for the columns we need. */
function mapColumns(ws: ExcelJS.Worksheet, headerRow: number) {
  const row = ws.getRow(headerRow);
  const cols: Record<string, number> = {};
  const completenessCols: { col: number; year: number; quarter: number }[] = [];

  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const h = cellValRaw(cell.value).replace(/\s+/g, ' ').trim();
    if (!h) return;

    if (h === 'State Name') cols.state = colNumber;
    else if (h === 'County Name') cols.county = colNumber;
    else if (h.includes('AQS Site ID')) cols.siteId = colNumber;
    else if (h.includes('Local Site Name')) cols.siteName = colNumber;
    else if (h.includes('Site Latitude')) cols.lat = colNumber;
    else if (h.includes('Site Longitude')) cols.lon = colNumber;
    else if (h.startsWith('Valid') && (h.includes('Design Value') || h.includes('Estimated Exceedances'))) {
      cols.dv = colNumber;
    }

    // Completeness columns: "2025 Q3 Data Completeness (%)" or annual "2025 Data Complete..."
    let cm = h.match(/^(\d{4})\s+Q([1-4])\s+Data Compl/i);
    if (cm) { completenessCols.push({ col: colNumber, year: parseInt(cm[1]), quarter: parseInt(cm[2]) }); }
    else {
      cm = h.match(/^(\d{4})\s+Data Complete/i);
      if (cm) completenessCols.push({ col: colNumber, year: parseInt(cm[1]), quarter: 0 });
    }
  });

  return { cols, completenessCols };
}

/** Parse one pollutant workbook for a single state into DesignValue / completeness / trend rows. */
async function parseWorkbook(filePath: string, configs: TableConfig[], stateName: string, endYear: number): Promise<XlsxResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const dvs: XlsxDesignValue[] = [];
  const completeness: XlsxCompleteness[] = [];
  const trendPoints: XlsxTrendPoint[] = [];

  for (const cfg of configs) {
    // Find the matching Table-5 status tab.
    const ws = wb.worksheets.find(s => {
      const t = s.name;
      const isStatus = /Table\s*5/i.test(t) && /(Site|Monitor) Status/i.test(t);
      if (!isStatus) return false;
      return cfg.tabKeyword ? t.toLowerCase().includes(cfg.tabKeyword.toLowerCase()) : true;
    });
    if (!ws) continue;

    const headerRow = findHeaderRow(ws);
    if (headerRow < 0) continue;
    const { cols, completenessCols } = mapColumns(ws, headerRow);
    if (!cols.state || !cols.siteId || !cols.dv || !cols.lat || !cols.lon) continue;

    const years = cfg.threeYear ? [endYear - 2, endYear - 1, endYear] : [endYear];

    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const stateVal = cellVal(row.getCell(cols.state));
      if (!stateVal || String(stateVal).trim() !== stateName) continue;

      const dv = toNum(cellVal(row.getCell(cols.dv)));
      if (dv == null) continue; // blank "Valid" DV → incomplete/invalid, skip

      const siteId = String(cellVal(row.getCell(cols.siteId)) ?? '').trim();
      if (!siteId) continue;
      const siteName = String(cellVal(row.getCell(cols.siteName)) ?? '').trim();
      const county = String(cellVal(row.getCell(cols.county)) ?? '').trim();
      const lat = toNum(cellVal(row.getCell(cols.lat))) ?? 0;
      const lon = toNum(cellVal(row.getCell(cols.lon))) ?? 0;

      // PM10 form is exceedance-based: "not to be exceeded more than once per year".
      const status: 'Attainment' | 'Exceedance' = dv > cfg.naaqs ? 'Exceedance' : 'Attainment';

      dvs.push({
        siteId, siteName, county, lat, lon,
        pollutant: cfg.pollutant, metric: cfg.metric,
        designValue: dv, naaqs: cfg.naaqs, units: cfg.units,
        status, years,
      });

      // Latest-year trend point so the historical chart reaches the current year.
      trendPoints.push({
        siteId, siteName, pollutant: cfg.pollutant, metric: cfg.metric,
        year: endYear, value: dv, naaqs: cfg.naaqs, units: cfg.units,
      });

      if (cfg.completenessPollutant) {
        for (const cc of completenessCols) {
          const pct = toNum(cellVal(row.getCell(cc.col)));
          if (pct == null) continue;
          completeness.push({
            siteId, siteName, pollutant: cfg.completenessPollutant,
            year: cc.year, quarter: cc.quarter,
            observationPct: Math.round(pct), sufficient: pct >= 75,
          });
        }
      }
    }
  }

  return { dvs, completeness, trendPoints };
}

/**
 * Primary entry point. Returns design values, completeness, and latest-year trend
 * points for `stateName` at `endYear`, parsed from EPA's official xlsx reports.
 * Only reports whose end-year matches `endYear` are used. Throws on hard failure
 * so the caller can fall back to ArcGIS.
 */
export async function getXlsxDesignValues(stateName: string, endYear: number): Promise<XlsxResult> {
  const reports = await discoverReports();

  const out: XlsxResult = { dvs: [], completeness: [], trendPoints: [] };
  const tasks = Object.entries(REPORTS)
    .filter(([prefix]) => reports[prefix] && reports[prefix].endYear === endYear)
    .map(async ([prefix, configs]) => {
      try {
        const filePath = await getCachedWorkbook(prefix, reports[prefix]);
        return await parseWorkbook(filePath, configs, stateName, endYear);
      } catch (err) {
        console.error(`[NAAQS-xlsx] Failed to parse ${prefix}:`, (err as Error).message);
        return { dvs: [], completeness: [], trendPoints: [] } as XlsxResult;
      }
    });

  const results = await Promise.all(tasks);
  for (const res of results) {
    out.dvs.push(...res.dvs);
    out.completeness.push(...res.completeness);
    out.trendPoints.push(...res.trendPoints);
  }

  if (out.dvs.length === 0) throw new Error(`No xlsx design values parsed for ${stateName}/${endYear}`);
  return out;
}
