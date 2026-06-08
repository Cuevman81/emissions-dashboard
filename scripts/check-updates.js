const fs = require('fs');
const path = require('path');
const https = require('https');

const ZIP_URL = 'https://gaftp.epa.gov/Air/nei/2023/data_summaries/eis_report_37583_2023NEI_facility_summary.zip';
const METADATA_PATH = path.join(__dirname, '..', 'src', 'lib', 'nei_2023_metadata.json');
const ARCGIS_BASE = 'https://services.arcgis.com/cJ9YHowT8TU7DUyn/ArcGIS/rest/services/Air_Quality_Design_Values_for_Criteria_Pollutants/FeatureServer';

function getGaftpLastModified() {
  return new Promise((resolve, reject) => {
    const req = https.request(ZIP_URL, { method: 'HEAD', timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`GAFTP returned status code ${res.statusCode}`));
        return;
      }
      resolve(res.headers['last-modified'] || '');
    });
    req.on('error', reject);
    req.end();
  });
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

  // 1. Audit NEI 2023 Point Source Data
  try {
    const remoteModified = await getGaftpLastModified();
    let localModified = '';
    if (fs.existsSync(METADATA_PATH)) {
      const meta = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf8'));
      localModified = meta.lastModified || '';
    }

    console.log(`[NEI 2023] Remote Last-Modified: "${remoteModified}"`);
    console.log(`[NEI 2023] Local Last-Modified:  "${localModified}"`);

    if (remoteModified && localModified !== remoteModified) {
      updateNeeded = true;
      updateMessages.push(`- **NEI 2023 Database Update Available**: The EPA GAFTP server has a newer dataset version.\n  * Remote Last-Modified: \`${remoteModified}\`\n  * Local Last-Modified: \`${localModified || 'None'}\``);
    } else {
      console.log('[NEI 2023] Dataset is up-to-date.');
    }
  } catch (err) {
    console.error('[NEI 2023] Audit failed:', err.message);
  }

  // 2. Audit NAAQS Design Value Years
  try {
    const remoteLatestYear = await getArcgisLatestYear();
    const currentCodeYear = 2024; // Hardcoded baseline check

    console.log(`[NAAQS] ArcGIS Latest Certified Year: ${remoteLatestYear}`);
    console.log(`[NAAQS] Application Baseline Year:    ${currentCodeYear}`);

    if (remoteLatestYear > currentCodeYear) {
      updateNeeded = true;
      updateMessages.push(`- **NAAQS Design Values Update Available**: EPA has certified new Design Value records for the year **${remoteLatestYear}**.\n  * Current Baseline: \`${currentCodeYear}\`\n  * Latest Certified: \`${remoteLatestYear}\``);
    } else {
      console.log('[NAAQS] Design values are up-to-date.');
    }
  } catch (err) {
    console.error('[NAAQS] Audit failed:', err.message);
  }

  // 3. Audit TRI (Toxics Release Inventory) Data
  try {
    const triPath = path.join(__dirname, '..', 'src', 'lib', 'tri_emissions.json');
    if (fs.existsSync(triPath)) {
      const localEmissions = JSON.parse(fs.readFileSync(triPath, 'utf8'));
      
      // Find highest year present in the local database
      let latestLocalYear = 1987;
      for (const fId in localEmissions) {
        const fData = localEmissions[fId];
        if (fData.years) {
          for (const yr in fData.years) {
            const yrNum = parseInt(yr);
            if (yrNum > latestLocalYear) {
              latestLocalYear = yrNum;
            }
          }
        }
      }

      const nextYear = latestLocalYear + 1;
      console.log(`[TRI] Latest local year: ${latestLocalYear}. Checking EPA for ${nextYear}...`);
      
      const checkNextUrl = `https://data.epa.gov/efservice/TRI_REPORTING_FORM/REPORTING_YEAR/equals/${nextYear}/join/TRI_FACILITY/state_abbr/MS/1:1/JSON`;
      const resNext = await fetch(checkNextUrl, { signal: AbortSignal.timeout(10000) });
      
      if (resNext.ok) {
        const dataNext = await resNext.json();
        if (Array.isArray(dataNext) && dataNext.length > 0) {
          updateNeeded = true;
          updateMessages.push(`- **TRI Toxics Database Update Available**: EPA has published TRI reporting data for the year **${nextYear}**.\n  * Current Baseline: \`${latestLocalYear}\`\n  * New Year Available: \`${nextYear}\``);
        } else {
          console.log(`[TRI] Year ${nextYear} data is not yet available. Current data is up-to-date.`);
        }
      }
    }
  } catch (err) {
    console.error('[TRI] Audit failed:', err.message);
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
          console.warn(`[ECHO] API returned warning/error: ${results.Error.ErrorMessage || JSON.stringify(results.Error)}`);
        } else {
          const totalFound = parseInt(results.TotalFacilitiesFound || results.QueryRows || '0');
          const baselineCount = 1147;
          console.log(`[ECHO] Remote Active Facilities Found: ${totalFound}`);
          console.log(`[ECHO] Local Baseline Facilities Count: ${baselineCount}`);
          if (totalFound > 0 && totalFound !== baselineCount) {
            updateNeeded = true;
            updateMessages.push(`- **ECHO Facility Inventory Update Available**: The active facilities count in ECHO has changed.\n  * Local Baseline: \`${baselineCount}\` facilities\n  * Remote Current: \`${totalFound}\` facilities`);
          } else {
            console.log('[ECHO] Facility inventory count is up-to-date.');
          }
        }
      } else {
        console.warn('[ECHO] Response did not contain Results object.');
      }
    } else {
      console.warn(`[ECHO] API returned status ${resEcho.status}`);
    }
  } catch (err) {
    console.error('[ECHO] Audit failed:', err.message);
  }

  // 5. Audit CAMD/CAMPD Apportioned Annual Emissions
  const apiKey = process.env.EPA_CAMD_API_KEY;
  if (apiKey) {
    try {
      const nextCamdYear = 2026;
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
          updateMessages.push(`- **CAMD/CAMPD Emissions Update Available**: EPA has published power plant emissions data for the year **${nextCamdYear}**.\n  * Current Baseline: \`2025\`\n  * New Year Available: \`${nextCamdYear}\``);
        } else {
          console.log(`[CAMD/CAMPD] Year ${nextCamdYear} data is not yet available.`);
        }
      } else {
        console.error(`[CAMD/CAMPD] API returned status ${resCamd.status}`);
      }
    } catch (err) {
      console.error('[CAMD/CAMPD] Audit failed:', err.message);
    }
  } else {
    console.log('[CAMD/CAMPD] Skipping audit: EPA_CAMD_API_KEY not set in environment.');
  }

  // 6. Output results
  if (updateNeeded) {
    const body = `### 📡 Data Update Check Summary\n\nSome EPA data sources have newer versions available. Please run synchronization and rebuild the application to keep the dashboard current:\n\n${updateMessages.join('\n\n')}\n\n---\n*This alert was automatically generated by the daily GitHub Action data check.*`;
    
    fs.writeFileSync(path.join(__dirname, '..', 'update_details.txt'), body, 'utf8');
    console.log('\nUpdates found! Details written to update_details.txt');
    process.exit(10); // Specific exit code to flag that updates are available
  } else {
    console.log('\nAll datasets are currently up-to-date.');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Audit script failed:', err);
  process.exit(1);
});
