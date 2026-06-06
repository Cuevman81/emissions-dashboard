import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const ECHO_BASE = 'https://echodata.epa.gov/echo';

// ECHO air_rest_services field names (from actual API response)
interface EchoFacility {
  RegistryID?: string;
  AIRName?: string;       // facility name
  AIRStreet?: string;
  AIRCity?: string;
  AIRState?: string;
  AIRZip?: string;
  FacLat?: string;
  FacLong?: string;       // NOTE: longitude is "FacLong" not "FacLon"
  AIRUniverse?: string;   // e.g. "Major", "Synthetic Minor", "Minor Emissions"
  AIRClassification?: string;
  AIRHpvStatus?: string;  // e.g. "No High Priority Violation" / "High Priority Violation"
  TRIIDs?: string;
  CamdIDs?: string;       // ORIS plant code — non-null means EGU with CEMS data in CAMPD
  EisIDs?: string;        // NEI/EIS facility ID
  FacNaics?: string;      // Primary NAICS code
  FacPrimaryNaicsCode?: string; // alternate field name used by some ECHO responses
  [key: string]: string | undefined;
}

type FacilitySector = 'Power Plant' | 'Refinery' | 'Chemical' | 'Cement' | 'Paper/Pulp' | 'Steel' | 'Other';

function deriveSector(camdId: string | null, naics: string | undefined): FacilitySector {
  // CAMPD ORIS code is the definitive indicator of an EGU/power plant
  if (camdId) return 'Power Plant';
  if (!naics) return 'Other';
  const n = naics.trim();
  if (n.startsWith('2211')) return 'Power Plant';         // electric power generation
  if (n.startsWith('3241')) return 'Refinery';            // petroleum & coal products
  if (n.startsWith('325')) return 'Chemical';            // chemical manufacturing
  if (n.startsWith('3273') || n.startsWith('3272')) return 'Cement'; // cement & concrete
  if (n.startsWith('3221') || n.startsWith('3222')) return 'Paper/Pulp'; // paper mills
  if (n.startsWith('3311') || n.startsWith('3312')) return 'Steel'; // iron & steel
  return 'Other';
}

function normalizePermitType(raw: string | undefined): 'Major' | 'Synthetic Minor' | 'Federally Reportable Minor' | 'Other' {
  if (!raw) return 'Other';
  const t = raw.toLowerCase();
  if (t.includes('major')) return 'Major';
  if (t.includes('synthetic')) return 'Synthetic Minor';
  if (t.includes('federally') || t.includes('minor emissions') || t.includes('reportable')) return 'Federally Reportable Minor';
  return 'Other';
}

function extractFirstTRIId(triIds: string | undefined): string | null {
  if (!triIds || triIds === 'None' || triIds === '' || triIds === 'null') return null;
  return triIds.split(',')[0].trim() || null;
}

function parseEchoFacilities(raw: EchoFacility[], state: string) {
  const seenIds = new Set<string>();
  return raw
    .map(f => {
      const lat = parseFloat(f.FacLat || '0');
      const lon = parseFloat(f.FacLong || '0'); // NOTE: field is FacLong, not FacLon
      const id = f.RegistryID || '';
      if (!id || !lat || !lon || isNaN(lat) || isNaN(lon) || lat === 0 || seenIds.has(id)) return null;
      seenIds.add(id);

      // Permit classification comes from AIRUniverse or AIRClassification
      const classification = f.AIRUniverse || f.AIRClassification || '';
      const permitType = normalizePermitType(classification);
      const isMajor = classification.toLowerCase().includes('major');
      const hasHpv = (f.AIRHpvStatus || '').toLowerCase().includes('high priority violation') &&
        !(f.AIRHpvStatus || '').toLowerCase().includes('no high priority');

      const camdId = f.CamdIDs && f.CamdIDs !== 'null' && f.CamdIDs !== 'None'
        ? f.CamdIDs.split(',')[0].trim() : null;
      const eisId = f.EisIDs && f.EisIDs !== 'null' && f.EisIDs !== 'None'
        ? f.EisIDs.split(',')[0].trim() : null;

      const naics = f.FacNaics || f.FacPrimaryNaicsCode || '';
      const sector = deriveSector(camdId, naics);

      return {
        id,
        triId: extractFirstTRIId(f.TRIIDs),
        camdId,   // ORIS code — present for EGU/power plants
        eisId,    // NEI/EIS facility ID
        name: f.AIRName || 'Unknown Facility',
        address: f.AIRStreet || '',
        city: f.AIRCity || '',
        state: f.AIRState || state,
        zip: f.AIRZip || '',
        lat,
        lon,
        permitType,
        isMajor,
        hasHpv,
        dataSource: 'ECHO' as const,
        naics,
        sector,
      };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);
}

const CACHE_DIR = path.join(process.cwd(), 'src', 'cache');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

async function fetchFromECHO(state: string) {
  // Step 1: Initiate ECHO air facility search to get QueryID
  const searchUrl = `${ECHO_BASE}/air_rest_services.get_facilities?p_st=${state}&p_act=Y&output=JSON`;
  
  console.log(`[ECHO API] Starting search for ${state}...`);
  const searchRes = await fetch(searchUrl, {
    signal: AbortSignal.timeout(45000), // Increased to 45s
    headers: { 'Accept': 'application/json' },
  });
  if (!searchRes.ok) throw new Error(`ECHO search: ${searchRes.status}`);

  const searchData = await searchRes.json();
  const results = searchData?.Results;
  if (!results) throw new Error('Unexpected ECHO response shape');

  // Some responses return facilities directly (small result sets)
  if (Array.isArray(results.Facilities) && results.Facilities.length > 0) {
    return results.Facilities as EchoFacility[];
  }

  // Otherwise paginate with QID
  const queryId = results.QueryID;
  if (!queryId) throw new Error('No QueryID in ECHO response');

  const totalFound = parseInt(results.TotalFacilitiesFound || results.QueryRows || '0');
  if (totalFound === 0) return [];

  const allFacilities: EchoFacility[] = [];
  const perPage = 1000;
  const maxPages = Math.min(Math.ceil(totalFound / perPage), 5); // cap at 5000 facilities

  console.log(`[ECHO API] Paginating ${totalFound} facilities via QID: ${queryId}`);

  for (let page = 1; page <= maxPages; page++) {
    const qidUrl = `${ECHO_BASE}/air_rest_services.get_qid?qid=${queryId}&pageno=${page}&numrows=${perPage}&output=JSON`;
    const qidRes = await fetch(qidUrl, {
      signal: AbortSignal.timeout(30000), // Increased to 30s per page
      headers: { 'Accept': 'application/json' },
    });
    if (!qidRes.ok) break;

    const qidData = await qidRes.json();
    const facilities = qidData?.Results?.Facilities || qidData?.Results?.Results || [];
    if (!Array.isArray(facilities) || facilities.length === 0) break;
    allFacilities.push(...facilities);
  }

  return allFacilities;
}

async function fetchTRIFallback(state: string) {
  const url = `https://data.epa.gov/efservice/TRI_FACILITY/STATE_ABBR/${state}/1:500`;
  try {
    console.log(`[TRI API] Falling back to Envirofacts for ${state}...`);
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) }); // Increased to 30s
    if (!res.ok) throw new Error(`TRI API: ${res.status}`);

    const xml = await res.text();
    const facilities = [];
    const seenIds = new Set<string>();

    const facilityBlocks = xml.split('<tri_facility>');
    for (let i = 1; i < facilityBlocks.length; i++) {
      const block = facilityBlocks[i];
      const getValue = (tag: string) => {
        const start = block.indexOf(`<${tag}>`);
        if (start === -1) return null;
        const end = block.indexOf(`</${tag}>`, start);
        if (end === -1) return null;
        return block.substring(start + tag.length + 2, end).trim();
      };

      const id = getValue('EPA_REGISTRY_ID') || getValue('TRI_FACILITY_ID');
      if (!id || seenIds.has(id)) continue;

      let lat = 0, lon = 0;
      const pLat = getValue('PREF_LATITUDE'), pLon = getValue('PREF_LONGITUDE');
      const fLat = getValue('FAC_LATITUDE'), fLon = getValue('FAC_LONGITUDE');

      if (pLat && pLat !== 'None' && pLat !== '0') { lat = parseFloat(pLat); lon = parseFloat(pLon || '0'); }
      else if (fLat && fLat !== 'None' && fLat !== '0') { lat = parseFloat(fLat); lon = parseFloat(fLon || '0'); }

      if (lat && lon && !isNaN(lat) && !isNaN(lon) && lat !== 0) {
        if (lat > 1000) {
          const d = Math.floor(lat / 10000), m = Math.floor((lat % 10000) / 100), s = lat % 100;
          lat = d + m / 60 + s / 3600;
          const aLon = Math.abs(lon);
          const d2 = Math.floor(aLon / 10000), m2 = Math.floor((aLon % 10000) / 100), s2 = aLon % 100;
          lon = -(d2 + m2 / 60 + s2 / 3600);
        }
        seenIds.add(id);
        facilities.push({
          id,
          triId: getValue('TRI_FACILITY_ID'),
          name: getValue('FACILITY_NAME') || 'Unknown Facility',
          address: getValue('STREET_ADDRESS') || '',
          city: getValue('CITY_NAME') || '',
          state,
          zip: getValue('ZIP_CODE') || '',
          lat,
          lon,
          permitType: 'Other' as const,
          isMajor: false,
          hasHpv: false,
          dataSource: 'TRI' as const,
          sector: 'Other'
        });
      }
    }
    return facilities;
  } catch (triErr: any) {
    console.error('TRI fallback also failed:', triErr.message);
    return [];
  }
}

function mergeLocalTriFacilities(facilities: any[], state: string) {
  try {
    const jsonPath = path.join(process.cwd(), 'src', 'lib', 'tri_facilities.json');
    if (!fs.existsSync(jsonPath)) return facilities;

    const fileData = fs.readFileSync(jsonPath, 'utf8');
    const localFacilities = JSON.parse(fileData);

    const existingTriIds = new Set(
      facilities.map(f => f.triId).filter(Boolean)
    );

    const newFacilities = localFacilities.filter((f: any) =>
      f.state === state && !existingTriIds.has(f.triId)
    );

    if (newFacilities.length > 0) {
       console.log(`Merged ${newFacilities.length} local TRI facilities for ${state}.`);
    }
    return [...facilities, ...newFacilities];
  } catch (err) {
    console.error('Error merging local TRI facilities:', err);
    return facilities;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const state = (searchParams.get('state') || 'MS').toUpperCase();
  const cachePath = path.join(CACHE_DIR, `facilities_${state}.json`);

  try {
    // 1. Try Cache First
    if (fs.existsSync(cachePath)) {
      const stats = fs.statSync(cachePath);
      const isFresh = Date.now() - stats.mtimeMs < CACHE_TTL;
      
      if (isFresh) {
        console.log(`[Cache] Loading ${state} facilities from disk...`);
        const cachedData = fs.readFileSync(cachePath, 'utf8');
        return NextResponse.json(JSON.parse(cachedData));
      }
      console.log(`[Cache] Found stale cache for ${state}, attempting refresh...`);
    }

    let facilities: any[] = [];
    let success = false;

    // 2. Fetch from EPA (with relaxed timeouts)
    try {
      const raw = await fetchFromECHO(state);
      facilities = parseEchoFacilities(raw, state);
      console.log(`ECHO Success: ${facilities.length} facilities in ${state}`);
      success = true;
    } catch (err: any) {
      console.warn(`ECHO Failed: ${err.message}. Using TRI fallback.`);
      facilities = await fetchTRIFallback(state);
      if (facilities.length > 0) success = true;
    }

    // 3. Supplement with local CSV facilities
    facilities = mergeLocalTriFacilities(facilities, state);

    // 4. Attach triYears historical availability
    const emissionsPath = path.join(process.cwd(), 'src', 'lib', 'tri_emissions.json');
    if (fs.existsSync(emissionsPath)) {
      const emissionsData = JSON.parse(fs.readFileSync(emissionsPath, 'utf8'));
      facilities.forEach(f => {
        if (f.triId && emissionsData[f.triId]) {
          f.triYears = Object.keys(emissionsData[f.triId].years).sort((a, b) => parseInt(b) - parseInt(a));
        }
      });
    }

    // 5. Save to cache if we got anything useful
    if (success && facilities.length > 0) {
       console.log(`[Cache] Saving ${facilities.length} records to ${state} facility cache.`);
       fs.writeFileSync(cachePath, JSON.stringify(facilities), 'utf8');
    } else if (fs.existsSync(cachePath)) {
       console.warn(`[Cache] Falling back to stale cache due to EPA failure.`);
       const staleData = fs.readFileSync(cachePath, 'utf8');
       return NextResponse.json(JSON.parse(staleData));
    }

    return NextResponse.json(facilities);
  } catch (err: any) {
    console.error('Facilities fetch completely failed:', err);
    // Ultimate fallback: return empty or check if cache exists regardless of age
    if (fs.existsSync(cachePath)) {
       const staleData = fs.readFileSync(cachePath, 'utf8');
       return NextResponse.json(JSON.parse(staleData));
    }
    return NextResponse.json([]);
  }
}

