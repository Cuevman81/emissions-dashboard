import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJ_ROOT = path.join(__dirname, '..');
const LIB_DIR = path.join(PROJ_ROOT, 'src', 'lib');
const OUT_FACILITIES = path.join(LIB_DIR, 'tri_facilities.json');
const OUT_EMISSIONS = path.join(LIB_DIR, 'tri_emissions.json');

// Parse target year from command line args, default to 2025
const targetYearArg = process.argv[2] || '2025';
const targetYear = parseInt(targetYearArg);

if (isNaN(targetYear) || targetYear < 1987) {
  console.error('Error: Please provide a valid reporting year (e.g., 2025).');
  process.exit(1);
}

async function syncTRI() {
  console.log(`Starting TRI Sync from live EPA Envirofacts API for Year: ${targetYear}...`);

  // 1. Load existing datasets to merge into
  let facilitiesList = [];
  if (fs.existsSync(OUT_FACILITIES)) {
    try {
      facilitiesList = JSON.parse(fs.readFileSync(OUT_FACILITIES, 'utf8'));
      console.log(`Loaded ${facilitiesList.length} existing facilities from ${OUT_FACILITIES}`);
    } catch (e) {
      console.warn('Failed to parse existing facilities, starting fresh.', e);
    }
  }

  let emissionsStore = {};
  if (fs.existsSync(OUT_EMISSIONS)) {
    try {
      emissionsStore = JSON.parse(fs.readFileSync(OUT_EMISSIONS, 'utf8'));
      console.log(`Loaded emissions data for ${Object.keys(emissionsStore).length} facilities from ${OUT_EMISSIONS}`);
    } catch (e) {
      console.warn('Failed to parse existing emissions, starting fresh.', e);
    }
  }

  // Map existing facilities by triId for quick lookup/update
  const facilitiesMap = new Map(facilitiesList.map(f => [f.triId, f]));

  // 2. Fetch MS joined TRI data from EPA for target year
  const url = `https://data.epa.gov/efservice/TRI_FORM_R/join/TRI_REPORTING_FORM/REPORTING_YEAR/${targetYear}/join/TRI_FACILITY/state_abbr/MS/JSON`;
  console.log(`Querying EPA API: ${url}`);
  
  let data = [];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) {
      throw new Error(`EPA API returned status ${res.status}`);
    }
    data = await res.json();
    console.log(`Successfully fetched ${data.length} raw chemical records from EPA.`);
  } catch (err) {
    console.error('Failed to retrieve data from EPA Envirofacts:', err);
    process.exit(1);
  }

  if (data.length === 0) {
    console.log(`No records found in EPA database for year ${targetYear} in Mississippi yet. (The EPA might not have loaded the preliminary dataset yet).`);
    process.exit(0);
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

    console.log('\n--- Sync Complete ---');
    console.log(`Added ${newFacilitiesCount} new facilities to tri_facilities.json.`);
    console.log(`Updated emissions data for ${updatedEmissionsCount} facilities for reporting year ${targetYear} in tri_emissions.json.`);
    console.log(`Total facilities in map: ${updatedFacilitiesList.length}`);
    console.log(`Total emissions profiles cached: ${Object.keys(emissionsStore).length}`);
  } catch (err) {
    console.error('Failed to write updated datasets to files:', err);
  }
}

syncTRI().catch(console.error);
