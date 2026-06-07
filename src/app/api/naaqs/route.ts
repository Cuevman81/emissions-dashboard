import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const ARCGIS_BASE = 'https://services.arcgis.com/cJ9YHowT8TU7DUyn/ArcGIS/rest/services/Air_Quality_Design_Values_for_Criteria_Pollutants/FeatureServer';
const CACHE_DIR = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), 'src', 'cache');
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

try {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
} catch (err) {
  console.warn('[Cache] Failed to ensure cache directory exists:', err);
}

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District Of Columbia',
};

interface DesignValue {
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

interface TrendPoint {
  siteId: string;
  siteName: string;
  pollutant: string;
  metric: string;
  year: number;
  value: number;
  naaqs: number;
  units: string;
}

interface Completeness {
  siteId: string;
  siteName: string;
  pollutant: string;
  year: number;
  quarter: number;
  observationPct: number;
  sufficient: boolean;
}

async function queryLayer(layerId: number, stateName: string, dvYearText?: string): Promise<any[]> {
  let where = `state_name='${stateName}'`;
  if (dvYearText) where += ` AND DVYearText='${dvYearText}'`;

  const params = new URLSearchParams({
    where,
    outFields: '*',
    f: 'json',
    resultRecordCount: '2000',
  });

  const url = `${ARCGIS_BASE}/${layerId}/query?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) return [];
  const data = await res.json();
  return data.features?.map((f: any) => f.attributes) || [];
}

function parseDvYear(attr: any): number | null {
  const text = attr.DVYearText;
  if (text) return parseInt(text);
  return null;
}

function getSiteId(r: any): string {
  return r.AQSID || `${r.state_code}${r.county_code}${r.site_number}`;
}

function getSiteName(r: any): string {
  return r.site_name || r.local_site_name || '';
}

// ─── O3 (Layer 1) ──────────────────────────────────────────────────────────
// Fields: dv (ppb), valid (Y/N), max4_yr1/yr2/yr3, percent_yr1/yr2/yr3, site_name
function processO3(currentRecords: any[], allRecords: any[]): { dvs: DesignValue[]; trends: TrendPoint[]; completeness: Completeness[] } {
  const NAAQS_PPB = 70;
  const dvs: DesignValue[] = [];
  const trends: TrendPoint[] = [];
  const completeness: Completeness[] = [];

  for (const r of currentRecords) {
    if (r.dv == null) continue;
    const siteId = getSiteId(r);
    const siteName = r.site_name || '';
    const dvYear = parseDvYear(r);
    if (!dvYear) continue;

    dvs.push({
      siteId, siteName, county: r.county_name || '',
      lat: r.latitude, lon: r.longitude,
      pollutant: 'O3', metric: '8-hr 4th Max (3-yr avg)',
      designValue: r.dv / 1000, naaqs: 0.070, units: 'ppm',
      status: r.dv > NAAQS_PPB ? 'Exceedance' : 'Attainment',
      years: [dvYear - 2, dvYear - 1, dvYear],
    });

    if (r.percent_yr1 != null) completeness.push({ siteId, siteName, pollutant: 'Ozone', year: dvYear - 2, quarter: 0, observationPct: r.percent_yr1, sufficient: r.percent_yr1 >= 75 });
    if (r.percent_yr2 != null) completeness.push({ siteId, siteName, pollutant: 'Ozone', year: dvYear - 1, quarter: 0, observationPct: r.percent_yr2, sufficient: r.percent_yr2 >= 75 });
    if (r.percent_yr3 != null) completeness.push({ siteId, siteName, pollutant: 'Ozone', year: dvYear, quarter: 0, observationPct: r.percent_yr3, sufficient: r.percent_yr3 >= 75 });
  }

  // Trends from all valid historical records
  for (const r of allRecords) {
    if (r.dv == null || r.valid !== 'Y') continue;
    const yr = parseDvYear(r);
    if (!yr) continue;
    trends.push({
      siteId: getSiteId(r), siteName: r.site_name || '',
      pollutant: 'O3', metric: '8-hr 4th Max (3-yr avg)',
      year: yr, value: r.dv / 1000, naaqs: 0.070, units: 'ppm',
    });
  }

  return { dvs, trends, completeness };
}

// ─── PM2.5 24-hr (Layer 3) ─────────────────────────────────────────────────
// Fields: daily_design_value, dv_validity_ind, dv_year_98th_percentile, standard_level, local_site_name
function processPM25_24hr(currentRecords: any[], allRecords: any[]): { dvs: DesignValue[]; trends: TrendPoint[]; completeness: Completeness[] } {
  const dvs: DesignValue[] = [];
  const trends: TrendPoint[] = [];
  const completeness: Completeness[] = [];

  for (const r of currentRecords) {
    if (r.daily_design_value == null) continue;
    const siteId = getSiteId(r);
    const siteName = getSiteName(r);
    const dvYear = parseDvYear(r);
    if (!dvYear) continue;
    const naaqs = r.standard_level ?? 35;

    dvs.push({
      siteId, siteName, county: r.county_name || '',
      lat: r.latitude, lon: r.longitude,
      pollutant: 'PM2.5', metric: '24-hr 98th Pctl (3-yr avg)',
      designValue: r.daily_design_value, naaqs, units: 'µg/m³',
      status: r.daily_design_value > naaqs ? 'Exceedance' : 'Attainment',
      years: [dvYear - 2, dvYear - 1, dvYear],
    });

    // Quarterly completeness
    for (const [prefix, offset] of [['dv_yr_', 0], ['yr1_', -1], ['yr2_', -2]] as const) {
      for (let q = 1; q <= 4; q++) {
        const schedKey = `${prefix}q${q}_scheduled_samples`;
        const credKey = `${prefix}q${q}_creditable_cnt`;
        const sched = r[schedKey];
        const cred = r[credKey];
        if (sched != null && sched > 0 && cred != null) {
          const pct = Math.round((cred / sched) * 100);
          completeness.push({ siteId, siteName, pollutant: 'PM2.5', year: dvYear + offset, quarter: q, observationPct: pct, sufficient: pct >= 75 });
        }
      }
    }
  }

  for (const r of allRecords) {
    if (r.daily_design_value == null || r.dv_validity_ind !== 'Y') continue;
    const yr = parseDvYear(r);
    if (!yr) continue;
    trends.push({
      siteId: getSiteId(r), siteName: getSiteName(r),
      pollutant: 'PM2.5', metric: '24-hr 98th Pctl (3-yr avg)',
      year: yr, value: r.daily_design_value, naaqs: r.standard_level ?? 35, units: 'µg/m³',
    });
  }

  return { dvs, trends, completeness };
}

// ─── PM2.5 Annual (Layer 4) ────────────────────────────────────────────────
// Fields: design_value, dv_validity_ind, standard_level, local_site_name
function processPM25_annual(currentRecords: any[], allRecords: any[]): { dvs: DesignValue[]; trends: TrendPoint[]; completeness: Completeness[] } {
  const dvs: DesignValue[] = [];
  const trends: TrendPoint[] = [];
  const completeness: Completeness[] = [];

  for (const r of currentRecords) {
    if (r.design_value == null) continue;
    const siteId = getSiteId(r);
    const siteName = getSiteName(r);
    const dvYear = parseDvYear(r);
    if (!dvYear) continue;
    const naaqs = r.standard_level ?? 9.0;

    dvs.push({
      siteId, siteName, county: r.county_name || '',
      lat: r.latitude, lon: r.longitude,
      pollutant: 'PM2.5', metric: 'Annual Mean (3-yr avg)',
      designValue: r.design_value, naaqs, units: 'µg/m³',
      status: r.design_value > naaqs ? 'Exceedance' : 'Attainment',
      years: [dvYear - 2, dvYear - 1, dvYear],
    });

    // Quarterly completeness
    for (const [prefix, offset] of [['dv_yr_', 0], ['yr1_', -1], ['yr2_', -2]] as const) {
      for (let q = 1; q <= 4; q++) {
        const schedKey = `${prefix}q${q}_scheduled_cnt`;
        const credKey = `${prefix}q${q}_creditable_cnt`;
        const sched = r[schedKey];
        const cred = r[credKey];
        if (sched != null && sched > 0 && cred != null) {
          const pct = Math.round((cred / sched) * 100);
          completeness.push({ siteId, siteName, pollutant: 'PM2.5 Annual', year: dvYear + offset, quarter: q, observationPct: pct, sufficient: pct >= 75 });
        }
      }
    }
  }

  for (const r of allRecords) {
    if (r.design_value == null || r.dv_validity_ind !== 'Y') continue;
    const yr = parseDvYear(r);
    if (!yr) continue;
    trends.push({
      siteId: getSiteId(r), siteName: getSiteName(r),
      pollutant: 'PM2.5', metric: 'Annual Mean (3-yr avg)',
      year: yr, value: r.design_value, naaqs: r.standard_level ?? 9.0, units: 'µg/m³',
    });
  }

  return { dvs, trends, completeness };
}

// ─── PM10 (Layer 2) ────────────────────────────────────────────────────────
// No design_value field — PM10 uses exceedance-based form. We report the estimated exceedances.
// The standard_level is 150 µg/m³ and the statistic is "estimated days > standard"
function processPM10(currentRecords: any[], allRecords: any[]): { dvs: DesignValue[]; trends: TrendPoint[]; completeness: Completeness[] } {
  const dvs: DesignValue[] = [];
  const trends: TrendPoint[] = [];
  const completeness: Completeness[] = [];

  // PM10 doesn't have a numeric DV in the ArcGIS layer — skip if no useful data
  // The layer tracks exceedance counts rather than a DV number
  for (const r of currentRecords) {
    const siteId = getSiteId(r);
    const siteName = getSiteName(r);
    const dvYear = parseDvYear(r);
    if (!dvYear) continue;

    const estExc = r.dv_estimated_exceedances ?? 0;
    const naaqs = r.standard_level ?? 150;

    dvs.push({
      siteId, siteName, county: r.county_name || '',
      lat: r.latitude, lon: r.longitude,
      pollutant: 'PM10', metric: 'Est. Exceedance Days (3-yr avg)',
      designValue: estExc, naaqs: 1, units: 'days',
      status: estExc > 1 ? 'Exceedance' : 'Attainment',
      years: [dvYear - 2, dvYear - 1, dvYear],
    });
  }

  for (const r of allRecords) {
    const yr = parseDvYear(r);
    if (!yr) continue;
    const valid = r.dv_validity_indicator;
    if (valid !== 'Y') continue;
    trends.push({
      siteId: getSiteId(r), siteName: getSiteName(r),
      pollutant: 'PM10', metric: 'Est. Exceedance Days (3-yr avg)',
      year: yr, value: r.dv_estimated_exceedances ?? 0, naaqs: 1, units: 'days',
    });
  }

  return { dvs, trends, completeness };
}

// ─── NO2 Annual (Layer 9) ──────────────────────────────────────────────────
// Fields: design_value, dv_validity_ind (inferred), standard_level, local_site_name
function processNO2_annual(currentRecords: any[], allRecords: any[]): { dvs: DesignValue[]; trends: TrendPoint[]; completeness: Completeness[] } {
  const dvs: DesignValue[] = [];
  const trends: TrendPoint[] = [];

  for (const r of currentRecords) {
    if (r.design_value == null) continue;
    const siteId = getSiteId(r);
    const siteName = getSiteName(r);
    const dvYear = parseDvYear(r);
    if (!dvYear) continue;
    const naaqs = r.standard_level ?? 53;

    dvs.push({
      siteId, siteName, county: r.county_name || '',
      lat: r.latitude, lon: r.longitude,
      pollutant: 'NO2', metric: 'Annual Mean',
      designValue: r.design_value, naaqs, units: 'ppb',
      status: r.design_value > naaqs ? 'Exceedance' : 'Attainment',
      years: [dvYear],
    });
  }

  for (const r of allRecords) {
    if (r.design_value == null) continue;
    const yr = parseDvYear(r);
    if (!yr) continue;
    trends.push({
      siteId: getSiteId(r), siteName: getSiteName(r),
      pollutant: 'NO2', metric: 'Annual Mean',
      year: yr, value: r.design_value, naaqs: r.standard_level ?? 53, units: 'ppb',
    });
  }

  return { dvs, trends, completeness: [] };
}

// ─── NO2 1-hr (Layer 10) ───────────────────────────────────────────────────
// Fields: design_value, standard_level, local_site_name
function processNO2_1hr(currentRecords: any[], allRecords: any[]): { dvs: DesignValue[]; trends: TrendPoint[]; completeness: Completeness[] } {
  const dvs: DesignValue[] = [];
  const trends: TrendPoint[] = [];

  for (const r of currentRecords) {
    if (r.design_value == null) continue;
    const siteId = getSiteId(r);
    const siteName = getSiteName(r);
    const dvYear = parseDvYear(r);
    if (!dvYear) continue;
    const naaqs = r.standard_level ?? 100;

    dvs.push({
      siteId, siteName, county: r.county_name || '',
      lat: r.latitude, lon: r.longitude,
      pollutant: 'NO2', metric: '1-hr 98th Pctl (3-yr avg)',
      designValue: r.design_value, naaqs, units: 'ppb',
      status: r.design_value > naaqs ? 'Exceedance' : 'Attainment',
      years: [dvYear - 2, dvYear - 1, dvYear],
    });
  }

  for (const r of allRecords) {
    if (r.design_value == null) continue;
    const yr = parseDvYear(r);
    if (!yr) continue;
    trends.push({
      siteId: getSiteId(r), siteName: getSiteName(r),
      pollutant: 'NO2', metric: '1-hr 98th Pctl (3-yr avg)',
      year: yr, value: r.design_value, naaqs: r.standard_level ?? 100, units: 'ppb',
    });
  }

  return { dvs, trends, completeness: [] };
}

// ─── SO2 1-hr (Layer 6) ────────────────────────────────────────────────────
// Fields: design_value, standard_level, local_site_name
function processSO2(currentRecords: any[], allRecords: any[]): { dvs: DesignValue[]; trends: TrendPoint[]; completeness: Completeness[] } {
  const dvs: DesignValue[] = [];
  const trends: TrendPoint[] = [];

  for (const r of currentRecords) {
    if (r.design_value == null) continue;
    const siteId = getSiteId(r);
    const siteName = getSiteName(r);
    const dvYear = parseDvYear(r);
    if (!dvYear) continue;
    const naaqs = r.standard_level ?? 75;

    dvs.push({
      siteId, siteName, county: r.county_name || '',
      lat: r.latitude, lon: r.longitude,
      pollutant: 'SO2', metric: '1-hr 99th Pctl (3-yr avg)',
      designValue: r.design_value, naaqs, units: 'ppb',
      status: r.design_value > naaqs ? 'Exceedance' : 'Attainment',
      years: [dvYear - 2, dvYear - 1, dvYear],
    });
  }

  for (const r of allRecords) {
    if (r.design_value == null) continue;
    const yr = parseDvYear(r);
    if (!yr) continue;
    trends.push({
      siteId: getSiteId(r), siteName: getSiteName(r),
      pollutant: 'SO2', metric: '1-hr 99th Pctl (3-yr avg)',
      year: yr, value: r.design_value, naaqs: r.standard_level ?? 75, units: 'ppb',
    });
  }

  return { dvs, trends, completeness: [] };
}

// ─── CO (Layers 7 & 8) ─────────────────────────────────────────────────────
// Fields: co_1hr_2nd_max_value, co_8hr_2nd_max_value, dv_validity_ind, local_site_name
function processCO(co1hrRecords: any[], co8hrRecords: any[], co1hrAll: any[], co8hrAll: any[]): { dvs: DesignValue[]; trends: TrendPoint[]; completeness: Completeness[] } {
  const dvs: DesignValue[] = [];
  const trends: TrendPoint[] = [];

  // 1-hr (NAAQS = 35 ppm)
  for (const r of co1hrRecords) {
    if (r.co_1hr_2nd_max_value == null) continue;
    const siteId = getSiteId(r);
    const siteName = getSiteName(r);
    const dvYear = parseDvYear(r);
    if (!dvYear) continue;

    dvs.push({
      siteId, siteName, county: r.county_name || '',
      lat: r.latitude, lon: r.longitude,
      pollutant: 'CO', metric: '1-hr 2nd Max',
      designValue: r.co_1hr_2nd_max_value, naaqs: 35, units: 'ppm',
      status: r.co_1hr_2nd_max_value > 35 ? 'Exceedance' : 'Attainment',
      years: [dvYear],
    });
  }

  for (const r of co1hrAll) {
    if (r.co_1hr_2nd_max_value == null || r.dv_validity_ind !== 'Y') continue;
    const yr = parseDvYear(r);
    if (!yr) continue;
    trends.push({
      siteId: getSiteId(r), siteName: getSiteName(r),
      pollutant: 'CO', metric: '1-hr 2nd Max',
      year: yr, value: r.co_1hr_2nd_max_value, naaqs: 35, units: 'ppm',
    });
  }

  // 8-hr (NAAQS = 9 ppm)
  for (const r of co8hrRecords) {
    if (r.co_8hr_2nd_max_value == null) continue;
    const siteId = getSiteId(r);
    const siteName = getSiteName(r);
    const dvYear = parseDvYear(r);
    if (!dvYear) continue;

    dvs.push({
      siteId, siteName, county: r.county_name || '',
      lat: r.latitude, lon: r.longitude,
      pollutant: 'CO', metric: '8-hr 2nd Max',
      designValue: r.co_8hr_2nd_max_value, naaqs: 9, units: 'ppm',
      status: r.co_8hr_2nd_max_value > 9 ? 'Exceedance' : 'Attainment',
      years: [dvYear],
    });
  }

  for (const r of co8hrAll) {
    if (r.co_8hr_2nd_max_value == null || r.dv_validity_ind !== 'Y') continue;
    const yr = parseDvYear(r);
    if (!yr) continue;
    trends.push({
      siteId: getSiteId(r), siteName: getSiteName(r),
      pollutant: 'CO', metric: '8-hr 2nd Max',
      year: yr, value: r.co_8hr_2nd_max_value, naaqs: 9, units: 'ppm',
    });
  }

  return { dvs, trends, completeness: [] };
}

let cachedLatestYear: number | null = null;
let cachedLatestYearTime = 0;
const LATEST_YEAR_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function getLatestAvailableYear(): Promise<number> {
  const now = Date.now();
  if (cachedLatestYear && (now - cachedLatestYearTime < LATEST_YEAR_CACHE_TTL)) {
    return cachedLatestYear;
  }

  const layerId = 1; // Ozone (representative criteria pollutant)
  const where = '1=1';
  const params = new URLSearchParams({
    where,
    outFields: 'DVYearText',
    orderByFields: 'DVYearText DESC',
    resultRecordCount: '1',
    f: 'json',
  });

  const url = `${ARCGIS_BASE}/${layerId}/query?${params}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      const features = data.features || [];
      if (features.length > 0 && features[0].attributes?.DVYearText) {
        const yr = parseInt(features[0].attributes.DVYearText);
        if (!isNaN(yr) && yr >= 2024) {
          cachedLatestYear = yr;
          cachedLatestYearTime = now;
          return yr;
        }
      }
    }
  } catch (err) {
    console.error('[NAAQS] Failed to fetch latest year from FeatureServer, using fallback:', err);
  }

  if (cachedLatestYear) {
    return cachedLatestYear;
  }
  return 2024; // Absolute fallback
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const state = (searchParams.get('state') || 'MS').toUpperCase();
  const stateName = STATE_NAMES[state];

  if (!stateName) {
    return NextResponse.json({ error: `Invalid state: ${state}` }, { status: 400 });
  }

  const latestYear = await getLatestAvailableYear();
  const endYearParam = searchParams.get('endYear');
  let endYear: number;
  if (!endYearParam || endYearParam === 'undefined' || endYearParam === 'null') {
    endYear = latestYear;
  } else {
    endYear = parseInt(endYearParam);
    if (isNaN(endYear)) {
      endYear = latestYear;
    }
  }

  const resultCacheKey = `naaqs_arcgis_${state}_${endYear}.json`;
  const resultCachePath = path.join(CACHE_DIR, resultCacheKey);
  if (fs.existsSync(resultCachePath)) {
    const stats = fs.statSync(resultCachePath);
    if (Date.now() - stats.mtimeMs < CACHE_TTL) {
      console.log(`[NAAQS] Cache hit: ${state}/${endYear}`);
      try {
        const cachedData = JSON.parse(fs.readFileSync(resultCachePath, 'utf8'));
        // Ensure latestYear is injected in cached responses
        cachedData.latestYear = latestYear;
        return NextResponse.json(cachedData);
      } catch { /* parse error, fallback to refetching */ }
    }
  }

  try {
    const dvYear = String(endYear);

    // Query all layers in parallel: current-year DVs + full history for trends
    const [
      o3Cur, o3All,
      pm25_24Cur, pm25_24All,
      pm25_annCur, pm25_annAll,
      pm10Cur, pm10All,
      no2_annCur, no2_annAll,
      no2_1hrCur, no2_1hrAll,
      so2Cur, so2All,
      co1hrCur, co1hrAll,
      co8hrCur, co8hrAll,
    ] = await Promise.all([
      queryLayer(1, stateName, dvYear), queryLayer(1, stateName),   // O3
      queryLayer(3, stateName, dvYear), queryLayer(3, stateName),   // PM2.5 24-hr
      queryLayer(4, stateName, dvYear), queryLayer(4, stateName),   // PM2.5 Annual
      queryLayer(2, stateName, dvYear), queryLayer(2, stateName),   // PM10
      queryLayer(9, stateName, dvYear), queryLayer(9, stateName),   // NO2 Annual
      queryLayer(10, stateName, dvYear), queryLayer(10, stateName), // NO2 1-hr
      queryLayer(6, stateName, dvYear), queryLayer(6, stateName),   // SO2
      queryLayer(7, stateName, dvYear), queryLayer(7, stateName),   // CO 1-hr
      queryLayer(8, stateName, dvYear), queryLayer(8, stateName),   // CO 8-hr
    ]);

    const o3 = processO3(o3Cur, o3All);
    const pm25_24 = processPM25_24hr(pm25_24Cur, pm25_24All);
    const pm25_ann = processPM25_annual(pm25_annCur, pm25_annAll);
    const pm10 = processPM10(pm10Cur, pm10All);
    const no2_ann = processNO2_annual(no2_annCur, no2_annAll);
    const no2_1hr = processNO2_1hr(no2_1hrCur, no2_1hrAll);
    const so2 = processSO2(so2Cur, so2All);
    const co = processCO(co1hrCur, co8hrCur, co1hrAll, co8hrAll);

    const allDvs = [...o3.dvs, ...pm25_24.dvs, ...pm25_ann.dvs, ...pm10.dvs, ...no2_ann.dvs, ...no2_1hr.dvs, ...so2.dvs, ...co.dvs];
    const allTrends = [...o3.trends, ...pm25_24.trends, ...pm25_ann.trends, ...pm10.trends, ...no2_ann.trends, ...no2_1hr.trends, ...so2.trends, ...co.trends];
    const allCompleteness = [...o3.completeness, ...pm25_24.completeness, ...pm25_ann.completeness, ...pm10.completeness];

    // Deduplicate trends
    const seen = new Set<string>();
    const dedupedTrends = allTrends.filter(t => {
      const key = `${t.siteId}_${t.pollutant}_${t.metric}_${t.year}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const result = { designValues: allDvs, trends: dedupedTrends, completeness: allCompleteness, state, endYear, latestYear };

    try {
      fs.writeFileSync(resultCachePath, JSON.stringify(result), 'utf8');
      console.log(`[NAAQS] Cached: ${allDvs.length} DVs, ${dedupedTrends.length} trends for ${state}/${endYear}`);
    } catch { /* ignore */ }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[NAAQS] ArcGIS query failed:', err.message);
    return NextResponse.json({ error: err.message, designValues: [], trends: [], completeness: [], state, endYear, latestYear }, { status: 500 });
  }
}
