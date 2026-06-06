import { NextResponse } from 'next/server';

/**
 * NEI 2020 Facility Emissions — ArcGIS FeatureServer
 * Published by EPA OAR/OAQPS (March 2023)
 * Matches on EIS_Facility_ID (from ECHO CamdIDs/EisIDs fields)
 */
const FACILITY_SERVICE =
  'https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/NEI2020_Facilities_March2023/FeatureServer/0';

interface ArcGISField {
  name: string;
  alias: string;
  type: string;
}

// Process-level field cache — avoids re-fetching layer metadata on every request
let facilityFieldCache: ArcGISField[] | null = null;

async function getFacilityFields(): Promise<ArcGISField[]> {
  if (facilityFieldCache) return facilityFieldCache;
  try {
    const res = await fetch(`${FACILITY_SERVICE}?f=json`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    facilityFieldCache = (data.fields as ArcGISField[]) ?? [];
    return facilityFieldCache;
  } catch {
    return [];
  }
}

/**
 * Convert an ArcGIS field alias to a short display name.
 * Example alias: "CAP: PM2.5 Primary (Filterable + Condensable) - Tons/Year"
 * → "PM2.5 Primary"
 */
function aliasToDisplayName(alias: string): string {
  return alias
    .replace(/^(CAP|HAP|GHG):\s*/i, '')           // strip program prefix
    .replace(/\s*[-–]\s*Tons\s*\/?\s*Year.*/i, '') // strip units
    .replace(/\s*\([^)]*\)/g, '')                  // strip parentheticals
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Fallback name parser from the raw truncated field name.
 * Example: "CAP__Sulfur_Dioxide__Pollutant_1" → "Sulfur Dioxide"
 */
function fieldNameFallback(name: string): string {
  return name
    .replace(/^(CAP|HAP|GHG)__/i, '')  // strip prefix
    .replace(/__.*$/, '')               // drop everything after second __
    .replace(/_/g, ' ')
    .trim();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const eisId = searchParams.get('eisId');

  if (!eisId) {
    return NextResponse.json({ found: false, emissions: [] }, { status: 400 });
  }

  try {
    // Fetch field metadata and facility record in parallel
    const [fields, queryRes] = await Promise.all([
      getFacilityFields(),
      fetch(
        `${FACILITY_SERVICE}/query?where=EIS_Facility_ID='${encodeURIComponent(eisId)}'&outFields=*&resultRecordCount=1&f=json`,
        { signal: AbortSignal.timeout(12000) }
      ),
    ]);

    if (!queryRes.ok) throw new Error(`ArcGIS returned ${queryRes.status}`);
    const data = await queryRes.json();

    if (!data.features?.length) {
      return NextResponse.json({ found: false, emissions: [] });
    }

    const attrs = data.features[0].attributes as Record<string, unknown>;
    const aliasMap = new Map(fields.map(f => [f.name, f.alias]));

    // Collect criteria air pollutant fields (CAP__ prefix), skip zeros
    const emissions: Array<{ pollutant: string; amount: number; unit: string }> = [];

    for (const [key, value] of Object.entries(attrs)) {
      if (typeof value !== 'number' || value <= 0) continue;
      if (!key.toUpperCase().startsWith('CAP__')) continue;

      const alias = aliasMap.get(key) ?? '';
      const pollutant = alias ? aliasToDisplayName(alias) : fieldNameFallback(key);
      if (!pollutant || pollutant.length < 2) continue;

      emissions.push({
        pollutant,
        amount: Math.round(value * 100) / 100,
        unit: 'TPY',
      });
    }

    // Also collect top HAPs for Toxics reference
    const haps: Array<{ pollutant: string; amount: number; unit: string }> = [];
    for (const [key, value] of Object.entries(attrs)) {
      if (typeof value !== 'number' || value <= 0) continue;
      if (!key.toUpperCase().startsWith('HAP__')) continue;

      const alias = aliasMap.get(key) ?? '';
      const pollutant = alias ? aliasToDisplayName(alias) : fieldNameFallback(key);
      if (!pollutant || pollutant.length < 2) continue;

      haps.push({ pollutant, amount: Math.round(value * 10000) / 10000, unit: 'TPY' });
    }

    emissions.sort((a, b) => b.amount - a.amount);
    haps.sort((a, b) => b.amount - a.amount);

    console.log(`NEI2020 facility ${eisId}: ${emissions.length} CAP records, ${haps.length} HAP records`);

    return NextResponse.json({
      found: true,
      facilityName: attrs.Site_Name ?? null,
      county: attrs.County ?? null,
      fips: String(attrs.FIPS_Code ?? '').padStart(5, '0') || null,
      naics: attrs.Primary_NAICS_Code ?? null,
      emissions,   // criteria air pollutants
      haps,        // hazardous air pollutants
      year: 2020,
      source: 'NEI 2020',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('NEI facility route error:', msg);
    return NextResponse.json({ found: false, emissions: [], haps: [], error: msg });
  }
}
