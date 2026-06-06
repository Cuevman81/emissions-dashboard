import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const CACHE_DIR = path.join(process.cwd(), 'src', 'cache');
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

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
                description: `EGU Unit (CAMD/CEMS locId: ${locId})`
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const registryId = searchParams.get('registryId');
  const camdId = searchParams.get('camdId'); // ORIS code — present for EGU power plants

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
          return NextResponse.json(JSON.parse(cachedData));
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

      return NextResponse.json(camdStacks);
    }
  }

  // --- Path 2: Try NEI/EIS efservice (EIS_RELEASE_POINT) ---
  const url = `https://data.epa.gov/efservice/EIS_RELEASE_POINT/FACILITY_REGISTRY_ID/equals/${registryId}/JSON`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0 && !data[0]?.error) {
        const stacks = data
          .map((item: any) => ({
            stackId: item.RELEASE_POINT_ID || 'N/A',
            height: parseFloat(item.STACK_HEIGHT_VALUE) || 0,
            diameter: parseFloat(item.STACK_DIAMETER_VALUE) || 0,
            temp: item.EXIT_GAS_TEMPERATURE_VALUE != null ? parseFloat(item.EXIT_GAS_TEMPERATURE_VALUE) : undefined,
            velocity: item.EXIT_GAS_VELOCITY_VALUE != null ? parseFloat(item.EXIT_GAS_VELOCITY_VALUE) : undefined,
            flowRate: item.EXIT_GAS_FLOW_RATE_VALUE != null ? parseFloat(item.EXIT_GAS_FLOW_RATE_VALUE) : undefined,
            description: item.RELEASE_POINT_DESCRIPTION || 'Point Source',
          }))
          .filter(s => s.height > 0);

        if (stacks.length > 0) {
          return NextResponse.json(stacks);
        }
      }
    }
  } catch {
    // ignore and return empty
  }

  // No stack data found
  return NextResponse.json([]);
}
