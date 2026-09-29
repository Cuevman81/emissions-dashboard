// Rebuild src/lib/facilities_<ST>_seed.json: the facility roster /api/facilities serves
// when EPA ECHO is unreachable and there is no cached copy (e.g. a Vercel cold start
// during an ECHO outage). Rebuild it now and then so outages fall back to a current list.
//
//   node scripts/refresh_facilities_seed.mjs              # Mississippi
//   node scripts/refresh_facilities_seed.mjs --state AL   # another state
//   node scripts/refresh_facilities_seed.mjs --force      # skip the shrinkage check
//
// The seed holds only the parsed ECHO facilities. When the route falls back to it, it
// adds the local TRI facilities, TRI years and NEI 2023 flags itself, exactly as it does
// for a live roster. Parsing uses the app's own parser (src/lib/echo-facilities.ts),
// imported through Node's TypeScript type stripping, so this needs Node 22.18 or newer.
//
// ECHO fails requests in bursts, so every request is retried patiently. The script
// refuses to write a roster that is incomplete or much smaller than the current seed.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ECHO_BASE = 'https://echodata.epa.gov/echo';
const ATTEMPTS = 12;
const RETRY_DELAY_MS = 15000;
const MIN_SHARE_OF_CURRENT = 0.8; // refuse a roster below 80% of the current seed's

const args = process.argv.slice(2);
const stateArg = args.includes('--state') ? args[args.indexOf('--state') + 1] : 'MS';
const state = (stateArg || '').toUpperCase();
const force = args.includes('--force');
if (!/^[A-Z]{2}$/.test(state)) {
  console.error(`Invalid --state "${stateArg}". Use a two-letter code, e.g. --state MS.`);
  process.exit(1);
}

// The parser is an ES module .ts file and package.json declares no "type", so Node
// prints a MODULE_TYPELESS_PACKAGE_JSON notice when loading it. Hide only that one.
const defaultWarningHandlers = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', w => {
  if (w.code !== 'MODULE_TYPELESS_PACKAGE_JSON') defaultWarningHandlers.forEach(h => h(w));
});

let parseEchoFacilities;
try {
  ({ parseEchoFacilities } = await import('../src/lib/echo-facilities.ts'));
} catch (err) {
  console.error(`Could not load src/lib/echo-facilities.ts (${err.code || err.message}).`);
  console.error(`This script needs Node 22.18 or newer; this is Node ${process.versions.node}.`);
  process.exit(1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchEcho(url, label) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
      // ECHO sometimes sends a plausible JSON body with a 503; trust only 2xx.
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const results = (await res.json())?.Results;
      if (!results) throw new Error('response has no Results object');
      if (results.Error) throw new Error(results.Error.ErrorMessage || JSON.stringify(results.Error));
      return results;
    } catch (err) {
      lastError = err;
      if (attempt < ATTEMPTS) {
        console.warn(`  ${label}: ${err.message} (attempt ${attempt} of ${ATTEMPTS}), retrying in ${RETRY_DELAY_MS / 1000}s`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  throw new Error(`${label} failed after ${ATTEMPTS} attempts: ${lastError.message}`);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedPath = path.join(root, 'src', 'lib', `facilities_${state}_seed.json`);

console.log(`Fetching the active ${state} air facility roster from EPA ECHO...`);
const search = await fetchEcho(
  `${ECHO_BASE}/air_rest_services.get_facilities?p_st=${state}&p_act=Y&output=JSON`,
  'search'
);

let raw;
if (Array.isArray(search.Facilities) && search.Facilities.length > 0) {
  raw = search.Facilities;
} else {
  const total = parseInt(search.TotalFacilitiesFound || search.QueryRows || '0');
  if (!search.QueryID || !total) throw new Error(`ECHO search returned no QueryID or a zero count for ${state}`);
  console.log(`ECHO counts ${total} active facilities (query ${search.QueryID}); downloading pages...`);
  raw = [];
  for (let page = 1; raw.length < total && page <= 10; page++) {
    const results = await fetchEcho(
      `${ECHO_BASE}/air_rest_services.get_qid?qid=${search.QueryID}&pageno=${page}&numrows=1000&output=JSON`,
      `page ${page}`
    );
    const rows = results.Facilities || results.Results || [];
    if (!Array.isArray(rows) || rows.length === 0) break;
    raw.push(...rows);
  }
  if (raw.length < total) {
    throw new Error(`ECHO counted ${total} facilities but returned ${raw.length}; not writing an incomplete seed`);
  }
}

const facilities = parseEchoFacilities(raw, state);
const skipped = raw.length - facilities.length;
console.log(`Parsed ${facilities.length} facilities from ${raw.length} ECHO rows` +
  (skipped ? ` (${skipped} without coordinates or duplicated, same as the live route)` : '') + '.');

let current = [];
if (fs.existsSync(seedPath)) current = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
// Older seeds also held merged TRI facilities; compare ECHO to ECHO
const currentEcho = current.filter(f => f.dataSource === 'ECHO');
if (currentEcho.length > 0) {
  const oldIds = new Set(currentEcho.map(f => f.id));
  const newIds = new Set(facilities.map(f => f.id));
  const added = facilities.filter(f => !oldIds.has(f.id)).length;
  const removed = currentEcho.filter(f => !newIds.has(f.id)).length;
  console.log(`Current seed: ${currentEcho.length} ECHO facilities` +
    (current.length > currentEcho.length ? ` (+${current.length - currentEcho.length} merged TRI facilities, no longer stored)` : '') +
    `. New: ${facilities.length} (${added} added, ${removed} removed).`);
  if (facilities.length < currentEcho.length * MIN_SHARE_OF_CURRENT && !force) {
    console.error(`Refusing to write: the new roster is under ${MIN_SHARE_OF_CURRENT * 100}% of the current seed. ` +
      'If EPA really dropped that many facilities, rerun with --force.');
    process.exit(1);
  }
}

fs.writeFileSync(seedPath, JSON.stringify(facilities), 'utf8');
console.log(`Wrote ${path.relative(root, seedPath)}. Commit and push it so the deployed app falls back to it.`);
