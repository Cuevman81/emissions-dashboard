import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { writeLog } from '@/lib/logger';

const AQS_BASE_URL = 'https://aqs.epa.gov/data/api';

const STATE_CODE_MAP: Record<string, string> = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10',
  FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19', KS: '20',
  KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27', MS: '28',
  MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36',
  NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44', SC: '45',
  SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53', WV: '54',
};

const CACHE_DIR = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), 'src', 'cache');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const AQS_DATA_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// Ensure cache directory exists
try {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
} catch (err) {
  console.warn('[Cache] Failed to ensure cache directory exists:', err);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const state = searchParams.get('state');
  const mode = searchParams.get('mode') || 'monitors';
  const monitorId = searchParams.get('monitorId'); // formatted as state_code + county_code + site_number
  const year = searchParams.get('year') || '2023';
  const refresh = searchParams.get('refresh') === 'true';

  const DEBUG_LOG = 'aqs_debug.log';
  if (refresh) {
    writeLog(DEBUG_LOG, '--- DEBUG SESSION REFRESHED ---', { truncate: true });
  }

  const email = process.env.AQS_EMAIL;
  const key = process.env.AQS_KEY;

  if (!email || !key) {
    return NextResponse.json({ error: 'AQS Credentials not configured' }, { status: 500 });
  }

  try {
    if (mode === 'monitors' && state) {
      writeLog(DEBUG_LOG, `Starting Monitors Search: State=${state}, Year=${year}`);
      const stateCode = STATE_CODE_MAP[state];
      if (!stateCode) {
        writeLog(DEBUG_LOG, `ERROR: Invalid state code provided: ${state}`);
        throw new Error(`Invalid state code: ${state}`);
      }

      const email = process.env.AQS_EMAIL;
      const key = process.env.AQS_KEY;

      const cacheKey = `aqs_monitors_${state.toUpperCase()}_${year}.json`;
      const cachePath = path.join(CACHE_DIR, cacheKey);

      // Check Cache
      if (fs.existsSync(cachePath)) {
        const stats = fs.statSync(cachePath);
        if (Date.now() - stats.mtimeMs < CACHE_TTL) {
          writeLog(DEBUG_LOG, `CACHE HIT: Loading from ${cacheKey}. File is ${Math.round((Date.now() - stats.mtimeMs)/3600000)}h old.`);
          const cached = fs.readFileSync(cachePath, 'utf8');
          return NextResponse.json(JSON.parse(cached));
        }
        writeLog(DEBUG_LOG, `CACHE STALE: ${cacheKey} is too old. Fetching fresh from EPA.`);
      } else {
        writeLog(DEBUG_LOG, `CACHE MISS: No cached file found for ${state} ${year}.`);
      }

      // EPA AQS Discovery requires specific codes + date range. Shortcuts like 'HAPS' are not supported here.
      const paramList = '44201,42401,88101,42602,42101,81102,45201,43102,43503,43218,43843,14129';
      const bdate = `${year}0101`;
      const edate = `${year}1231`;

      writeLog(DEBUG_LOG, `EPA REQUEST: monitors/byState?state=${stateCode}&params=${paramList.substring(0, 30)}...&bdate=${bdate}`);

      try {
        const aqsUrl = `${AQS_BASE_URL}/monitors/byState?email=${email}&key=${key}&state=${stateCode}&param=${paramList}&bdate=${bdate}&edate=${edate}`;
        const startTime = Date.now();
        const res = await fetch(aqsUrl);
        const duration = Date.now() - startTime;
        
        writeLog(DEBUG_LOG, `EPA RESPONSE: Status=${res.status}, Duration=${duration}ms`);
        
        if (!res.ok) {
          writeLog(DEBUG_LOG, `ERROR: EPA API responded with status ${res.status} ${res.statusText}`);
          throw new Error(`AQS API error: ${res.statusText}`);
        }

        const data = await res.json();
        const rowCount = data.Data?.length || 0;
        writeLog(DEBUG_LOG, `EPA DATA: Received ${rowCount} raw parameter-monitor records.`);

        if (!data.Data || data.Data.length === 0) {
          writeLog(DEBUG_LOG, `WARNING: No data returned from EPA for this combination.`);
          if (data.Header && data.Header[0]) {
             writeLog(DEBUG_LOG, `EPA MESSAGE: ${data.Header[0].status} - ${data.Header[0].message}`);
          }
          return NextResponse.json([]);
        }

        // Map and group records
        const uniqueMonitors: Record<string, any> = {};
        data.Data.forEach((m: any) => {
          const id = `${m.state_code}${m.county_code}${m.site_number}`;
          if (!uniqueMonitors[id]) {
            uniqueMonitors[id] = {
              id,
              lat: parseFloat(m.latitude),
              lon: parseFloat(m.longitude),
              county: m.county_name,
              city: m.city_name,
              address: m.address,
              local_site_name: m.local_site_name,
              pollutants: m.parameter_name ? [m.parameter_name] : []
            };
          } else if (m.parameter_name && !uniqueMonitors[id].pollutants.includes(m.parameter_name)) {
            uniqueMonitors[id].pollutants.push(m.parameter_name);
          }
        });

        const finalMonitors = Object.values(uniqueMonitors);
        writeLog(DEBUG_LOG, `TRANSFORMATION: Identified ${finalMonitors.length} unique monitoring sites.`);
        
        // Log identify locations for Jackson County (059)
        const jacksonCountySites = finalMonitors.filter((m: any) => m.id.substring(2, 5) === '059');
        writeLog(DEBUG_LOG, `JACKSON CO: Found ${jacksonCountySites.length} sites in Jackson County (FIPS 059).`);
        jacksonCountySites.forEach((m: any) => {
          writeLog(DEBUG_LOG, ` - Site ${m.id}: ${m.local_site_name || m.address} (${m.lat}, ${m.lon})`);
        });

        // Save to cache
        fs.writeFileSync(cachePath, JSON.stringify(finalMonitors), 'utf8');
        writeLog(DEBUG_LOG, `CACHE SAVE: Data written to ${cacheKey}`);
        
        return NextResponse.json(finalMonitors);
      } catch (err: any) {
        writeLog(DEBUG_LOG, `FETCH ERROR: ${err.message}`);
        
        // Fallback to expired cache if available
        if (fs.existsSync(cachePath)) {
          writeLog(DEBUG_LOG, `FALLBACK: Using stale cache data for ${state}.`);
          const cached = fs.readFileSync(cachePath, 'utf8');
          return NextResponse.json(JSON.parse(cached));
        }
        
        return NextResponse.json([]);
      }
    }

    if (mode === 'samples' && monitorId) {
      writeLog(DEBUG_LOG, `Starting Samples Fetch: Monitor=${monitorId}, Year=${year}`);
      
      const sampleCacheKey = `aqs_samples_${monitorId}_${year}.json`;
      const sampleCachePath = path.join(CACHE_DIR, sampleCacheKey);

      // Check Cache
      if (fs.existsSync(sampleCachePath)) {
        const stats = fs.statSync(sampleCachePath);
        if (Date.now() - stats.mtimeMs < AQS_DATA_CACHE_TTL) {
          writeLog(DEBUG_LOG, `CACHE HIT: Loading samples from ${sampleCacheKey}.`);
          const cached = fs.readFileSync(sampleCachePath, 'utf8');
          return NextResponse.json(JSON.parse(cached));
        }
      }

      const stateCode = monitorId.substring(0, 2);
      const countyCode = monitorId.substring(2, 5);
      const siteNum = monitorId.substring(5);

      const bdate = `${year}0101`;
      const edate = `${year}1231`;
      // Extensive list of Core HAPs and common toxics (Benzene, Formaldehyde, Metals, etc.)
      const paramList = '44201,42401,88101,42602,42101,81102,45201,43102,43505,43502,43503,43218,43843,14129,12103,12112,12128,12110,12132,12136,12102,43804,43803,43818,45202,45220,43201';

      writeLog(DEBUG_LOG, `EPA REQUEST: dailyData/bySite?site=${monitorId}&params=${paramList.substring(0, 30)}...&year=${year}`);

      try {
        const aqsUrl = `${AQS_BASE_URL}/dailyData/bySite?email=${email}&key=${key}&param=${paramList}&bdate=${bdate}&edate=${edate}&state=${stateCode}&county=${countyCode}&site=${siteNum}`;
        const startTime = Date.now();
        const res = await fetch(aqsUrl);
        const duration = Date.now() - startTime;
        
        writeLog(DEBUG_LOG, `EPA RESPONSE: Status=${res.status}, Duration=${duration}ms`);
        
        if (!res.ok) {
          writeLog(DEBUG_LOG, `ERROR: EPA API responded with status ${res.status} ${res.statusText}`);
          throw new Error(`AQS API error: ${res.statusText}`);
        }
        
        const data = await res.json();
        const allSamples = data.Data || [];

        writeLog(DEBUG_LOG, `EPA DATA: Success. Found ${allSamples.length} measurements.`);

        // Save to cache
        try {
          fs.writeFileSync(sampleCachePath, JSON.stringify(allSamples), 'utf8');
          writeLog(DEBUG_LOG, `CACHE SAVE: Saved samples to ${sampleCacheKey}`);
        } catch (cacheErr) {
          console.error('Failed to write AQS samples cache:', cacheErr);
        }

        return NextResponse.json(allSamples);
      } catch (err: any) {
        writeLog(DEBUG_LOG, `FETCH ERROR: ${err.message}`);
        console.error(`[AQS API] Samples fetch failed:`, err.message);
        return NextResponse.json([]);
      }
    }

    if (mode === 'annual' && monitorId) {
      writeLog(DEBUG_LOG, `Starting Annual Data Fetch: Monitor=${monitorId}`);

      const annualCacheKey = `aqs_annual_${monitorId}.json`;
      const annualCachePath = path.join(CACHE_DIR, annualCacheKey);

      // Check Cache
      if (fs.existsSync(annualCachePath)) {
        const stats = fs.statSync(annualCachePath);
        if (Date.now() - stats.mtimeMs < AQS_DATA_CACHE_TTL) {
          writeLog(DEBUG_LOG, `CACHE HIT: Loading annual data from ${annualCacheKey}.`);
          const cached = fs.readFileSync(annualCachePath, 'utf8');
          return NextResponse.json(JSON.parse(cached));
        }
      }

      const stateCode = monitorId.substring(0, 2);
      const countyCode = monitorId.substring(2, 5);
      const siteNum = monitorId.substring(5);

      // Fetch 10+ years of data
      const bdate = '20140101';
      const edate = '20251231';
      // Extensive list of Core HAPs and common toxics (Benzene, Formaldehyde, Metals, etc.)
      const paramList = '44201,42401,88101,42602,42101,81102,45201,43102,43505,43502,43503,43218,43843,14129,12103,12112,12128,12110,12132,12136,12102,43804,43803,43818,45202,45220,43201';

      writeLog(DEBUG_LOG, `EPA REQUEST: annualData/bySite?site=${monitorId}&range=${bdate}-${edate}`);

      try {
        const aqsUrl = `${AQS_BASE_URL}/annualData/bySite?email=${email}&key=${key}&param=${paramList}&bdate=${bdate}&edate=${edate}&state=${stateCode}&county=${countyCode}&site=${siteNum}`;
        const res = await fetch(aqsUrl);
        if (!res.ok) throw new Error(`AQS API error: ${res.statusText}`);
        
        const data = await res.json();
        const rawRows = data.Data || [];
        writeLog(DEBUG_LOG, `EPA DATA: Found ${rawRows.length} annual statistic rows.`);

        // Minimal processing to return year-by-year averages
        const processed = rawRows.map((r: any) => ({
          year: r.year,
          parameter: r.parameter,
          parameter_code: r.parameter_code,
          arithmetic_mean: r.arithmetic_mean,
          units: r.units_of_measure,
          completeness: r.completeness_indicator
        })).sort((a: any, b: any) => b.year - a.year);

        // Save to cache
        try {
          fs.writeFileSync(annualCachePath, JSON.stringify(processed), 'utf8');
          writeLog(DEBUG_LOG, `CACHE SAVE: Saved annual data to ${annualCacheKey}`);
        } catch (cacheErr) {
          console.error('Failed to write AQS annual cache:', cacheErr);
        }

        return NextResponse.json(processed);
      } catch (err: any) {
        writeLog(DEBUG_LOG, `ANNUAL FETCH ERROR: ${err.message}`);
        return NextResponse.json([]);
      }
    }

    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
  } catch (error: any) {
    console.error('AQS Route Error:', error);
    // Explicitly log errors to the file for the user to see
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
