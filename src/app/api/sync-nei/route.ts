import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import https from 'https';
import csvParser from 'csv-parser';

const ZIP_URL = 'https://gaftp.epa.gov/Air/nei/2023/data_summaries/eis_report_37583_2023NEI_facility_summary.zip';
const METADATA_PATH = path.join(process.cwd(), 'src', 'lib', 'nei_2023_metadata.json');
const DATA_PATH = path.join(process.cwd(), 'src', 'lib', 'nei_2023_MS.json');
const SCRATCH_DIR = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), 'scratch');
const TEMP_ZIP = path.join(SCRATCH_DIR, 'nei_2023_temp.zip');

try {
  if (!fs.existsSync(SCRATCH_DIR)) {
    fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  }
} catch (err) {
  console.warn('[Sync NEI] Failed to ensure scratch directory exists:', err);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const checkOnly = searchParams.get('checkOnly') === 'true';

  if (!checkOnly) {
    return NextResponse.json({ error: 'Use POST to trigger sync' }, { status: 405 });
  }

  try {
    const headRes = await fetch(ZIP_URL, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    if (!headRes.ok) throw new Error(`GAFTP HEAD request returned ${headRes.status}`);

    const lastModified = headRes.headers.get('last-modified') || '';
    
    // Check local metadata
    let localModified = '';
    if (fs.existsSync(METADATA_PATH) && fs.existsSync(DATA_PATH)) {
      try {
        const meta = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf8'));
        localModified = meta.lastModified || '';
      } catch {}
    }

    const updateAvailable = !localModified || (lastModified && localModified !== lastModified);
    return NextResponse.json({
      updateAvailable,
      lastModified,
      localModified,
      databaseExists: fs.existsSync(DATA_PATH)
    });
  } catch (err: any) {
    console.error('[Sync Check] Failed to check for NEI 2023 updates:', err.message);
    const exists = fs.existsSync(DATA_PATH);
    return NextResponse.json({
      updateAvailable: !exists,
      error: err.message,
      databaseExists: exists
    });
  }
}

export async function POST() {
  try {
    console.log('[Sync Process] Checking headers first...');
    const headRes = await fetch(ZIP_URL, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    const lastModified = headRes.ok ? (headRes.headers.get('last-modified') || '') : '';

    console.log('[Sync Process] Downloading ZIP file from GAFTP...');
    await downloadFile(ZIP_URL, TEMP_ZIP);
    console.log('[Sync Process] Download complete. Streaming unzip and parsing...');

    const count = await parseAndFilterNeiZip(TEMP_ZIP, DATA_PATH);

    // Save metadata
    fs.writeFileSync(METADATA_PATH, JSON.stringify({
      lastModified,
      lastSynced: new Date().toISOString(),
      recordCount: count
    }, null, 2), 'utf8');

    // Invalidate facilities cache to force a rebuild with updated NEI 2023 data
    const cacheFile = path.join(process.cwd(), 'src', 'cache', 'facilities_MS.json');
    if (fs.existsSync(cacheFile)) {
      try {
        fs.unlinkSync(cacheFile);
        console.log('[Sync Process] Deleted facilities cache to force rebuild.');
      } catch (cacheErr) {
        console.error('[Sync Process] Failed to delete cache file:', cacheErr);
      }
    }

    // Clean up temp zip
    if (fs.existsSync(TEMP_ZIP)) {
      fs.unlinkSync(TEMP_ZIP);
    }

    console.log(`[Sync Process] Successfully synchronized ${count} facilities for 2023 NEI.`);
    return NextResponse.json({ success: true, count, lastModified });
  } catch (err: any) {
    console.error('[Sync Process] Synchronization failed:', err);
    if (fs.existsSync(TEMP_ZIP)) {
      try { fs.unlinkSync(TEMP_ZIP); } catch {}
    }
    return NextResponse.json({ success: false, error: err.message || String(err) }, { status: 500 });
  }
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Server returned status code ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

function parseAndFilterNeiZip(zipPath: string, destJsonPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const unzipProcess = spawn('unzip', ['-p', zipPath, 'emis_sum_fac_37583.csv']);
    const facilities: Record<string, any> = {};

    unzipProcess.stdout
      .pipe(csvParser())
      .on('data', (row: any) => {
        const state = (row['state'] || '').trim().toUpperCase();
        if (state !== 'MS') return;

        const eisId = (row['eis facility id'] || '').trim();
        if (!eisId) return;

        if (!facilities[eisId]) {
          facilities[eisId] = {
            eisId,
            facilityName: (row['site name'] || '').trim(),
            county: (row['county'] || '').trim(),
            fips: (row['fips code'] || '').trim().padStart(5, '0'),
            naics: (row['primary naics code'] || '').trim(),
            emissions: [],
            haps: [],
            year: 2023,
            source: 'NEI 2023 v1'
          };
        }

        const facility = facilities[eisId];
        const pollType = (row['pollutant type(s)'] || '').trim().toUpperCase();
        const pollCode = (row['pollutant code'] || '').trim();
        const pollDesc = (row['pollutant desc'] || '').trim();
        const rawVal = parseFloat(row['total emissions']);
        const uom = (row['emissions uom'] || '').trim().toUpperCase();

        if (isNaN(rawVal) || rawVal <= 0) return;

        let amount = rawVal;
        if (uom === 'LB') {
          amount = rawVal / 2000;
        }
        amount = Math.round(amount * 10000) / 10000;
        if (amount <= 0) return;

        let pollutantName = pollDesc
          .replace(/^(CAP|HAP|GHG):\s*/i, '')
          .replace(/\s*[-–]\s*Tons\s*\/?\s*Year.*/i, '')
          .replace(/\s*\([^)]*\)/g, '')
          .replace(/\s{2,}/g, ' ')
          .trim();

        if (pollType === 'CAP' || pollCode === 'NOX' || pollCode === 'SO2' || pollCode === 'CO' || pollCode.startsWith('PM') || pollCode === 'VOC' || pollCode === 'NH3' || pollCode === 'PB') {
          const exists = facility.emissions.find((e: any) => e.pollutant === pollutantName);
          if (!exists) {
            facility.emissions.push({ pollutant: pollutantName, amount, unit: 'TPY' });
          } else {
            exists.amount = Math.round((exists.amount + amount) * 10000) / 10000;
          }
        } else if (pollType === 'HAP') {
          const exists = facility.haps.find((h: any) => h.pollutant === pollutantName);
          if (!exists) {
            facility.haps.push({ pollutant: pollutantName, amount, unit: 'TPY' });
          } else {
            exists.amount = Math.round((exists.amount + amount) * 10000) / 10000;
          }
        }
      })
      .on('end', () => {
        for (const eisId in facilities) {
          const f = facilities[eisId];
          f.emissions.sort((a: any, b: any) => b.amount - a.amount);
          f.haps.sort((a: any, b: any) => b.amount - a.amount);
        }

        fs.writeFileSync(destJsonPath, JSON.stringify(facilities, null, 2), 'utf8');
        resolve(Object.keys(facilities).length);
      })
      .on('error', (err: any) => {
        reject(err);
      });
  });
}
