import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { syncYearFromEPA } from '@/lib/sync-tri';

const CACHE_DIR = path.join(process.cwd(), 'src', 'cache');
const STATUS_FILE = path.join(CACHE_DIR, 'last_checked_tri.json');
const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // Check once every 24 hours

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

export async function GET() {
  try {
    let shouldCheck = true;

    // 1. Check if we have checked recently
    if (fs.existsSync(STATUS_FILE)) {
      try {
        const statusData = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
        const timeDiff = Date.now() - (statusData.lastChecked || 0);
        
        if (timeDiff < CHECK_INTERVAL && statusData.status !== 'error') {
          shouldCheck = false;
        }
      } catch (err) {
        console.warn('[Sync API] Failed to parse status file, forcing check.', err);
      }
    }

    if (!shouldCheck) {
      return NextResponse.json({
        status: 'fresh',
        message: 'TRI sync check performed recently (< 24h ago). Skipping check.'
      });
    }

    // 2. Mark as running immediately to prevent concurrent triggers
    fs.writeFileSync(
      STATUS_FILE,
      JSON.stringify({ lastChecked: Date.now(), status: 'running' }),
      'utf8'
    );

    // 3. Kick off background sync process (non-blocking)
    // We do NOT await this promise, returning response to client immediately
    (async () => {
      try {
        console.log('[Sync API] Initiating automatic TRI background check...');
        const jsonPath = path.join(process.cwd(), 'src', 'lib', 'tri_emissions.json');
        if (!fs.existsSync(jsonPath)) {
          console.warn('[Sync API] tri_emissions.json does not exist. Cannot sync.');
          return;
        }

        const localEmissions = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        
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

        console.log(`[Sync API] Latest local TRI reporting year is: ${latestLocalYear}`);

        // Check if a NEW year dataset is available on the EPA API (latestLocalYear + 1)
        const nextYear = latestLocalYear + 1;
        const checkNextUrl = `https://data.epa.gov/efservice/TRI_REPORTING_FORM/REPORTING_YEAR/equals/${nextYear}/join/TRI_FACILITY/state_abbr/MS/1:1/JSON`;
        
        console.log(`[Sync API] Checking EPA API for new year ${nextYear}: ${checkNextUrl}`);
        const resNext = await fetch(checkNextUrl, { signal: AbortSignal.timeout(15000) });
        let hasNextYearData = false;
        if (resNext.ok) {
          const dataNext = await resNext.json();
          if (Array.isArray(dataNext) && dataNext.length > 0) {
            hasNextYearData = true;
          }
        }

        if (hasNextYearData) {
          console.log(`[Sync API] New year ${nextYear} data detected! Syncing...`);
          const result = await syncYearFromEPA(nextYear);
          console.log(`[Sync API] Sync finished for ${nextYear}:`, result);
          
          fs.writeFileSync(
            STATUS_FILE,
            JSON.stringify({ lastChecked: Date.now(), status: 'success', yearSynced: nextYear }),
            'utf8'
          );
          return;
        }

        // Check if we should refresh the current latest year (if local file hasn't been written in > 7 days)
        const fileStats = fs.statSync(jsonPath);
        const msSinceLastFileWrite = Date.now() - fileStats.mtimeMs;
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

        if (msSinceLastFileWrite > sevenDaysMs) {
          console.log(`[Sync API] Local TRI database is older than 7 days. Syncing current year ${latestLocalYear} for latest submissions...`);
          const result = await syncYearFromEPA(latestLocalYear);
          console.log(`[Sync API] Sync finished for ${latestLocalYear}:`, result);
        } else {
          console.log('[Sync API] Local TRI database is fresh (< 7 days old). No sync needed.');
        }

        // Mark check as success
        fs.writeFileSync(
          STATUS_FILE,
          JSON.stringify({ lastChecked: Date.now(), status: 'success', lastCheckedYear: latestLocalYear }),
          'utf8'
        );
      } catch (bgErr: any) {
        console.error('[Sync API] Background TRI check failed:', bgErr);
        // Write error status with back-off so it retries in 2 hours
        try {
          fs.writeFileSync(
            STATUS_FILE,
            JSON.stringify({
              lastChecked: Date.now() - (CHECK_INTERVAL - 2 * 60 * 60 * 1000), // retries in 2 hours
              status: 'error',
              error: bgErr.message || String(bgErr)
            }),
            'utf8'
          );
        } catch {}
      }
    })();

    // Return immediate response to the client
    return NextResponse.json({
      status: 'triggered',
      message: 'TRI sync check started in background.'
    });

  } catch (err: any) {
    console.error('[Sync API] GET handler failed:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
