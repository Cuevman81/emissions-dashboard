// Build src/lib/nei_2023_stacks_MS.json: 2023 NEI release-point stack parameters for
// Mississippi, keyed by EIS facility ID, from EPA's national point flat file on GAFTP.
//
//   node scripts/sync_nei_stacks.mjs                 # download the newest file, then parse
//   node scripts/sync_nei_stacks.mjs --zip <file>    # parse a copy you already downloaded
//
// POST /api/sync-nei runs this script when EPA posts a newer point file. Needs `unzip`.
//
// The file is SMOKE FF10_POINT format: one row per release point x process x pollutant,
// about 11.8 million rows (a ~253 MB zip holding a ~4 GB CSV), not sorted by state.
// Stack parameters are kept in the FF10 units, which are also the app's display units:
// STKHGT ft, STKDIAM ft, STKTEMP deg F, STKVEL ft/s, STKFLOW ft3/s (SMOKE PTINV FF10_POINT
// spec). Nothing is converted here; StackInventory.tsx converts to m, K and m/s for AERMOD.
import fs from 'fs';
import path from 'path';
import https from 'https';
import readline from 'readline';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJ_ROOT = path.join(__dirname, '..');
const LIB_DIR = path.join(PROJ_ROOT, 'src', 'lib');
const OUT_DATA = path.join(LIB_DIR, 'nei_2023_stacks_MS.json');
const OUT_META = path.join(LIB_DIR, 'nei_2023_stacks_metadata.json');
const TEMP_ZIP = path.join(PROJ_ROOT, 'scratch', 'nei_2023_point_temp.zip');

const FLAT_DIR = 'https://gaftp.epa.gov/Air/nei/2023/flat_files/';
const STATE = 'MS';
const STATE_FIPS = '28'; // REGION_CD is the 5-digit state+county FIPS code

// EIS release point types. 2-6 are stacks; 1 (fugitive area), 8 (3-D fugitive) and
// 9 (2-D fugitive) are fugitive releases with no stack, and are dropped along with any
// other code. SMOKE and EPA's modeling platform treat ERPTYPE 1 as the fugitive code
// ("stack releases (ERPtype NOT equal to '1')", 2014v7.1 platform TSD Table 2-4); the
// 8/9 fugitive codes are from EPA's 2024 EIS point-source best-practices training.
const STACK_TYPES = { 2: 'Vertical', 3: 'Horizontal', 4: 'Goose neck', 5: 'Vertical with rain cap', 6: 'Downward-facing vent' };

// Keywords EPA writes into the COMMENT column when it changed or computed a release
// parameter (2014v7.1 platform TSD Tables 2-4 and 2-7; the same keywords appear in the
// 2023 NEI file). Only the release-parameter ones are kept: the rest of COMMENT is about
// emissions (augmentation, gap-fill) and does not describe the stack.
const EPA_FLAG_RE = /\bERP(VelCompute|VelRange|HtRange|DiamRange|TempRange|Cokeoven126)\b/g;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

// Newest SmokeFlatFile_POINT_<yyyymmdd>.zip in the folder, with its HTTP headers.
async function findPointFile() {
  const res = await fetch(FLAT_DIR, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`GAFTP listing returned status ${res.status}`);
  const names = [...(await res.text()).matchAll(/href="(SmokeFlatFile_POINT_(\d{8})\.zip)"/g)]
    .sort((a, b) => Number(a[2]) - Number(b[2]));
  const newest = names.at(-1);
  if (!newest) throw new Error('No SmokeFlatFile_POINT_*.zip in the GAFTP flat_files listing');
  const url = FLAT_DIR + newest[1];
  const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
  if (!head.ok) throw new Error(`GAFTP HEAD ${newest[1]} returned status ${head.status}`);
  return {
    file: newest[1],
    url,
    lastModified: head.headers.get('last-modified') || '',
    size: Number(head.headers.get('content-length')) || null,
  };
}

function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Download returned status ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

// FF10 is plain CSV; only COMMENT and DATA_SET_ID are ever quoted.
function splitCsv(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const num = (s) => {
  const t = (s ?? '').trim();
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

async function parse(zipPath) {
  const unzip = spawn('unzip', ['-p', zipPath]);
  let unzipErr = '';
  unzip.stderr.on('data', (d) => { unzipErr += d; });
  const unzipDone = new Promise((resolve) => unzip.on('close', resolve));
  const rl = readline.createInterface({ input: unzip.stdout.setEncoding('latin1'), crlfDelay: Infinity });

  const header = {};
  let cols = null;
  let ix = null;
  let prefilter = false;
  let rows = 0;
  let stateRows = 0;
  const points = new Map(); // `${facility}|${relPoint}` -> release point

  for await (const line of rl) {
    if (!cols) {
      if (line.startsWith('#')) {
        const m = line.match(/^#([A-Z_]+)=(.*)$/);
        if (m) header[m[1]] = m[2].replace(/^"|"$/g, '');
        continue;
      }
      cols = splitCsv(line).map((c) => c.trim());
      ix = Object.fromEntries(cols.map((c, i) => [c, i]));
      for (const c of ['REGION_CD', 'FACILITY_ID', 'REL_POINT_ID', 'ERPTYPE', 'STKHGT', 'STKDIAM', 'STKTEMP', 'STKFLOW', 'STKVEL', 'LATITUDE', 'LONGITUDE', 'COMMENT']) {
        if (!(c in ix)) throw new Error(`Column ${c} is missing from the flat file header`);
      }
      // REGION_CD is the second column in FF10_POINT, so rows from other states can be
      // skipped without splitting the whole line.
      prefilter = ix.REGION_CD === 1;
      continue;
    }
    if (!line) continue;
    rows++;
    if (prefilter) {
      const c1 = line.indexOf(',');
      if (line.slice(c1 + 1, c1 + 3) !== STATE_FIPS) continue;
    }
    const r = splitCsv(line);
    if (!r[ix.REGION_CD].startsWith(STATE_FIPS)) continue;
    stateRows++;

    const key = `${r[ix.FACILITY_ID]}|${r[ix.REL_POINT_ID]}`;
    const params = ['STKHGT', 'STKDIAM', 'STKTEMP', 'STKVEL', 'STKFLOW', 'ERPTYPE', 'LATITUDE', 'LONGITUDE'].map((c) => r[ix[c]].trim()).join(',');
    let p = points.get(key);
    if (!p) {
      p = {
        facilityId: r[ix.FACILITY_ID].trim(),
        facilityName: (r[ix.FACILITY_NAME] ?? '').trim(),
        relPointId: r[ix.REL_POINT_ID].trim(),
        agencyId: (r[ix.AGY_REL_POINT_ID] ?? '').trim(),
        type: parseInt(r[ix.ERPTYPE], 10),
        height: num(r[ix.STKHGT]),
        diameter: num(r[ix.STKDIAM]),
        temp: num(r[ix.STKTEMP]),
        velocity: num(r[ix.STKVEL]),
        flow: num(r[ix.STKFLOW]),
        lat: num(r[ix.LATITUDE]),
        lon: num(r[ix.LONGITUDE]),
        params,
        epaFlags: new Set(),
        conflicting: false,
      };
      points.set(key, p);
    } else if (p.params !== params) {
      p.conflicting = true; // the first row's values are kept
    }
    for (const m of (r[ix.COMMENT] ?? '').matchAll(EPA_FLAG_RE)) p.epaFlags.add(`ERP${m[1]}`);
  }

  const code = await unzipDone;
  if (code !== 0) throw new Error(`unzip exited with code ${code}: ${unzipErr.trim()}`);
  if (!cols) throw new Error('The zip held no FF10 header row');
  return { header, rows, stateRows, points };
}

function build(points) {
  const facilities = {};
  const droppedByType = {};
  const flagCounts = {};
  let stackCount = 0;

  for (const p of points.values()) {
    if (!STACK_TYPES[p.type]) {
      droppedByType[p.type] = (droppedByType[p.type] || 0) + 1;
      continue;
    }
    const flags = [...p.epaFlags].sort();
    // Checks EPA does not flag. A 0 deg F exit temperature passes EIS range checks but is
    // usually a placeholder (AERMOD reads Stktmp 0 as "ambient"); missing values are
    // shown as missing, never filled in.
    if (p.temp === 0) flags.push('TempZero');
    const missing = [];
    if (!(p.height > 0)) missing.push('height');
    if (!(p.diameter > 0)) missing.push('diameter');
    if (p.temp == null) missing.push('temp');
    if (!(p.velocity > 0)) missing.push('velocity');
    if (missing.length) flags.push('Missing');
    if (p.conflicting) flags.push('Conflicting');
    for (const f of flags) flagCounts[f] = (flagCounts[f] || 0) + 1;

    const stack = {
      id: p.agencyId || `RP${p.relPointId}`,
      rp: p.relPointId,
      type: p.type,
      height: p.height,
      diameter: p.diameter,
      temp: p.temp,
      velocity: p.velocity,
      flow: p.flow,
      lat: p.lat,
      lon: p.lon,
    };
    if (missing.length) stack.missing = missing;
    if (flags.length) stack.flags = flags;
    const fac = (facilities[p.facilityId] ||= { name: p.facilityName, stacks: [] });
    fac.stacks.push(stack);
    stackCount++;
  }

  // Tallest first, which is the order a modeler usually reviews them in.
  for (const f of Object.values(facilities)) {
    f.stacks.sort((a, b) => (b.height ?? -1) - (a.height ?? -1) || a.id.localeCompare(b.id));
  }
  const sorted = Object.fromEntries(Object.entries(facilities).sort(([a], [b]) => Number(a) - Number(b)));
  return { facilities: sorted, stackCount, droppedByType, flagCounts };
}

// One stack per line keeps the file small and its git diffs readable.
function serialize(doc) {
  const { facilities, ...head } = doc;
  const parts = Object.entries(facilities).map(([id, f]) =>
    `    ${JSON.stringify(id)}: { "name": ${JSON.stringify(f.name)}, "stacks": [\n` +
    f.stacks.map((s) => `      ${JSON.stringify(s)}`).join(',\n') + '\n    ] }');
  const headJson = JSON.stringify(head, null, 2).replace(/\n}$/, '');
  return `${headJson},\n  "facilities": {\n${parts.join(',\n')}\n  }\n}\n`;
}

function writeAtomic(dest, text) {
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, dest);
}

async function main() {
  const localZip = arg('--zip');
  const t0 = Date.now();
  const remote = await findPointFile();
  console.log(`[NEI stacks] Newest point flat file: ${remote.file} (${remote.size} bytes, Last-Modified ${remote.lastModified})`);

  let zipPath = localZip;
  if (localZip) {
    const size = fs.statSync(localZip).size;
    if (path.basename(localZip) !== remote.file || size !== remote.size) {
      throw new Error(`${localZip} (${size} bytes) is not the current ${remote.file} (${remote.size} bytes)`);
    }
  } else {
    console.log(`[NEI stacks] Downloading ${remote.url} ...`);
    await download(remote.url, TEMP_ZIP);
    zipPath = TEMP_ZIP;
  }

  try {
    console.log('[NEI stacks] Parsing (about a minute for ~4 GB of CSV)...');
    const { header, rows, stateRows, points } = await parse(zipPath);
    const { facilities, stackCount, droppedByType, flagCounts } = build(points);
    const facilityCount = Object.keys(facilities).length;
    // A renamed column or a changed layout must never replace the dataset with nothing.
    if (facilityCount === 0 || stackCount === 0) {
      throw new Error(`No ${STATE} stacks parsed from ${remote.file} (${rows} rows, ${stateRows} ${STATE} rows)`);
    }
    const neiYear = Number(header.YEAR) || 2023;

    writeAtomic(OUT_DATA, serialize({
      neiYear,
      state: STATE,
      source: `EPA ${neiYear} NEI point flat file (${header.FORMAT || 'FF10_POINT'}, ${header.INVENTORY_VERSION || 'unknown version'})`,
      file: remote.file,
      units: { height: 'ft', diameter: 'ft', temp: 'degF', velocity: 'ft/s', flow: 'ft3/s', lat: 'deg', lon: 'deg' },
      types: STACK_TYPES,
      facilities,
    }));
    writeAtomic(OUT_META, JSON.stringify({
      file: remote.file,
      url: remote.url,
      lastModified: remote.lastModified,
      size: remote.size,
      neiYear,
      inventoryVersion: header.INVENTORY_VERSION || '',
      creationDate: header.CREATION_DATE || '',
      lastSynced: new Date().toISOString(),
      rows,
      stateRows,
      releasePoints: points.size,
      facilityCount,
      stackCount,
      droppedByType,
      flagCounts,
    }, null, 2) + '\n');

    console.log(`[NEI stacks] ${rows} rows, ${stateRows} ${STATE} rows, ${points.size} ${STATE} release points.`);
    console.log(`[NEI stacks] Kept ${stackCount} stacks at ${facilityCount} facilities; dropped (non-stack ERPTYPE): ${JSON.stringify(droppedByType)}; flags: ${JSON.stringify(flagCounts)}`);
    console.log(`[NEI stacks] Wrote ${path.relative(PROJ_ROOT, OUT_DATA)} (${fs.statSync(OUT_DATA).size} bytes) in ${Math.round((Date.now() - t0) / 1000)} s.`);
  } finally {
    if (!localZip && fs.existsSync(TEMP_ZIP)) fs.unlinkSync(TEMP_ZIP);
  }
}

main().catch((err) => {
  console.error('[NEI stacks] Failed:', err.message);
  process.exit(1);
});
