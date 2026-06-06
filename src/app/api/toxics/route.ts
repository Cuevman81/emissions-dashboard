import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

function getLocalTriEmissions(triId: string, requestedYear: string | null) {
  try {
    const jsonPath = path.join(process.cwd(), 'src', 'lib', 'tri_emissions.json');
    if (fs.existsSync(jsonPath)) {
      const fileData = fs.readFileSync(jsonPath, 'utf8');
      const localEmissions = JSON.parse(fileData);
      const facilityData = localEmissions[triId];
      if (facilityData) {
        const targetYear = requestedYear && facilityData.years[requestedYear]
          ? requestedYear
          : facilityData.latestYear.toString();

        console.log(`Loaded TRI (Toxics) data internally for ${triId} (Year: ${targetYear})`);
        // Toxics route returns {chemicals: [{name, amount, unit}]}
        // haps store is {haps: [{pollutant, amount, unit}]}
        const hapsForYear = facilityData.years[targetYear] || [];
        const mapped = hapsForYear.map((h: any) => ({
          name: h.pollutant,
          amount: h.amount,
          unit: h.unit
        }));

        return {
          chemicals: mapped,
          year: targetYear,
          availableYears: Object.keys(facilityData.years).sort((a, b) => parseInt(b) - parseInt(a)),
          historicalHaps: facilityData.years,
          isSimulated: false
        };
      }
    }
  } catch (err) {
    console.error('Error reading local TRI toxics emissions:', err);
  }
  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const triId = searchParams.get('triId') || 'unknown';
  const yearParam = searchParams.get('year');

  const localData = getLocalTriEmissions(triId, yearParam);
  if (localData) {
    return NextResponse.json(localData);
  }

  const url = `https://data.epa.gov/efservice/TRI_AIR_RELEASE/TRI_FACILITY_ID/equals/${triId}/JSON`;

  try {
    const res = await fetch(url);

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        let maxYear = 0;
        const chemicalMap: Record<string, { name: string, amount: number, unit: string }> = {};

        data.forEach((item: any) => {
          const year = parseInt(item.REPORTING_YEAR);
          if (year > maxYear) maxYear = year;

          const name = item.CHEM_NAME || item.CHEMICAL_NAME || 'Unknown Chemical';
          const amount = parseFloat(item.TOTAL_AIR_RELEASE) || 0;
          if (amount > 0) {
            if (!chemicalMap[name]) {
              chemicalMap[name] = { name, amount: 0, unit: 'lbs' };
            }
            chemicalMap[name].amount += amount;
          }
        });

        const chemicals = Object.values(chemicalMap).sort((a, b) => b.amount - a.amount);
        if (chemicals.length > 0) {
          return NextResponse.json({
            chemicals,
            year: maxYear > 0 ? maxYear : 'Recent',
            isSimulated: false
          });
        }
      }
    }

    // DYNAMIC FALLBACK: Generate different data for different facilities 
    // using the triId as a seed for randomness.
    const seed = triId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const rand = (min: number, max: number) => Math.floor(((seed * 9301 + 49297) % 233280) / 233280 * (max - min) + min);

    return NextResponse.json({
      chemicals: [
        { name: 'Methanol (Simulated)', amount: rand(5000, 50000), unit: 'lbs' },
        { name: 'Ammonia (Simulated)', amount: rand(1000, 20000), unit: 'lbs' },
        { name: 'Toluene (Simulated)', amount: rand(100, 5000), unit: 'lbs' },
        { name: 'Xylene (Simulated)', amount: rand(50, 2000), unit: 'lbs' }
      ].sort((a, b) => b.amount - a.amount),
      year: 2023,
      isSimulated: true
    });

  } catch (err) {
    return NextResponse.json({ chemicals: [], year: null, isSimulated: false });
  }
}
