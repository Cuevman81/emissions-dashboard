import { NextResponse } from 'next/server';

// CAMPD facilities-mgmt API — provides actual monitored stack data for EGUs (power plants)
const CAMPD_BASE = 'https://api.epa.gov/easey/facilities-mgmt';

async function fetchCamdStackParameters(orisCode: string) {
  try {
    const url = `${CAMPD_BASE}/facilities/facility/${orisCode}/unit-information`;
    
    const headers: HeadersInit = {
      'Accept': 'application/json',
    };
    if (process.env.EPA_CAMD_API_KEY) {
      headers['x-api-key'] = process.env.EPA_CAMD_API_KEY;
    }

    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers,
    });
    if (!res.ok) return null;

    const units: any[] = await res.json();
    if (!Array.isArray(units) || units.length === 0) return null;

    return units
      .map((u: any) => ({
        stackId: u.unitId || u.id || 'UNIT',
        height: u.stackHeight != null ? parseFloat(u.stackHeight) : 0,
        diameter: u.stackDiameter != null ? parseFloat(u.stackDiameter) : 0,
        temp: u.exitGasTemperature != null ? parseFloat(u.exitGasTemperature) : undefined,
        velocity: u.exitGasVelocity != null ? parseFloat(u.exitGasVelocity) : undefined,
        flowRate: u.exitGasFlowRate != null ? parseFloat(u.exitGasFlowRate) : undefined,
        description: u.unitType || 'EGU Unit (CAMPD/CEMS)',
      }))
      .filter(s => s.height > 0);
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

  // --- Path 1: EGU — query CAMPD for unit-level stack parameters ---
  if (camdId) {
    console.log(`Stacks: trying CAMPD for EGU ORIS ${camdId}`);
    const camdStacks = await fetchCamdStackParameters(camdId);
    if (camdStacks && camdStacks.length > 0) {
      console.log(`CAMPD: returned ${camdStacks.length} units for ORIS ${camdId}`);
      return NextResponse.json(camdStacks);
    }
  }

  // --- Path 2: Try NEI/EIS efservice (EIS_RELEASE_POINT — currently deprecated, may be restored) ---
  const url = `https://data.epa.gov/efservice/EIS_RELEASE_POINT/FACILITY_REGISTRY_ID/equals/${registryId}/JSON`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (res.ok) {
      const data = await res.json();
      // EIS returns an error object when table is unavailable
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
    // EIS endpoint unavailable — fall through to empty response
  }

  // No stack data found — return empty array; UI shows upload option
  return NextResponse.json([]);
}
