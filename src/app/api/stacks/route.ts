import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import type { StackParameter } from '@/lib/data-service';

const CACHE_DIR = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), 'src', 'cache');
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
// Built offline by scripts/sync_nei_stacks.mjs from EPA's 2023 NEI point flat file
const NEI_STACKS_PATH = path.join(process.cwd(), 'src', 'lib', 'nei_2023_stacks_MS.json');

const SOURCE_LABELS = {
  CAMD: 'CAMD monitor plan',
  NEI: 'NEI 2023 release points',
  Estimate: 'industry-median estimate',
} as const;
type StackSource = keyof typeof SOURCE_LABELS;

function stacksResponse(stacks: StackParameter[], source: StackSource) {
  return NextResponse.json(stacks, { headers: { 'X-Stack-Source': SOURCE_LABELS[source] } });
}

async function fetchCamdStackParameters(orisCode: string) {
  const apiKey = process.env.EPA_CAMD_API_KEY || '';
  try {
    // 1. Get configurations to find all locations
    const configUrl = `https://api.epa.gov/easey/monitor-plan-mgmt/configurations?orisCodes=${orisCode}`;
    
    const headers: HeadersInit = {
      'Accept': 'application/json',
    };
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    const configRes = await fetch(configUrl, { headers });
    if (!configRes.ok) return null;
    const configData = await configRes.json();
    const items = configData.items || [];

    // Extract unique location IDs
    const locationIds = new Set<string>();
    const locNames: Record<string, string> = {};
    for (const config of items) {
      for (const loc of (config.monitoringLocationData || [])) {
        if (loc.id) {
          locationIds.add(loc.id);
          locNames[loc.id] = loc.name || loc.unitId || loc.stackPipeId || 'UNIT';
        }
      }
    }

    if (locationIds.size === 0) return null;

    // 2. Fetch attributes for each location in parallel
    const stacks: any[] = [];
    await Promise.all(
      Array.from(locationIds).map(async (locId) => {
        try {
          const attrUrl = `https://api.epa.gov/easey/monitor-plan-mgmt/locations/${locId}/attributes`;
          const attrRes = await fetch(attrUrl, { headers });
          if (!attrRes.ok) return;
          const attrData = await attrRes.json();
          const attrItems = attrData.items || [];
          for (const attr of attrItems) {
            const height = attr.stackHeight ? parseFloat(attr.stackHeight) : 0;
            const area = attr.crossAreaStackExit ? parseFloat(attr.crossAreaStackExit) : 0;
            // Calculate diameter: area = pi * d^2 / 4 => d = sqrt(4 * area / pi)
            const diameter = area > 0 ? Math.round(Math.sqrt((4 * area) / Math.PI) * 10) / 10 : 0;

            if (height > 0) {
              stacks.push({
                stackId: locNames[locId] || 'UNIT',
                height,
                diameter,
                description: `EGU Unit (CAMD/CEMS locId: ${locId})`,
                dataSource: 'CAMD',
                sourceLabel: SOURCE_LABELS.CAMD,
                dataYear: String(new Date().getFullYear()),
              });
            }
          }
        } catch {
          // ignore error for this location
        }
      })
    );

    return stacks;
  } catch {
    return null;
  }
}

interface NeiStack {
  id: string;
  rp: string;
  type: number;
  height: number | null;
  diameter: number | null;
  temp: number | null;
  velocity: number | null;
  flow: number | null;
  lat: number | null;
  lon: number | null;
  missing?: string[];
  flags?: string[];
}
interface NeiStackData {
  neiYear: number;
  types: Record<string, string>;
  facilities: Record<string, { name: string; stacks: NeiStack[] }>;
}

// Parsed once per server instance; re-read if a local sync rewrites the file.
let neiStackCache: { mtimeMs: number; data: NeiStackData } | null = null;

function loadNeiStacks(): NeiStackData | null {
  try {
    const { mtimeMs } = fs.statSync(NEI_STACKS_PATH);
    if (!neiStackCache || neiStackCache.mtimeMs !== mtimeMs) {
      neiStackCache = { mtimeMs, data: JSON.parse(fs.readFileSync(NEI_STACKS_PATH, 'utf8')) };
    }
    return neiStackCache.data;
  } catch (err) {
    console.error('Failed to read NEI stack dataset:', err);
    return null;
  }
}

// NEI release points (stacks only; fugitives were dropped when the file was built), in
// the NEI's own units, which are the app's: ft, ft, deg F, ft/s, ft3/s. No conversion here.
function getNeiStacks(eisId: string): StackParameter[] | null {
  const data = loadNeiStacks();
  const facility = data?.facilities[eisId];
  if (!data || !facility || facility.stacks.length === 0) return null;
  const year = String(data.neiYear);
  return facility.stacks.map((s) => ({
    stackId: s.id,
    height: s.height ?? 0,
    diameter: s.diameter ?? 0,
    temp: s.temp ?? undefined,
    velocity: s.velocity ?? undefined,
    flowRate: s.flow ?? undefined,
    releaseType: data.types[String(s.type)] || `Type ${s.type}`,
    releaseTypeCode: s.type,
    releasePointId: s.rp,
    lat: s.lat ?? undefined,
    lon: s.lon ?? undefined,
    flags: s.flags,
    missing: s.missing,
    description: `NEI ${year} release point ${s.rp}`,
    dataSource: 'NEI' as const,
    sourceLabel: SOURCE_LABELS.NEI,
    dataYear: year,
  }));
}

function getFallbackIndustryStacks(naics: string | null, sector: string | null): any[] {
  const n3 = naics ? naics.substring(0, 3) : '';
  const n4 = naics ? naics.substring(0, 4) : '';
  
  let height = 45;      // ft
  let diameter = 2.5;    // ft
  let temp = 150;       // °F
  let velocity = 30;    // fps
  let sectorName = sector || 'General Industrial';
  
  if (sector === 'Power Plant' || n3 === '221') {
    height = 250;
    diameter = 12.0;
    temp = 280;
    velocity = 55;
    sectorName = 'Power Generation EGU';
  } else if (sector === 'Refinery' || n3 === '324') {
    height = 120;
    diameter = 5.0;
    temp = 350;
    velocity = 45;
    sectorName = 'Petroleum Refinery';
  } else if (sector === 'Chemical' || n3 === '325') {
    height = 75;
    diameter = 3.0;
    temp = 200;
    velocity = 35;
    sectorName = 'Chemical Manufacturing';
  } else if (sector === 'Cement' || n4 === '3273') {
    height = 110;
    diameter = 6.0;
    temp = 300;
    velocity = 40;
    sectorName = 'Cement/Concrete';
  } else if (sector === 'Paper/Pulp' || n3 === '322') {
    height = 140;
    diameter = 7.0;
    temp = 280;
    velocity = 45;
    sectorName = 'Pulp & Paper Mill';
  } else if (sector === 'Steel' || n3 === '331') {
    height = 95;
    diameter = 4.5;
    temp = 350;
    velocity = 40;
    sectorName = 'Primary Metals / Steel';
  } else if (n3 === '321') { // Wood Products
    height = 60;
    diameter = 3.0;
    temp = 200;
    velocity = 35;
    sectorName = 'Wood Products Manufacturing';
  } else if (n3 === '486') { // Pipelines / Compressor Stations
    height = 35;
    diameter = 2.0;
    temp = 700; // hot exhaust
    velocity = 85;
    sectorName = 'Pipeline Compressor Station';
  } else if (n3 === '311' || n3 === '312') { // Food & Beverage
    height = 50;
    diameter = 2.5;
    temp = 180;
    velocity = 30;
    sectorName = 'Food & Beverage';
  } else if (n3 === '562') { // Waste Management / Landfills
    height = 35;
    diameter = 2.5;
    temp = 120;
    velocity = 25;
    sectorName = 'Waste Management';
  }

  return [
    {
      stackId: 'EST-1',
      height,
      diameter,
      temp,
      velocity,
      description: `Estimated Industry Standard (EPA RSEI Median for ${sectorName})`,
      dataSource: 'Estimate' as const,
      sourceLabel: SOURCE_LABELS.Estimate,
      dataYear: undefined,
    }
  ];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const registryId = searchParams.get('registryId');
  const camdIdRaw = searchParams.get('camdId'); // ORIS code — present for EGU power plants
  // ORIS codes are numeric — validate before using in URLs and file paths
  const camdId = camdIdRaw && /^\d+$/.test(camdIdRaw) ? camdIdRaw : null;
  const naics = searchParams.get('naics');
  const sector = searchParams.get('sector');
  // EIS facility IDs are numeric (from ECHO's EisIDs field)
  const eisIdRaw = searchParams.get('eisId');
  const eisId = eisIdRaw && /^\d+$/.test(eisIdRaw) ? eisIdRaw : null;

  if (!registryId) {
    return NextResponse.json([], { status: 400 });
  }

  // --- Path 1: EGU — query CAMD for unit-level stack parameters ---
  if (camdId) {
    // Check cache first
    const cacheKey = `stacks_${camdId}.json`;
    const cachePath = path.join(CACHE_DIR, cacheKey);

    if (fs.existsSync(cachePath)) {
      try {
        const stats = fs.statSync(cachePath);
        if (Date.now() - stats.mtimeMs < CACHE_TTL) {
          console.log(`[Cache] Loading CAMD stacks for ${camdId} from disk...`);
          const cachedData = fs.readFileSync(cachePath, 'utf8');
          return stacksResponse(JSON.parse(cachedData), 'CAMD');
        }
      } catch (cacheErr) {
        console.error('Failed to read CAMD stacks cache:', cacheErr);
      }
    }

    console.log(`Stacks: trying CAMD for EGU ORIS ${camdId}`);
    const camdStacks = await fetchCamdStackParameters(camdId);
    if (camdStacks && camdStacks.length > 0) {
      console.log(`CAMD: returned ${camdStacks.length} units for ORIS ${camdId}`);
      
      // Save to cache
      try {
        if (!fs.existsSync(CACHE_DIR)) {
          fs.mkdirSync(CACHE_DIR, { recursive: true });
        }
        fs.writeFileSync(cachePath, JSON.stringify(camdStacks), 'utf8');
        console.log(`[Cache] Saved CAMD stacks for ${camdId} to disk.`);
      } catch (cacheErr) {
        console.error('Failed to write CAMD stacks cache:', cacheErr);
      }

      return stacksResponse(camdStacks, 'CAMD');
    }
  }

  // --- Path 2: NEI 2023 release points (Mississippi), from the packed dataset ---
  // Envirofacts retired EIS_RELEASE_POINT (404 "The table is not available."), so the
  // stacks come from the 2023 NEI point flat file, extracted offline.
  if (eisId) {
    const neiStacks = getNeiStacks(eisId);
    if (neiStacks) {
      console.log(`Stacks: ${neiStacks.length} NEI release points for EIS ${eisId}`);
      return stacksResponse(neiStacks, 'NEI');
    }
  }

  // --- Path 3: RSEI median industry fallback ---
  console.log(`Stacks: returning fallback for registryId ${registryId} (eisId: ${eisId}, naics: ${naics}, sector: ${sector})`);
  const fallbackStacks = getFallbackIndustryStacks(naics, sector);
  return stacksResponse(fallbackStacks, 'Estimate');
}
