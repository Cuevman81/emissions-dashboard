// EPA Emissions Data Service
import * as turf from '@turf/turf';

export const STATE_CENTERS: Record<string, [number, number]> = {
  AL: [32.73, -86.79], AK: [64.20, -153.37], AZ: [34.04, -111.09], AR: [34.80, -92.20],
  CA: [36.78, -119.42], CO: [39.11, -105.36], CT: [41.60, -72.69], DE: [38.99, -75.51],
  FL: [27.66, -81.52], GA: [32.68, -83.44], HI: [20.80, -156.33], ID: [44.07, -114.74],
  IL: [40.33, -89.00], IN: [39.85, -86.26], IA: [42.01, -93.21], KS: [38.53, -96.73],
  KY: [37.67, -84.67], LA: [31.17, -91.87], ME: [44.69, -69.38], MD: [38.97, -76.50],
  MA: [42.23, -71.53], MI: [44.31, -85.60], MN: [46.39, -94.63], MS: [32.35, -89.39],
  MO: [38.46, -92.29], MT: [46.88, -110.36], NE: [41.49, -99.90], NV: [38.31, -117.06],
  NH: [43.45, -71.57], NJ: [40.06, -74.41], NM: [34.52, -105.87], NY: [42.16, -74.84],
  NC: [35.63, -79.81], ND: [47.53, -99.78], OH: [40.29, -82.79], OK: [35.59, -96.93],
  OR: [44.57, -122.07], PA: [41.20, -77.19], RI: [41.74, -71.68], SC: [33.90, -80.90],
  SD: [44.44, -100.23], TN: [35.86, -86.66], TX: [31.05, -97.56], UT: [39.32, -111.09],
  VT: [44.07, -72.67], VA: [37.77, -78.17], WA: [47.40, -120.50], WV: [38.49, -80.95],
  WI: [44.27, -89.62], WY: [42.94, -107.55], DC: [38.91, -77.02],
};

export type FacilitySector =
  | 'Power Plant'
  | 'Refinery'
  | 'Chemical'
  | 'Cement'
  | 'Paper/Pulp'
  | 'Steel'
  | 'Oil & Gas'
  | 'Wood Products'
  | 'Metal Fabrication'
  | 'Plastics/Rubber'
  | 'Pipeline/Compressor'
  | 'Food Processing'
  | 'Transportation Equip'
  | 'Waste Management'
  | 'Other';

export interface Facility {
  id: string;
  triId?: string | null;
  camdId?: string | null;   // ORIS plant code — present for EGU/power plants (CAMPD data)
  eisId?: string | null;    // NEI/EIS facility ID
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lon: number;
  distance?: number;
  permitType?: 'Major' | 'Synthetic Minor' | 'Federally Reportable Minor' | 'Other';
  isMajor?: boolean;
  hasHpv?: boolean;
  dataSource?: 'ECHO' | 'TRI' | 'Simulated';
  sector?: FacilitySector;  // industrial sector derived from NAICS / camdId
  naics?: string;           // primary NAICS code from ECHO
  triYears?: string[];      // Array of available reporting years if TRI facility
  hasNei2023?: boolean;     // True if facility has 2023 NEI data
}

export interface StackParameter {
  stackId: string;
  height: number;
  diameter: number;
  temp?: number;
  velocity?: number;
  flowRate?: number;
  description?: string;
  dataSource?: 'CAMD' | 'NEI' | 'Estimate' | 'User';  // where the stack data came from
  dataYear?: string;                                     // year of the source data (e.g. '2020' for NEI)
}

export interface ToxicChemical {
  name: string;
  amount: number;
  unit: string;
}

export interface EmissionRecord {
  pollutant: string;
  amount: number;
  unit: string;
  year?: number;
  emissionsType?: 'actual' | 'potential';
}

export interface HapRecord {
  pollutant: string;
  amount: number;
  unit: string;
  year?: number;
  emissionsType?: 'actual' | 'potential';
}

/**
 * Fetch HAPs (hazardous air pollutants) from TRI for a facility.
 * Uses a two-step TRI approach: TRI_REPORTING_FORM → TRI_FORM_R joined by doc_ctrl_num.
 * @param registryId - ECHO/FRS registry ID
 * @param triId - TRI facility ID (e.g. "58516KYZDT16BNK") — pass undefined if not a TRI reporter
 * @param targetYear - The desired reporting year to filter by
 */
export async function fetchHaps(
  registryId: string,
  triId?: string,
  targetYear?: string
): Promise<{ haps: HapRecord[]; year: string | number | null; availableYears?: string[]; historicalHaps?: Record<string, HapRecord[]>; isTRIReporter: boolean; isSimulated: boolean }> {
  try {
    const params = new URLSearchParams({ registryId });
    if (triId && triId !== 'None') params.set('triId', triId);
    if (targetYear) params.set('year', targetYear);

    const res = await fetch(`/api/haps?${params}`);
    if (!res.ok) return { haps: [], year: null, isTRIReporter: false, isSimulated: false };
    return await res.json();
  } catch (err) {
    console.error('HAPs Service Error:', err);
    return { haps: [], year: null, isTRIReporter: false, isSimulated: false };
  }
}

/**
 * Fetch facilities for a given US state using ECHO (with TRI fallback)
 */
export async function fetchFacilitiesByState(state: string): Promise<Facility[]> {
  try {
    const res = await fetch(`/api/facilities?state=${state}`);
    if (!res.ok) throw new Error('Failed to fetch from local API');
    return await res.json();
  } catch (err) {
    console.error('Data Service Error:', err);
    return [];
  }
}



/**
 * Fetch Criteria Pollutant emissions for PSD modeling.
 * For EGUs (power plants), uses CAMPD annual CEMS data via camdId (ORIS code).
 * For general industrial facilities, no public REST API provides this data —
 * returns empty (EIS_ANNUAL_EMISSIONS via efservice returns 404 as of Feb 2026).
 * @param registryId - ECHO/FRS registry ID
 * @param camdId - ORIS plant code for EGUs (from ECHO CamdIDs field)
 */
export async function fetchEmissions(
  registryId: string,
  camdId?: string
): Promise<{ 
  emissions: EmissionRecord[]; 
  year: number | null; 
  isSimulated: boolean; 
  source?: string | null;
  historicalEmissions?: Record<string, EmissionRecord[]>;
}> {
  try {
    const params = new URLSearchParams({ registryId });
    if (camdId) params.set('camdId', camdId);
    const res = await fetch(`/api/emissions?${params}`);
    if (!res.ok) return { emissions: [], year: null, isSimulated: false, source: null };
    return await res.json();
  } catch (err) {
    console.error('Emissions Service Error:', err);
    return { emissions: [], year: null, isSimulated: false, source: null };
  }
}



/**
 * Filter facilities by distance from a center point (in Miles)
 */
export function filterByRadius(facilities: Facility[], centerLat: number, centerLon: number, radiusMiles: number): Facility[] {
  if (isNaN(centerLat) || isNaN(centerLon)) return [];
  const center = turf.point([centerLon, centerLat]);

  const filtered = facilities
    .filter(f => !isNaN(f.lat) && !isNaN(f.lon) && f.lat !== 0)
    .map(f => {
      try {
        const p = turf.point([f.lon, f.lat]);
        const distance = turf.distance(center, p, { units: 'miles' });
        return { ...f, distance };
      } catch {
        return { ...f, distance: 999999 };
      }
    })
    .filter(f => f.distance! <= radiusMiles)
    .sort((a, b) => a.distance! - b.distance!);

  return filtered;
}

// ─── NEI 2020 types ────────────────────────────────────────────────────────

export interface NeiEmissionRecord {
  pollutant: string;
  amount: number;
  unit: string;
}

export interface NeiCountyEmission {
  pollutant: string;
  total?: number;
  point?: number;
  nonpoint?: number;
  onroad?: number;
  nonroad?: number;
}

export interface NeiFacilityData {
  found: boolean;
  facilityName?: string | null;
  county?: string | null;
  fips?: string | null;
  naics?: string | null;
  emissions: NeiEmissionRecord[];  // criteria air pollutants (CAP)
  haps: NeiEmissionRecord[];       // hazardous air pollutants (HAP)
  year?: number;
  source?: string;
}

export interface NeiCountyData {
  found: boolean;
  fips?: string;
  county?: string;
  state?: string;
  emissions: NeiCountyEmission[];
  year?: number;
  source?: string;
}

/**
 * Fetch 2020 NEI facility emissions from ArcGIS FeatureServer by EIS Facility ID.
 * Returns criteria air pollutants (SO₂, NOₓ, PM₂.₅, CO, VOC, etc.) and top HAPs.
 * @param eisId — NEI/EIS facility ID (from ECHO EisIDs field)
 */
export async function fetchNeiFacility(eisId: string, year: string = '2023'): Promise<NeiFacilityData> {
  try {
    const res = await fetch(`/api/nei-facility?eisId=${encodeURIComponent(eisId)}&year=${year}`);
    if (!res.ok) return { found: false, emissions: [], haps: [] };
    return await res.json();
  } catch (err) {
    console.error('NEI facility fetch error:', err);
    return { found: false, emissions: [], haps: [] };
  }
}

/**
 * Fetch 2020 NEI county-level emissions from ArcGIS FeatureServer.
 * Resolves lat/lon → FIPS via Census geocoder, then queries county totals.
 * @param lat — project latitude
 * @param lon — project longitude
 */
export async function fetchNeiCounty(lat: number, lon: number): Promise<NeiCountyData> {
  try {
    const res = await fetch(`/api/nei-county?lat=${lat}&lon=${lon}`);
    if (!res.ok) return { found: false, emissions: [] };
    return await res.json();
  } catch (err) {
    console.error('NEI county fetch error:', err);
    return { found: false, emissions: [] };
  }
}

/**
 * Fetch Stack Parameters (EIS Release Points) for a facility
 */
export async function fetchStackParameters(facilityId: string): Promise<StackParameter[]> {
  try {
    const res = await fetch(`/api/stacks?registryId=${facilityId}`);
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.error('Stack Service Error:', err);
    return [];
  }
}

// ─── AQS Monitoring types ──────────────────────────────────────────────────

export interface AqsMonitor {
  id: string; // state_code + county_code + site_number
  name?: string;
  address?: string;
  city?: string;
  county: string;
  lat: number;
  lon: number;
  distance?: number;
  pollutants?: string[]; // List of parameters monitored at this site
  local_site_name?: string;
}

export interface AqsSample {
  parameter_name: string;
  parameter_code: string;
  sample_measurement: number;
  units_of_measure: string;
  date_local: string;
  time_local: string;
  method_type: string;
  duration_description?: string;
  sample_duration?: string;
}

/**
 * Fetch AQS monitoring sites for a state
 */
export async function fetchAqsMonitors(state: string, refresh: boolean = false): Promise<AqsMonitor[]> {
  try {
    const params = new URLSearchParams({ state, mode: 'monitors' });
    if (refresh) params.set('refresh', 'true');
    const res = await fetch(`/api/aqs-monitors?${params.toString()}`);
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.error('AQS Monitors fetch error:', err);
    return [];
  }
}



/**
 * Helper to find the nearest AQS monitor to a given point
 */
// ─── NAAQS Design Value types ─────────────────────────────────────────────

export interface NaaqsDesignValue {
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

export interface NaaqsCompleteness {
  siteId: string;
  siteName: string;
  pollutant: string;
  year: number;
  quarter: number;
  observationPct: number;
  sufficient: boolean;
}

export interface NaaqsTrend {
  siteId: string;
  siteName: string;
  pollutant: string;
  metric: string;
  year: number;
  value: number;
  naaqs: number;
  units: string;
}

export interface NaaqsResult {
  designValues: NaaqsDesignValue[];
  trends: NaaqsTrend[];
  completeness: NaaqsCompleteness[];
  state: string;
  endYear: number;
  latestYear?: number;
}

/**
 * Fetch NAAQS design values for a state
 */
export async function fetchNaaqsDesignValues(state: string, endYear?: number): Promise<NaaqsResult> {
  try {
    const url = endYear !== undefined ? `/api/naaqs?state=${state}&endYear=${endYear}` : `/api/naaqs?state=${state}`;
    const res = await fetch(url);
    if (!res.ok) return { designValues: [], trends: [], completeness: [], state, endYear: endYear || 2024 };
    return await res.json();
  } catch (err) {
    console.error('NAAQS fetch error:', err);
    return { designValues: [], trends: [], completeness: [], state, endYear: endYear || 2024 };
  }
}

export function getNearestMonitor(lat: number, lon: number, monitors: AqsMonitor[]): { monitor: AqsMonitor; distance: number } | null {
  if (!monitors || monitors.length === 0) return null;
  const center = turf.point([lon, lat]);
  
  let nearest = null;
  let minDistance = Infinity;

  monitors.forEach(m => {
    try {
      const p = turf.point([m.lon, m.lat]);
      const d = turf.distance(center, p, { units: 'miles' });
      if (d < minDistance) {
        minDistance = d;
        nearest = m;
      }
    } catch {
      // Skip invalid points
    }
  });

  return nearest ? { monitor: nearest, distance: minDistance } : null;
}
