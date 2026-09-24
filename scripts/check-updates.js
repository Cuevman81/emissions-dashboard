const fs = require('fs');
const path = require('path');

const NEI_DIR = 'https://gaftp.epa.gov/Air/nei/2023/data_summaries/';
const METADATA_PATH = path.join(__dirname, '..', 'src', 'lib', 'nei_2023_metadata.json');
// Stack parameters come from the NEI point flat file (scripts/sync_nei_stacks.mjs)
const NEI_FLAT_DIR = 'https://gaftp.epa.gov/Air/nei/2023/flat_files/';
const STACKS_METADATA_PATH = path.join(__dirname, '..', 'src', 'lib', 'nei_2023_stacks_metadata.json');
const ARCGIS_BASE = 'https://services.arcgis.com/cJ9YHowT8TU7DUyn/ArcGIS/rest/services/Air_Quality_Design_Values_for_Criteria_Pollutants/FeatureServer';
const DV_INDEX_URL = 'https://www.epa.gov/air-trends/air-quality-design-values';
const DV_PREFIXES = ['o3', 'pm25', 'pm10', 'so2', 'no2', 'co']; // the six workbooks the app reads

// EPA renames the facility summary on each re-release (eis_report_37583_... became
// eis_report_38234_..._21jul2026.zip on 22 Jul 2026), so find it by listing the folder.
function pickNeiSummary(html) {
  const names = [...html.matchAll(/href="(eis_report_(\d+)_2023NEI_facility_summary[^"]*\.zip)"/g)]
    .sort((a, b) => Number(a[2]) - Number(b[2]));
  if (!names.length) throw new Error('No 2023 NEI facility summary zip in the GAFTP listing');
  return names.at(-1)[1];
}

async function getNeiSummary() {
  const listing = await fetch(NEI_DIR, { signal: AbortSignal.timeout(15000) });
  if (!listing.ok) throw new Error(`GAFTP listing returned status code ${listing.status}`);
  const name = pickNeiSummary(await listing.text());
  const head = await fetch(NEI_DIR + name, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
  if (!head.ok) throw new Error(`GAFTP ${name} returned status code ${head.status}`);
  return { name, lastModified: head.headers.get('last-modified') || '' };
}

async function getNeiPointFile() {
  const listing = await fetch(NEI_FLAT_DIR, { signal: AbortSignal.timeout(15000) });
  if (!listing.ok) throw new Error(`GAFTP flat_files listing returned status code ${listing.status}`);
  const names = [...(await listing.text()).matchAll(/href="(SmokeFlatFile_POINT_(\d{8})\.zip)"/g)]
    .sort((a, b) => Number(a[2]) - Number(b[2]));
  if (!names.length) throw new Error('No SmokeFlatFile_POINT_*.zip in the GAFTP flat_files listing');
  const name = names.at(-1)[1];
  const head = await fetch(NEI_FLAT_DIR + name, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
  if (!head.ok) throw new Error(`GAFTP ${name} returned status code ${head.status}`);
  return { name, lastModified: head.headers.get('last-modified') || '' };
}

// Newest design-value year that all six EPA workbooks have reached (the same rule
// the app uses in src/lib/epa-dv-reports.ts).
async function getXlsxCommonYear() {
  const res = await fetch(DV_INDEX_URL, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`EPA design value index returned status code ${res.status}`);
  const html = await res.text();
  const newest = {};
  for (const m of html.matchAll(/\/([a-z0-9]+)_designvalues_(\d{4})_(\d{4})_final_[^"'\s]*?\.xlsx/gi)) {
    const prefix = m[1].toLowerCase();
    newest[prefix] = Math.max(newest[prefix] || 0, parseInt(m[3]));
  }
  const absent = DV_PREFIXES.filter(p => !newest[p]);
  if (absent.length) throw new Error(`EPA design value index lists no workbook for: ${absent.join(', ')}`);
  return Math.min(...DV_PREFIXES.map(p => newest[p]));
}

// Envirofacts count of Mississippi TRI forms for a reporting year. No "equals"
// operator: with it this join returns [] even for published years.
async function getTriFormCount(year) {
  const url = `https://data.epa.gov/efservice/TRI_REPORTING_FORM/REPORTING_YEAR/${year}/join/TRI_FACILITY/state_abbr/MS/count/JSON`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Envirofacts count for ${year} returned status code ${res.status}`);
  const n = Number((await res.json())?.[0]?.TOTALQUERYRESULTS);
  if (!Number.isFinite(n)) throw new Error(`Unexpected Envirofacts count response for ${year}`);
  return n;
}

async function getArcgisLatestYear() {
  const layerId = 1; // Ozone (representative criteria pollutant)
  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'DVYearText',
    orderByFields: 'DVYearText DESC',
    resultRecordCount: '1',
    f: 'json',
  });
  const url = `${ARCGIS_BASE}/${layerId}/query?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`ArcGIS returned status code ${res.status}`);
  const data = await res.json();
  const features = data.features || [];
  if (features.length > 0 && features[0].attributes?.DVYearText) {
    const yr = parseInt(features[0].attributes.DVYearText);
    if (!isNaN(yr)) return yr;
  }
  throw new Error('Could not parse latest year from ArcGIS response');
}

async function main() {
  console.log('Starting daily data freshness audit...');
  let updateMessages = [];
  let updateNeeded = false;
  // Every check that could not run is recorded here and fails the workflow run
  const failures = [];

  // 1. Audit NEI 2023 Point Source Data
  try {
    const { name: remoteName, lastModified: remoteModified } = await getNeiSummary();
    let localModified = '';
    if (fs.existsSync(METADATA_PATH)) {
      const meta = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf8'));
      localModified = meta.lastModified || '';
    }

    console.log(`[NEI 2023] Remote file: ${remoteName}`);
    console.log(`[NEI 2023] Remote Last-Modified: "${remoteModified}"`);
    console.log(`[NEI 2023] Local Last-Modified:  "${localModified}"`);

    if (remoteModified && localModified !== remoteModified) {
      updateNeeded = true;
      updateMessages.push(`- **NEI 2023 Database Update Available**: The EPA GAFTP server has a newer dataset version.\n  * Remote file: \`${remoteName}\`\n  * Remote Last-Modified: \`${remoteModified}\`\n  * Local Last-Modified: \`${localModified || 'None'}\``);
    } else {
      console.log('[NEI 2023] Dataset is up-to-date.');
    }
  } catch (err) {
    console.error('[NEI 2023] Audit failed:', err.message);
    failures.push(`NEI 2023: ${err.message}`);
  }

  // 1b. Audit the NEI 2023 point flat file behind the stack parameters
  try {
    const { name: remoteName, lastModified: remoteModified } = await getNeiPointFile();
    let local = {};
    if (fs.existsSync(STACKS_METADATA_PATH)) {
      local = JSON.parse(fs.readFileSync(STACKS_METADATA_PATH, 'utf8'));
    }
    console.log(`[NEI 2023 stacks] Remote file: ${remoteName}, Last-Modified "${remoteModified}"`);
    console.log(`[NEI 2023 stacks] Local file:  ${local.file || 'None'}, Last-Modified "${local.lastModified || ''}"`);

    if (remoteName !== local.file || (remoteModified && remoteModified !== local.lastModified)) {
      updateNeeded = true;
      updateMessages.push(`- **NEI 2023 Stack Parameters Update Available**: EPA posted a newer point flat file.\n  * Remote file: \`${remoteName}\` (Last-Modified \`${remoteModified}\`)\n  * Local file: \`${local.file || 'None'}\` (Last-Modified \`${local.lastModified || 'None'}\`)\n  * Rebuild with \`node scripts/sync_nei_stacks.mjs\` (or POST /api/sync-nei locally).`);
    } else {
      console.log('[NEI 2023 stacks] Dataset is up-to-date.');
    }
  } catch (err) {
    console.error('[NEI 2023 stacks] Audit failed:', err.message);
    failures.push(`NEI 2023 stacks: ${err.message}`);
  }

  // 2. Audit NAAQS Design Value sources. This is a health check only: the app reads
  // the newest year at runtime (EPA's xlsx reports first, then ArcGIS), so a new
  // design-value year needs no rebuild. Losing either source does need attention.
  try {
    const [arcgisYear, xlsxYear] = await Promise.all([getArcgisLatestYear(), getXlsxCommonYear()]);
    console.log(`[NAAQS] ArcGIS latest design value year:          ${arcgisYear}`);
    console.log(`[NAAQS] EPA xlsx reports, newest year all six share: ${xlsxYear}`);
    console.log(`[NAAQS] Dashboard serves ${Math.max(arcgisYear, xlsxYear)} automatically; no rebuild needed.`);
  } catch (err) {
    console.error('[NAAQS] Audit failed:', err.message);
    failures.push(`NAAQS: ${err.message}`);
  }

  // 3. Audit TRI (Toxics Release Inventory) Data
  try {
    const triPath = path.join(__dirname, '..', 'src', 'lib', 'tri_emissions.json');
    if (fs.existsSync(triPath)) {
      const localEmissions = JSON.parse(fs.readFileSync(triPath, 'utf8'));
      
      // Latest local year = newest year most facilities have. A handful of early
      // filers (3 facilities already had RY2025 rows in the Feb 2026 CSV) must not
      // make the check skip ahead and miss that year's actual release.
      const facilitiesPerYear = {};
      for (const fId in localEmissions) {
        for (const yr in localEmissions[fId].years || {}) {
          facilitiesPerYear[yr] = (facilitiesPerYear[yr] || 0) + 1;
        }
      }
      const maxFacilities = Math.max(...Object.values(facilitiesPerYear));
      const latestLocalYear = Math.max(...Object.keys(facilitiesPerYear)
        .filter(yr => facilitiesPerYear[yr] >= maxFacilities / 2).map(Number));

      const nextYear = latestLocalYear + 1;
      console.log(`[TRI] Latest local year: ${latestLocalYear}. Checking EPA for ${nextYear}...`);

      const [baseCount, nextCount] = await Promise.all([getTriFormCount(latestLocalYear), getTriFormCount(nextYear)]);
      console.log(`[TRI] Envirofacts MS forms: ${latestLocalYear} = ${baseCount}, ${nextYear} = ${nextCount}`);
      // The app already has latestLocalYear, so zero forms means the query itself broke
      if (baseCount === 0) throw new Error(`Envirofacts returned 0 MS forms for ${latestLocalYear}, a year the app already has`);

      if (nextCount >= baseCount / 2) {
        updateNeeded = true;
        updateMessages.push(`- **TRI Toxics Database Update Available**: EPA has published TRI reporting data for the year **${nextYear}**.\n  * Current Baseline: \`${latestLocalYear}\`\n  * New Year Available: \`${nextYear}\` (${nextCount} MS forms)`);
      } else {
        console.log(`[TRI] Year ${nextYear} data is not yet available. Current data is up-to-date.`);
      }
    } else {
      throw new Error('src/lib/tri_emissions.json not found');
    }
  } catch (err) {
    console.error('[TRI] Audit failed:', err.message);
    failures.push(`TRI: ${err.message}`);
  }

  // 4. Audit ECHO Facility Inventory
  try {
    console.log('[ECHO] Checking active Mississippi facility count...');
    const echoUrl = 'https://echodata.epa.gov/echo/air_rest_services.get_facilities?p_st=MS&p_act=Y&output=JSON';
    const resEcho = await fetch(echoUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000)
    });
    if (resEcho.ok) {
      const dataEcho = await resEcho.json();
      const results = dataEcho?.Results;
      if (results) {
        if (results.Error) {
          throw new Error(`API returned warning/error: ${results.Error.ErrorMessage || JSON.stringify(results.Error)}`);
        } else {
          const totalFound = parseInt(results.TotalFacilitiesFound || results.QueryRows || '0');
          // This is the raw ECHO *active* count, which EPA churns by a handful
          // day-to-day (e.g. 1022 <-> 1025). The dashboard itself is live-sourced
          // (active ECHO + merged TRI facilities), so it self-updates regardless.
          // We therefore only flag a *material* roster shift, not normal drift.
          const baselineCount = 1025;
          const tolerance = 0.03; // 3% (~30 facilities)
          const drift = baselineCount > 0 ? Math.abs(totalFound - baselineCount) / baselineCount : 0;
          console.log(`[ECHO] Remote Active Facilities Found: ${totalFound}`);
          console.log(`[ECHO] Local Baseline Facilities Count: ${baselineCount} (tolerance ±${Math.round(tolerance * 100)}%)`);
          if (totalFound > 0 && drift > tolerance) {
            updateNeeded = true;
            updateMessages.push(`- **ECHO Facility Inventory Update Available**: The active facilities count in ECHO has shifted materially (>${Math.round(tolerance * 100)}% from baseline).\n  * Local Baseline: \`${baselineCount}\` facilities\n  * Remote Current: \`${totalFound}\` facilities\n  * The dashboard is live-sourced and reflects this automatically; update this baseline if the new level is expected.`);
          } else {
            console.log('[ECHO] Facility inventory count is within tolerance.');
          }
        }
      } else {
        throw new Error('Response did not contain Results object');
      }
    } else {
      throw new Error(`API returned status ${resEcho.status}`);
    }
  } catch (err) {
    console.error('[ECHO] Audit failed:', err.message);
    failures.push(`ECHO: ${err.message}`);
  }

  // 5. Audit CAMD/CAMPD Apportioned Annual Emissions
  const apiKey = process.env.EPA_CAMD_API_KEY;
  if (apiKey) {
    try {
      const nextCamdYear = 2027;
      console.log(`[CAMD/CAMPD] Checking EPA for year ${nextCamdYear}...`);
      const camdUrl = `https://api.epa.gov/easey/emissions-mgmt/emissions/apportioned/annual?page=1&perPage=1&year=${nextCamdYear}`;
      const resCamd = await fetch(camdUrl, {
        headers: {
          'Accept': 'application/json',
          'x-api-key': apiKey
        },
        signal: AbortSignal.timeout(10000)
      });
      if (resCamd.ok) {
        const totalCountHeader = resCamd.headers.get('x-total-count');
        const totalCount = totalCountHeader ? parseInt(totalCountHeader, 10) : 0;
        
        let hasData = totalCount > 0;
        if (!hasData) {
          const dataCamd = await resCamd.json();
          hasData = Array.isArray(dataCamd) && dataCamd.length > 0;
        }

        if (hasData) {
          updateNeeded = true;
          updateMessages.push(`- **CAMD/CAMPD Emissions Update Available**: EPA has published power plant emissions data for the year **${nextCamdYear}**.\n  * Current Baseline: \`2026\`\n  * New Year Available: \`${nextCamdYear}\``);
        } else {
          console.log(`[CAMD/CAMPD] Year ${nextCamdYear} data is not yet available.`);
        }
      } else if (resCamd.status === 400) {
        console.log(`[CAMD/CAMPD] Year ${nextCamdYear} data is not yet available (API returned status 400).`);
      } else {
        throw new Error(`API returned status ${resCamd.status}`);
      }
    } catch (err) {
      console.error('[CAMD/CAMPD] Audit failed:', err.message);
      failures.push(`CAMD/CAMPD: ${err.message}`);
    }
  } else {
    console.log('[CAMD/CAMPD] Skipping audit: EPA_CAMD_API_KEY not set in environment.');
  }

  // 6. Output results
  // Exit codes: 0 = up to date, 10 = updates available, 1 = a check failed,
  // 11 = updates available AND a check failed. The workflow fails on 1 and 11.
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) FAILED:\n- ${failures.join('\n- ')}`);
  }
  if (updateNeeded) {
    const failedNote = failures.length > 0
      ? `\n\n**These checks also failed and need a look:**\n${failures.map(f => `- ${f}`).join('\n')}`
      : '';
    const body = `### 📡 Data Update Check Summary\n\nSome EPA data sources have newer versions available. Please run synchronization and rebuild the application to keep the dashboard current:\n\n${updateMessages.join('\n\n')}${failedNote}\n\n---\n*This alert was automatically generated by the daily GitHub Action data check.*`;
    
    fs.writeFileSync(path.join(__dirname, '..', 'update_details.txt'), body, 'utf8');
    console.log('\nUpdates found! Details written to update_details.txt');
    process.exit(failures.length > 0 ? 11 : 10);
  } else if (failures.length > 0) {
    process.exit(1);
  } else {
    console.log('\nAll datasets are currently up-to-date.');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Audit script failed:', err);
  process.exit(1);
});
