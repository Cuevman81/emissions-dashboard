import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJ_ROOT = path.join(__dirname, '..');
const TOXICS_DIR = path.join(PROJ_ROOT, 'Air Toxics');
const LIB_DIR = path.join(PROJ_ROOT, 'src', 'lib');

const CACHE_FILE = path.join(TOXICS_DIR, 'geocoded_addresses_cache.csv');
const TRI_FILE = path.join(TOXICS_DIR, 'TRI_2_23_2026.csv');
const OUT_FACILITIES = path.join(LIB_DIR, 'tri_facilities.json');
const OUT_EMISSIONS = path.join(LIB_DIR, 'tri_emissions.json');

async function processData() {
    console.log('Loading geocode cache...');
    const cacheMap = await new Promise((resolve, reject) => {
        const map = new Map();
        fs.createReadStream(CACHE_FILE)
            .pipe(csv())
            .on('data', (row) => {
                // Address matches Full_Address from R script logic
                map.set(row.Full_Address, {
                    lat: parseFloat(row.latitude),
                    lon: parseFloat(row.longitude)
                });
            })
            .on('end', () => resolve(map))
            .on('error', reject);
    });

    console.log(`Loaded ${cacheMap.size} geocoded addresses.`);

    console.log('Parsing TRI Data...');

    // Format required by emissions
    // tri_emissions.json -> { triId: { year: 2024, haps: [ { pollutant, amount, unit, emissionsType, year } ] } }
    const emissionsStore = new Map();
    // format required by facilities
    // tri_facilities.json -> { id (triId), triId, name, address, city, state, zip, lat, lon, dataSource, sector... }
    const facilitiesMap = new Map();

    fs.createReadStream(TRI_FILE)
        .pipe(csv())
        .on('data', (row) => {
            const triId = row.TRI_ID;
            if (!triId) return;

            const year = parseInt(row.REP_YEAR || '0');
            const facilityName = row.FACILITY;
            const address = row.ADDRESS;
            const city = row.CITY;
            const zip = row.ZIP_CODE;
            const naics = row.NAICS;

            const fullAddress = `${address}, ${city}, MS ${zip}`;

            // Build Facility Map
            if (!facilitiesMap.has(triId)) {
                const coords = cacheMap.get(fullAddress);
                // We only want facilities we can place on the map
                if (coords && !isNaN(coords.lat) && !isNaN(coords.lon)) {
                    facilitiesMap.set(triId, {
                        id: triId,
                        triId: triId,
                        name: facilityName,
                        address: address,
                        city: city,
                        state: 'MS',
                        zip: zip,
                        lat: coords.lat,
                        lon: coords.lon,
                        permitType: 'Other',
                        isMajor: false,
                        hasHpv: false,
                        dataSource: 'TRI',
                        naics: naics,
                        sector: 'Other', // Sector logic is handled server-side normally, we'll assign Other or try to map.
                    });
                }
            }

            if (!emissionsStore.has(triId)) {
                emissionsStore.set(triId, {
                    latestYear: year, // will be updated
                    yearsMap: new Map() // year -> map of (chemName -> amountTons)
                });
            }

            const facilityEmissions = emissionsStore.get(triId);
            // keep highest year seen
            if (year > facilityEmissions.latestYear) facilityEmissions.latestYear = year;

            if (!facilityEmissions.yearsMap.has(year)) {
                facilityEmissions.yearsMap.set(year, new Map());
            }

            // We only care about Total Air Releases (TOT_AIR10) in pounds
            const totalAir = parseFloat(row.TOT_AIR10 || '0');
            if (totalAir > 0) {
                const chemName = row.CHEM_NAME;
                // conversion to short tons (lbs / 2000) match haps route
                const amountTons = Math.round((totalAir / 2000) * 10000) / 10000;

                const yearMap = facilityEmissions.yearsMap.get(year);
                // Sum across records for same chemical
                const currentAmount = yearMap.get(chemName) || 0;
                yearMap.set(chemName, currentAmount + amountTons);
            }
        })
        .on('end', () => {
            console.log('Finished reading TRI CSV.');

            // Process emissions store into final JSON shape
            // { triId: { latestYear: 2024, years: { "2024": [...haps], "2023": [...haps] } } }
            const finalEmissions = {};
            for (const [triId, data] of emissionsStore.entries()) {
                const yearsFormatted = {};
                for (const [yr, chemMap] of data.yearsMap.entries()) {
                    const hapsArray = [];
                    for (const [chem, amt] of chemMap.entries()) {
                        hapsArray.push({
                            pollutant: chem,
                            amount: amt,
                            unit: 'Tons/Year',
                            year: yr,
                            emissionsType: 'actual'
                        });
                    }
                    // sort by amount descending
                    hapsArray.sort((a, b) => b.amount - a.amount);
                    yearsFormatted[yr] = hapsArray;
                }

                finalEmissions[triId] = {
                    latestYear: data.latestYear,
                    years: yearsFormatted,
                    isTRIReporter: true,
                    isSimulated: false,
                    source: 'TRI (Local CSV)'
                };
            }

            // Write files
            const facilitiesArray = Array.from(facilitiesMap.values());

            fs.writeFileSync(OUT_FACILITIES, JSON.stringify(facilitiesArray, null, 2));
            fs.writeFileSync(OUT_EMISSIONS, JSON.stringify(finalEmissions, null, 2));

            console.log(`Saved ${facilitiesArray.length} facilities to ${OUT_FACILITIES}`);
            console.log(`Saved emissions for ${Object.keys(finalEmissions).length} facilities to ${OUT_EMISSIONS}`);
        })
        .on('error', (err) => console.error(err));
}

processData().catch(console.error);
