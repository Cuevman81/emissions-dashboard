import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const CACHE_DIR = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), 'src', 'cache');
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

// CAMPD annual emissions endpoint — EGUs (power plants) only
// Fields returned: so2Mass (tons), noxMass (tons), co2Mass (short tons)
async function fetchHistoricalCamdEmissions(orisCode: string): Promise<Record<string, { pollutant: string; amount: number; unit: string; emissionsType: 'actual' }[]>> {
  const years = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
  const results: Record<string, { pollutant: string; amount: number; unit: string; emissionsType: 'actual' }[]> = {};

  const apiKey = process.env.EPA_CAMD_API_KEY || '';

  await Promise.all(
    years.map(async (year) => {
      try {
        const url = `https://api.epa.gov/easey/emissions-mgmt/emissions/apportioned/annual?facilityId=${orisCode}&year=${year}&page=1&perPage=100`;
        
        const headers: HeadersInit = {
          'Accept': 'application/json',
        };
        if (apiKey) {
          headers['x-api-key'] = apiKey;
        }

        const res = await fetch(url, { 
          headers,
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
  const camdId = searchParams.get('camdId') || '';

  // EGU path — real CEMS data from CAMPD
  if (camdId) {
    // 1. Check cache first
    const cacheKey = `emissions_${camdId}.json`;
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

    // 2. Fetch fresh historical CAMD data in parallel
    const historicalEmissions = await fetchHistoricalCamdEmissions(camdId);
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

      // Save to cache
      try {
        if (!fs.existsSync(CACHE_DIR)) {
          fs.mkdirSync(CACHE_DIR, { recursive: true });
        }
        fs.writeFileSync(cachePath, JSON.stringify(payload), 'utf8');
        console.log(`[Cache] Saved CAMD emissions for ${camdId} to disk.`);
      } catch (cacheErr) {
        console.error('Failed to write CAMD emissions cache:', cacheErr);
      }

      return NextResponse.json(payload);
    }
  }

  // No data available — return honest empty state
  void registryId; // kept for future use if an alternative endpoint is identified
  return NextResponse.json({ emissions: [], year: null, isSimulated: false, source: null });
}
