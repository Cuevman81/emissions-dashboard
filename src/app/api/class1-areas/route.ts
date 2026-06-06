import { NextResponse } from 'next/server';
import type { FeatureCollection } from 'geojson';

// In-memory cache — Class I boundaries are static; avoids re-hitting APIs on every toggle
let cachedGeoJson: FeatureCollection | null = null;

// This EPA OAQPS endpoint explicitly charts all 156 Mandatory Class I Federal Areas 
// (including US Forest Service and US Fish & Wildlife Service locations like Breton).
const EPA_CLASS1_BASE =
  'https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services' +
  '/Mandatory_Class1_Federal_Areas/FeatureServer/0/query';

const EPA_PARAMS = (offset: number) =>
  `?where=1%3D1` +
  `&outFields=NAME,STATE,AGENCY` +
  `&returnGeometry=true&geometryPrecision=3&outSR=4326` +
  `&resultRecordCount=200&resultOffset=${offset}&f=geojson`;

async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

function parseAgency(code: string) {
  switch (code) {
    case 'USDI-NPS': return 'National Park Service';
    case 'USDA-FS': return 'US Forest Service';
    case 'USDI-FWS': return 'Fish & Wildlife Service';
    case 'BIA': return 'Bureau of Indian Affairs';
    default: return code || 'Federal Agency';
  }
}

export async function GET() {
  if (cachedGeoJson) {
    return NextResponse.json(cachedGeoJson);
  }

  const combined: FeatureCollection = { type: 'FeatureCollection', features: [] };

  try {
    let offset = 0;
    let keepFetching = true;
    while (keepFetching) {
      const res = await fetchWithTimeout(EPA_CLASS1_BASE + EPA_PARAMS(offset));
      if (!res.ok) break;
      const data: FeatureCollection = await res.json();
      const features = data?.features ?? [];

      const tagged = features.map(f => ({
        ...f,
        properties: {
          ...f.properties,
          _type: parseAgency(f.properties?.AGENCY),
          _displayName: f.properties?.NAME ?? 'Federal Class I Area',
          _state: f.properties?.STATE ?? '',
        },
      }));

      combined.features.push(...tagged);

      // Stop paging when we receive fewer than we requested
      keepFetching = features.length === 200;
      offset += 200;
    }
    console.log(`Class I: EPA Official endpoint loaded ${combined.features.length} features`);
  } catch (err) {
    console.warn('Class I: EPA fetch failed:', err instanceof Error ? err.message : err);
  }

  if (combined.features.length > 0) {
    cachedGeoJson = combined;
  }

  return NextResponse.json(combined);
}
