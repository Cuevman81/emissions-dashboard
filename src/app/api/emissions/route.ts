import { NextResponse } from 'next/server';

// CAMPD annual emissions endpoint — EGUs (power plants) only
// Fields returned: so2Mass (tons), noxMass (tons), co2Mass (short tons)
async function fetchCamdEmissions(orisCode: string): Promise<{ pollutant: string; amount: number; unit: string; emissionsType: 'actual' }[]> {
  // Try most recent 3 years in descending order until we get data
  const currentYear = new Date().getFullYear();
  for (const year of [currentYear - 1, currentYear - 2, currentYear - 3]) {
    try {
      const url = `https://api.epa.gov/easey/emissions-mgmt/emissions/apportioned/annual?facilityId=${orisCode}&year=${year}&page=1&perPage=100`;
      
      const headers: HeadersInit = {
        'Accept': 'application/json',
      };
      if (process.env.EPA_CAMD_API_KEY) {
        headers['x-api-key'] = process.env.EPA_CAMD_API_KEY;
      }

      const res = await fetch(url, { 
        headers,
        signal: AbortSignal.timeout(8000) 
      });
      if (!res.ok) continue;
      const data = await res.json();
      const records = Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : null);
      if (!records || records.length === 0) continue;

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

      if (emissions.length > 0) return emissions;
    } catch {
      // try next year
    }
  }
  return [];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const registryId = searchParams.get('registryId') || 'unknown';
  const camdId = searchParams.get('camdId') || '';

  // EGU path — real CEMS data from CAMPD
  if (camdId) {
    const emissions = await fetchCamdEmissions(camdId);
    if (emissions.length > 0) {
      return NextResponse.json({
        emissions,
        year: new Date().getFullYear() - 1,
        isSimulated: false,
        source: 'CAMPD',
      });
    }
  }

  // No data available — return honest empty state
  // EIS_ANNUAL_EMISSIONS via data.epa.gov/efservice returns 404 (table removed Feb 2026)
  // Do NOT fall back to simulated/fake values in an engineering tool
  void registryId; // kept for future use if an alternative endpoint is identified
  return NextResponse.json({ emissions: [], year: null, isSimulated: false, source: null });
}
