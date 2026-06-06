import fs from 'fs';
import path from 'path';

const LIB_DIR = path.join(process.cwd(), 'src', 'lib');
const OUT_FACILITIES = path.join(LIB_DIR, 'tri_facilities.json');
const OUT_EMISSIONS = path.join(LIB_DIR, 'tri_emissions.json');

export async function syncYearFromEPA(targetYear: number): Promise<{
  success: boolean;
  addedFacilities: number;
  updatedEmissions: number;
  message: string;
}> {
  console.log(`[Sync Service] Starting TRI Sync from live EPA Envirofacts API for Year: ${targetYear}...`);

  // 1. Load existing datasets to merge into
  let facilitiesList: any[] = [];
  if (fs.existsSync(OUT_FACILITIES)) {
    try {
      facilitiesList = JSON.parse(fs.readFileSync(OUT_FACILITIES, 'utf8'));
    } catch (e) {
      console.warn('[Sync Service] Failed to parse existing facilities, starting fresh.', e);
    }
  }

  let emissionsStore: Record<string, any> = {};
  if (fs.existsSync(OUT_EMISSIONS)) {
    try {
      emissionsStore = JSON.parse(fs.readFileSync(OUT_EMISSIONS, 'utf8'));
    } catch (e) {
      console.warn('[Sync Service] Failed to parse existing emissions, starting fresh.', e);
    }
  }

  // Map existing facilities by triId for quick lookup/update
  const facilitiesMap = new Map<string, any>(facilitiesList.map((f: any) => [f.triId, f]));

  // 2. Fetch MS joined TRI data from EPA for target year
  const url = `https://data.epa.gov/efservice/TRI_FORM_R/join/TRI_REPORTING_FORM/REPORTING_YEAR/${targetYear}/join/TRI_FACILITY/state_abbr/MS/JSON`;
  console.log(`[Sync Service] Querying EPA API: ${url}`);
  
  let data = [];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) {
      throw new Error(`EPA API returned status ${res.status}`);
    }
    data = await res.json();
    console.log(`[Sync Service] Successfully fetched ${data.length} raw chemical records from EPA.`);
  } catch (err: any) {
    console.error('[Sync Service] Failed to retrieve data from EPA Envirofacts:', err);
    return {
      success: false,
      addedFacilities: 0,
      updatedEmissions: 0,
      message: `Failed to retrieve data from EPA: ${err.message}`
    };
  }

  if (data.length === 0) {
    console.log(`[Sync Service] No records found in EPA database for year ${targetYear} in Mississippi yet.`);
    return {
      success: true,
      addedFacilities: 0,
      updatedEmissions: 0,
      message: `No records found in EPA database for year ${targetYear}.`
    };
  }

  // 3. Process records
  let newFacilitiesCount = 0;
  let updatedEmissionsCount = 0;

  // Temp map to group this year's emissions by facility ID:
  // triId -> { pollutant -> amountTons }
  const yearlyEmissionsMap = new Map();

  for (const row of data) {
    const triId = row.tri_facility_id;
    if (!triId) continue;

    // Process facility details
    if (!facilitiesMap.has(triId)) {
      // Parse coordinates (convert from DMS format if necessary)
      let lat = 0;
      let lon = 0;
      const pLat = row.pref_latitude ? parseFloat(row.pref_latitude) : null;
      const pLon = row.pref_longitude ? parseFloat(row.pref_longitude) : null;
      const fLat = row.fac_latitude ? parseFloat(row.fac_latitude) : null;
      const fLon = row.fac_longitude ? parseFloat(row.fac_longitude) : null;

      if (pLat && pLat !== 0) { lat = pLat; lon = pLon || 0; }
      else if (fLat && fLat !== 0) { lat = fLat; lon = fLon || 0; }

      // Coordinate DMS to decimal degree conversion logic
      if (lat > 1000) {
        const d = Math.floor(lat / 10000);
        const m = Math.floor((lat % 10000) / 100);
        const s = lat % 100;
        lat = d + m / 60 + s / 3600;

        const aLon = Math.abs(lon);
        const d2 = Math.floor(aLon / 10000);
        const m2 = Math.floor((aLon % 10000) / 100);
        const s2 = aLon % 100;
        lon = -(d2 + m2 / 60 + s2 / 3600);
      }

      // We only insert if we have valid coordinates to place it on the map
      if (lat && lon && !isNaN(lat) && !isNaN(lon)) {
        const newFacility = {
          id: triId,
          triId: triId,
          name: row.facility_name || 'Unknown Facility',
          address: row.street_address || '',
          city: row.city_name || '',
          state: 'MS',
          zip: row.zip_code || '',
          lat: Math.round(lat * 100000) / 100000,
          lon: Math.round(lon * 100000) / 100000,
          permitType: 'Other',
          isMajor: false,
          hasHpv: false,
          dataSource: 'TRI',
          naics: row.naics_codes || '',
          sector: 'Other'
        };
        facilitiesMap.set(triId, newFacility);
        newFacilitiesCount++;
      }
    }

    // Process air releases
    const airTotalRelease = parseFloat(row.air_total_release || 0);
    const chemName = row.cas_chem_name;

    if (airTotalRelease > 0 && chemName) {
      // Convert to short tons (lbs / 2000) with 4 decimal places
      const amountTons = Math.round((airTotalRelease / 2000) * 10000) / 10000;

      if (!yearlyEmissionsMap.has(triId)) {
        yearlyEmissionsMap.set(triId, new Map());
      }

      const chemMap = yearlyEmissionsMap.get(triId);
      const currentAmount = chemMap.get(chemName) || 0;
      chemMap.set(chemName, currentAmount + amountTons);
    }
  }

  // 4. Merge emissions into the main store
  for (const [triId, chemMap] of yearlyEmissionsMap.entries()) {
    const hapsArray = [];
    for (const [chem, amt] of chemMap.entries()) {
      hapsArray.push({
        pollutant: chem,
        amount: amt,
        unit: 'Tons/Year',
        year: targetYear,
        emissionsType: 'actual'
      });
    }

    // Sort by amount descending
    hapsArray.sort((a, b) => b.amount - a.amount);

    if (!emissionsStore[triId]) {
      emissionsStore[triId] = {
        latestYear: targetYear,
        years: {},
        isTRIReporter: true,
        isSimulated: false,
        source: 'TRI (Live EPA Sync)'
      };
    }

    const facilityData = emissionsStore[triId];
    
    // Update years list
    facilityData.years[targetYear.toString()] = hapsArray;
    
    // Update latest year seen
    if (targetYear > facilityData.latestYear) {
      facilityData.latestYear = targetYear;
    }
    
    // Tag source
    facilityData.source = 'TRI (Live EPA Sync)';
    updatedEmissionsCount++;
  }

  // 5. Save files back to src/lib
  const updatedFacilitiesList = Array.from(facilitiesMap.values());
  
  try {
    fs.writeFileSync(OUT_FACILITIES, JSON.stringify(updatedFacilitiesList, null, 2), 'utf8');
    fs.writeFileSync(OUT_EMISSIONS, JSON.stringify(emissionsStore, null, 2), 'utf8');

    console.log('[Sync Service] Sync Complete.');
    return {
      success: true,
      addedFacilities: newFacilitiesCount,
      updatedEmissions: updatedEmissionsCount,
      message: `Successfully synced ${targetYear} data from EPA.`
    };
  } catch (err: any) {
    console.error('[Sync Service] Failed to write updated datasets to files:', err);
    return {
      success: false,
      addedFacilities: 0,
      updatedEmissions: 0,
      message: `Failed to save synced data: ${err.message}`
    };
  }
}
