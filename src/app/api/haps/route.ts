import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// TRI Two-Step Approach for HAP Air Releases
//
// Step 1: TRI_REPORTING_FORM — one record per facility × chemical × year
//   Filter by TRI_FACILITY_ID → get list of (doc_ctrl_num, cas_chem_name, reporting_year)
//
// Step 2: TRI_FORM_R — one record per doc_ctrl_num (one Form R filing)
//   Filter by DOC_CTRL_NUM → get air_total_release (pounds, stack + fugitive combined)
//
// Convert: lbs ÷ 2000 = short tons
// TRI Form R always reports ACTUAL releases (not PTE)

interface TRIFormRecord {
  doc_ctrl_num?: string;
  cas_chem_name?: string;
  reporting_year?: string;
  [key: string]: string | undefined;
}

interface TRIFormRRecord {
  doc_ctrl_num?: string;
  air_total_release?: string | number;
  stack_tot_rel?: string | number;
  fugitive_tot_rel?: string | number;
  [key: string]: string | number | undefined;
}

function getLocalTriEmissions(triId: string, requestedYear: string | null) {
  try {
    const jsonPath = path.join(process.cwd(), 'src', 'lib', 'tri_emissions.json');
    if (fs.existsSync(jsonPath)) {
      const fileData = fs.readFileSync(jsonPath, 'utf8');
      const localEmissions = JSON.parse(fileData);
      const facilityData = localEmissions[triId];
      if (facilityData) {
        // If a specific year is requested but is not in our local JSON data,
        // return null to force checking the live EPA API (e.g. for new reporting years like 2025).
        if (requestedYear && !facilityData.years[requestedYear]) {
          console.log(`Requested year ${requestedYear} not found locally for ${triId}, checking live EPA API...`);
          return null;
        }

        const targetYear = requestedYear && facilityData.years[requestedYear]
          ? requestedYear
          : facilityData.latestYear.toString();

        const hapsForYear = facilityData.years[targetYear] || [];

        console.log(`Loaded TRI data internally for ${triId} (Year: ${targetYear})`);
        return {
          haps: hapsForYear,
          year: targetYear,
          availableYears: Object.keys(facilityData.years).sort((a, b) => parseInt(b) - parseInt(a)),
          historicalHaps: facilityData.years,
          isTRIReporter: true,
          isSimulated: false,
          source: facilityData.source
        };
      }
    }
  } catch (err) {
    console.error('Error reading local TRI emissions:', err);
  }
  return null;
}

const CACHE_DIR = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), 'src', 'cache');
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

try {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
} catch (err) {
  console.warn('[Cache] Failed to ensure cache directory exists:', err);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const triId = searchParams.get('triId') || '';
  const yearParam = searchParams.get('year');

  // No TRI ID = facility is not a TRI reporter
  if (!triId || triId === 'None' || triId === 'null') {
    return NextResponse.json({ haps: [], year: null, isTRIReporter: false, isSimulated: false });
  }

  // First attempt to load out of our fast local JSON store
  const localData = getLocalTriEmissions(triId, yearParam);
  if (localData) {
    return NextResponse.json(localData);
  }

  // Try cache lookup for live fallback
  const cacheKey = `haps_${triId}_${yearParam || 'latest'}.json`;
  const cachePath = path.join(CACHE_DIR, cacheKey);

  if (fs.existsSync(cachePath)) {
    const stats = fs.statSync(cachePath);
    if (Date.now() - stats.mtimeMs < CACHE_TTL) {
      console.log(`[Cache] Loading haps fallback for ${triId} from disk...`);
      const cachedData = fs.readFileSync(cachePath, 'utf8');
      return NextResponse.json(JSON.parse(cachedData));
    }
  }

  // Fallback to the slow, 2-step ECHO API
  try {
    // ── Step 1: Get all chemicals reported by this facility ──────────────────
    const step1Url = `https://data.epa.gov/efservice/TRI_REPORTING_FORM/TRI_FACILITY_ID/equals/${encodeURIComponent(triId)}/JSON`;
    const step1Res = await fetch(step1Url, { signal: AbortSignal.timeout(12000) });

    if (!step1Res.ok) {
      return NextResponse.json({ haps: [], year: null, isTRIReporter: true, isSimulated: false });
    }

    const step1Data: TRIFormRecord[] = await step1Res.json();

    if (!Array.isArray(step1Data) || step1Data.length === 0) {
      return NextResponse.json({ haps: [], year: null, isTRIReporter: true, isSimulated: false });
    }

    // Filter to most recent reporting year
    let maxYear = 0;
    for (const r of step1Data) {
      const y = parseInt(r.reporting_year || '0');
      if (y > maxYear) maxYear = y;
    }

    const latestRecords = step1Data.filter(r => parseInt(r.reporting_year || '0') === maxYear);

    // Build a map: doc_ctrl_num → chemical name
    const chemMap: Record<string, string> = {};
    for (const r of latestRecords) {
      if (r.doc_ctrl_num && r.cas_chem_name) {
        chemMap[r.doc_ctrl_num] = r.cas_chem_name;
      }
    }

    const docCtrlNums = Object.keys(chemMap);
    if (docCtrlNums.length === 0) {
      return NextResponse.json({ haps: [], year: maxYear, isTRIReporter: true, isSimulated: false });
    }

    // ── Step 2: Fetch air release quantities for each Form R in parallel ────
    const step2Results = await Promise.all(
      docCtrlNums.map(async (dcn) => {
        try {
          const url = `https://data.epa.gov/efservice/TRI_FORM_R/DOC_CTRL_NUM/equals/${encodeURIComponent(dcn)}/JSON`;
          const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) return { dcn, airRelease: 0 };
          const data: TRIFormRRecord[] = await res.json();
          if (!Array.isArray(data) || data.length === 0) return { dcn, airRelease: 0 };
          // Sum across any multiple records for this doc_ctrl_num
          const total = data.reduce((sum, row) => sum + (parseFloat(String(row.air_total_release || 0)) || 0), 0);
          return { dcn, airRelease: total };
        } catch {
          return { dcn, airRelease: 0 };
        }
      })
    );

    // ── Combine: chemical name + air release lbs → tons ─────────────────────
    const haps = step2Results
      .filter(r => r.airRelease > 0)
      .map(r => ({
        pollutant: chemMap[r.dcn] || r.dcn,
        amount: Math.round((r.airRelease / 2000) * 10000) / 10000, // lbs → tons, 4 decimal places
        unit: 'Tons/Year',
        year: maxYear,
        emissionsType: 'actual' as const,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 40); // cap display at 40 HAPs

    const result = {
      haps,
      year: maxYear || null,
      isTRIReporter: true,
      isSimulated: false,
      source: 'TRI (EPA Live Fallback)',
    };

    try {
      fs.writeFileSync(cachePath, JSON.stringify(result), 'utf8');
      console.log(`[Cache] Saved haps fallback for ${triId} to disk.`);
    } catch (cacheErr) {
      console.error('Failed to write haps cache:', cacheErr);
    }

    return NextResponse.json(result);

  } catch {
    return NextResponse.json({ haps: [], year: null, isTRIReporter: true, isSimulated: false });
  }
}

