import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const CACHE_DIR = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), 'src', 'cache');
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

const CAMPD_BASE = 'https://api.epa.gov/easey/emissions-mgmt/emissions/apportioned';
const TRAILING_YEARS = 6;

function campdHeaders(): HeadersInit {
  const headers: HeadersInit = { 'Accept': 'application/json' };
  const apiKey = process.env.EPA_CAMD_API_KEY || '';
  if (apiKey) headers['x-api-key'] = apiKey;
  return headers;
}

// CAMPD's "annual" endpoint returns YEAR-TO-DATE totals for a year still in
// progress (in Sept 2026 the API serves quarters only through "the quarter ending
// on 06/30/2026"), so only completed calendar years are valid annual actuals.
// Part 75 sources submit each quarter within 30 days of its end (Q4 is due Jan 30;
// CAMD's Power Sector Emissions Data Guide), so last year counts as complete only
// once CAMPD serves its Q4 data.
let lastYearQ4: { year: number; posted: boolean; checkedAt: number } | null = null;
const Q4_RECHECK_MS = 6 * 60 * 60 * 1000;

async function isYearComplete(year: number): Promise<boolean> {
  if (lastYearQ4 && lastYearQ4.year === year && (lastYearQ4.posted || Date.now() - lastYearQ4.checkedAt < Q4_RECHECK_MS)) {
    return lastYearQ4.posted;
  }
  try {
    const res = await fetch(`${CAMPD_BASE}/quarterly?year=${year}&quarter=4&page=1&perPage=1`, {
      headers: campdHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    let posted: boolean;
    if (res.ok) {
      const data = await res.json();
      const items = Array.isArray(data) ? data : data?.items;
      posted = Array.isArray(items) && items.length > 0;
    } else if (res.status === 400) {
      posted = false; // CAMPD rejects quarters after the latest one it has published
    } else {
      throw new Error(`CAMPD quarterly HTTP ${res.status}`);
    }
    lastYearQ4 = { year, posted, checkedAt: Date.now() };
    return posted;
  } catch {
    // CAMPD unreachable: assume Q4 is posted once February is over.
    return new Date() >= new Date(Date.UTC(year + 1, 2, 1));
  }
}

// CAMPD annual emissions endpoint — EGUs (power plants) only
// Fields returned: so2Mass (tons), noxMass (tons), co2Mass (short tons)
async function fetchHistoricalCamdEmissions(orisCode: string, years: number[]): Promise<Record<string, { pollutant: string; amount: number; unit: string; emissionsType: 'actual' }[]>> {
  const results: Record<string, { pollutant: string; amount: number; unit: string; emissionsType: 'actual' }[]> = {};

  await Promise.all(
    years.map(async (year) => {
      try {
        const url = `${CAMPD_BASE}/annual?facilityId=${orisCode}&year=${year}&page=1&perPage=100`;

        const res = await fetch(url, { 
          headers: campdHeaders(),
          signal: AbortSignal.timeout(8000) 
        });
        if (!res.ok) return;
        const data = await res.json();
        const records = Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : null);
        if (!records || records.length === 0) return;

        // Aggregate across all units at the plant
        const totals: Record<string, number> = {};
        for (const record of records) {
          if (record.so2Mass && Number(record.so2Mass) > 0) totals['SO2'] = (totals['SO2'] || 0) + Number(record.so2Mass);
          if (record.noxMass && Number(record.noxMass) > 0) totals['NOX'] = (totals['NOX'] || 0) + Number(record.noxMass);
          if (record.co2Mass && Number(record.co2Mass) > 0) totals['CO2'] = (totals['CO2'] || 0) + Number(record.co2Mass);
        }

        const emissions = Object.entries(totals)
          .filter(([, amt]) => amt > 0)
          .map(([pollutant, amount]) => ({
            pollutant,
            amount: Math.round(amount * 10) / 10,
            unit: 'Tons/Year',
            emissionsType: 'actual' as const,
          }))
          .sort((a, b) => b.amount - a.amount);

        if (emissions.length > 0) {
          results[year] = emissions;
        }
      } catch {
        // try next year
      }
    })
  );

  return results;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const registryId = searchParams.get('registryId') || 'unknown';
  const camdIdRaw = searchParams.get('camdId') || '';
  // ORIS codes are numeric — validate before using in URLs and file paths
  const camdId = /^\d+$/.test(camdIdRaw) ? camdIdRaw : '';

  // EGU path — real CEMS data from CAMPD
  if (camdId) {
    // 1. Check cache first (v2: older cache files hold year-to-date totals as the newest year)
    const cacheKey = `emissions_v2_${camdId}.json`;
    const cachePath = path.join(CACHE_DIR, cacheKey);

    if (fs.existsSync(cachePath)) {
      try {
        const stats = fs.statSync(cachePath);
        if (Date.now() - stats.mtimeMs < CACHE_TTL) {
          console.log(`[Cache] Loading CAMD emissions for ${camdId} from disk...`);
          const cachedData = fs.readFileSync(cachePath, 'utf8');
          return NextResponse.json(JSON.parse(cachedData));
        }
      } catch (cacheErr) {
        console.error('Failed to read CAMD emissions cache:', cacheErr);
      }
    }

    // 2. Fetch fresh historical CAMD data in parallel: the trailing complete years only
    const lastFullYear = new Date().getUTCFullYear() - 1;
    const lastYearComplete = await isYearComplete(lastFullYear);
    const newestYear = lastYearComplete ? lastFullYear : lastFullYear - 1;
    const years = Array.from({ length: TRAILING_YEARS }, (_, i) => newestYear - TRAILING_YEARS + 1 + i);
    const historicalEmissions = await fetchHistoricalCamdEmissions(camdId, years);
    const availableYears = Object.keys(historicalEmissions).map(Number);

    if (availableYears.length > 0) {
      const maxYear = Math.max(...availableYears);
      const emissions = historicalEmissions[maxYear];

      const payload = {
        emissions,
        year: maxYear,
        isSimulated: false,
        source: 'CAMPD',
        historicalEmissions,
      };

      // Save to cache — but not while last year's Q4 is still pending, so the
      // completed year appears as soon as CAMPD publishes it
      if (lastYearComplete) {
        try {
          if (!fs.existsSync(CACHE_DIR)) {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
          }
          fs.writeFileSync(cachePath, JSON.stringify(payload), 'utf8');
          console.log(`[Cache] Saved CAMD emissions for ${camdId} to disk.`);
        } catch (cacheErr) {
          console.error('Failed to write CAMD emissions cache:', cacheErr);
        }
      }

      return NextResponse.json(payload);
    }
  }

  // No data available — return honest empty state
  void registryId; // kept for future use if an alternative endpoint is identified
  return NextResponse.json({ emissions: [], year: null, isSimulated: false, source: null });
}
