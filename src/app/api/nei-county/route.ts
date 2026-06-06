import { NextResponse } from 'next/server';

/**
 * NEI 2020 County-Level Emissions — ArcGIS FeatureServer
 * Published by EPA OAR/OAQPS (March 2023)
 * Returns county totals broken down by source category.
 *
 * Step 1: lat/lon → FIPS via Census Bureau geocoder
 * Step 2: FIPS → NEI county record via ArcGIS FeatureServer
 */
const COUNTY_SERVICE =
  'https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/NEI_2020_for_County_Level_Emissions_US_EPA_OAR_OAQPS/FeatureServer/0';

interface ArcGISField {
  name: string;
  alias: string;
  type: string;
}

type SourceCategory = 'Total' | 'Point' | 'Nonpoint' | 'Nonroad' | 'Onroad';

let countyFieldCache: ArcGISField[] | null = null;

async function getCountyFields(): Promise<ArcGISField[]> {
  if (countyFieldCache) return countyFieldCache;
  try {
    const res = await fetch(`${COUNTY_SERVICE}?f=json`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    countyFieldCache = (data.fields as ArcGISField[]) ?? [];
    return countyFieldCache;
  } catch {
    return [];
  }
}

/** Census Bureau reverse geocode: lat/lon → FIPS + county name */
async function latLonToFips(
  lat: number,
  lon: number
): Promise<{ fips: string; county: string; stateFips: string } | null> {
  try {
    const url =
      `https://geocoding.geo.census.gov/geocoder/geographies/coordinates` +
      `?x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const counties = data?.result?.geographies?.Counties as Array<Record<string, string>>;
    if (!counties?.length) return null;
    const c = counties[0];
    return {
      fips: c.STATE + c.COUNTY,        // 5-digit FIPS
      county: c.NAME ?? '',
      stateFips: c.STATE ?? '',
    };
  } catch {
    return null;
  }
}

function getSourceCategory(alias: string): SourceCategory | null {
  const a = alias.toLowerCase();
  // Order matters: check 'nonpoint' before 'point', 'nonroad' before 'road'
  // Aliases may use ' - Category', ' | CATEGORY', or ' Category' suffix patterns
  if (/\|\s*total/i.test(a) || /[-–]\s*total/i.test(a) || a.endsWith('total')) return 'Total';
  if (/\|\s*nonpoint/i.test(a) || /[-–]\s*nonpoint/i.test(a) || a.includes('area source')) return 'Nonpoint';
  if (/\|\s*nonroad/i.test(a) || /[-–]\s*nonroad/i.test(a)) return 'Nonroad';
  if (/\|\s*onroad/i.test(a) || /[-–]\s*onroad/i.test(a)) return 'Onroad';
  if (/\|\s*point/i.test(a) || /[-–]\s*point/i.test(a)) return 'Point';
  return null;
}

function aliasToDisplayName(alias: string): string {
  return alias
    .replace(/^CAP:\s*/i, '')
    // strip source-category suffixes whether separated by –, -, or |
    .replace(/\s*[-–|]\s*(Total|Point|Nonpoint|Nonroad|Onroad|Area Source).*/i, '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function fieldNameFallback(name: string): string {
  return name
    .replace(/^CAP__/i, '')
    .replace(/__.*$/, '')
    .replace(/_/g, ' ')
    .trim();
}

export interface CountyEmissionRow {
  pollutant: string;
  total?: number;
  point?: number;
  nonpoint?: number;
  nonroad?: number;
  onroad?: number;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const latParam = searchParams.get('lat');
  const lonParam = searchParams.get('lon');
  let fips = searchParams.get('fips');
  let county = '';
  let stateName = '';

  // Step 1: resolve FIPS if not provided directly
  if (!fips && latParam && lonParam) {
    const geo = await latLonToFips(parseFloat(latParam), parseFloat(lonParam));
    if (!geo) {
      return NextResponse.json({ found: false, emissions: [] });
    }
    fips = geo.fips;
    county = geo.county;
  }

  if (!fips) {
    return NextResponse.json({ found: false, emissions: [] }, { status: 400 });
  }

  try {
    // Step 2: fetch layer metadata + county record in parallel
    const fipsPadded = fips.padStart(5, '0');

    const [fields, queryRes] = await Promise.all([
      getCountyFields(),
      fetch(
        `${COUNTY_SERVICE}/query?where=FIPS_Code='${fipsPadded}'&outFields=*&resultRecordCount=1&f=json`,
        { signal: AbortSignal.timeout(12000) }
      ),
    ]);

    if (!queryRes.ok) throw new Error(`ArcGIS county returned ${queryRes.status}`);
    const data = await queryRes.json();

    if (!data.features?.length) {
      return NextResponse.json({ found: false, fips: fipsPadded, county, emissions: [] });
    }

    const attrs = data.features[0].attributes as Record<string, unknown>;
    county = (attrs.County as string) || county;
    stateName = (attrs.State as string) || stateName;

    const aliasMap = new Map(fields.map(f => [f.name, f.alias]));

    // Group numeric CAP fields by pollutant name × source category
    const groups = new Map<string, CountyEmissionRow>();

    for (const [key, value] of Object.entries(attrs)) {
      if (typeof value !== 'number' || value < 0) continue;
      if (!key.toUpperCase().startsWith('CAP__')) continue;

      const alias = aliasMap.get(key) ?? '';
      const category = getSourceCategory(alias);
      if (!category) continue;

      const pollutant = alias ? aliasToDisplayName(alias) : fieldNameFallback(key);
      if (!pollutant || pollutant.length < 2) continue;

      if (!groups.has(pollutant)) groups.set(pollutant, { pollutant });
      const row = groups.get(pollutant)!;

      if (category === 'Total') row.total = value;
      else if (category === 'Point') row.point = value;
      else if (category === 'Nonpoint') row.nonpoint = value;
      else if (category === 'Onroad') row.onroad = value;
      else if (category === 'Nonroad') row.nonroad = value;
    }

    // Keep only rows that have a total > 0, sorted descending by total
    const emissions: CountyEmissionRow[] = Array.from(groups.values())
      .filter(r => (r.total ?? 0) > 0)
      .sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
      .slice(0, 10);

    // Round values for readability
    const rounded = emissions.map(r => ({
      pollutant: r.pollutant,
      total: r.total != null ? Math.round(r.total) : undefined,
      point: r.point != null ? Math.round(r.point) : undefined,
      nonpoint: r.nonpoint != null ? Math.round(r.nonpoint) : undefined,
      onroad: r.onroad != null ? Math.round(r.onroad) : undefined,
      nonroad: r.nonroad != null ? Math.round(r.nonroad) : undefined,
    }));

    console.log(`NEI2020 county ${fipsPadded} (${county}): ${rounded.length} pollutants returned`);

    return NextResponse.json({
      found: true,
      fips: fipsPadded,
      county,
      state: stateName,
      emissions: rounded,
      year: 2020,
      source: 'NEI 2020',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('NEI county route error:', msg);
    return NextResponse.json({ found: false, fips, county, emissions: [], error: msg });
  }
}
