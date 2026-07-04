export const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'D.C.'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
] as const;

// PSD Significant Emission Rates — 40 CFR 52.21(b)(23)(i), tons/year.
// Note: PM (total) is 25 tpy, PM10 is 15 tpy, PM2.5 is 10 tpy direct.
export const PSD_SER: Record<string, number> = {
  'CO': 100,
  'NOx': 40,
  'SO2': 40,
  'PM': 25,
  'PM10': 15,
  'PM2.5': 10,
  'VOC': 40,
  'Lead': 0.6,
  'H2SO4 Mist': 7,
  'Fluorides': 3,
  'H2S': 10,
  'TRS': 10,
};

export function normalizePsdPollutant(name: string): string | null {
  const n = name.toLowerCase().trim();
  if ((n.includes('carbon monoxide') || n === 'co') && !n.includes('co2')) return 'CO';
  if (n.includes('nox') || n.includes('nitrogen ox')) return 'NOx';
  if (n.includes('so2') || n.includes('sulfur diox')) return 'SO2';
  if (n.includes('pm2.5') || n.includes('pm 2.5') || n.includes('fine parti')) return 'PM2.5';
  if (n.includes('pm10') || n.includes('pm 10')) return 'PM10';
  // PM (total) catch-all AFTER the size-specific checks. Excludes fraction-only
  // records ("PM Condensible"/"Filterable") — those aren't a total-PM figure.
  if ((n === 'pm' || n.startsWith('pm ') || n.includes('particulate') || n === 'tsp') &&
      !n.includes('condens') && !n.includes('filterable')) return 'PM';
  if (n.includes('voc') || n.includes('volatile organic') || n.includes('nmhc')) return 'VOC';
  if (n.includes('lead') || n === 'pb') return 'Lead';
  if (n.includes('sulfuric acid') || n.includes('h2so4')) return 'H2SO4 Mist';
  if (n.includes('fluoride')) return 'Fluorides';
  if (n.includes('hydrogen sulfide') || n === 'h2s') return 'H2S';
  if (n.includes('total reduced sulfur') || n === 'trs') return 'TRS';
  return null;
}

// Mandatory Federal Class I Areas relevant to Mississippi-region PSD review
// (South-Central US). Coordinates are representative interior points — actual
// boundary distances are shorter. FLAG guidance calls for FLM notification for
// sources locating within ~300 km of a Class I area; verify with the FLM.
export interface ClassIArea {
  name: string;
  state: string;
  agency: string;
  lat: number;
  lon: number;
}

export const CLASS_I_AREAS_SC: ClassIArea[] = [
  { name: 'Breton Wilderness', state: 'LA', agency: 'US Fish & Wildlife Service', lat: 29.75, lon: -88.95 },
  { name: 'Sipsey Wilderness', state: 'AL', agency: 'US Forest Service', lat: 34.33, lon: -87.43 },
  { name: 'Caney Creek Wilderness', state: 'AR', agency: 'US Forest Service', lat: 34.38, lon: -94.04 },
  { name: 'Upper Buffalo Wilderness', state: 'AR', agency: 'US Forest Service', lat: 35.83, lon: -93.38 },
  { name: 'Mingo Wilderness', state: 'MO', agency: 'US Fish & Wildlife Service', lat: 36.97, lon: -90.14 },
  { name: 'Hercules-Glades Wilderness', state: 'MO', agency: 'US Forest Service', lat: 36.68, lon: -92.92 },
];

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function shortenChemicalName(name: string): string {
  if (!name) return '';
  const n = name.trim();
  
  const lower = n.toLowerCase();
  if (lower.includes('hydrochloric acid')) {
    if (lower.includes('1995')) return 'Hydrochloric acid (1995+)';
    if (lower.includes('mists')) return 'Hydrochloric acid (aerosols)';
    return 'Hydrochloric Acid';
  }
  if (lower.includes('sulfuric acid')) {
    if (lower.includes('1994')) return 'Sulfuric acid (1994+)';
    if (lower.includes('mists')) return 'Sulfuric acid (aerosols)';
    return 'Sulfuric Acid';
  }
  
  if (n.length > 45) {
    return n.substring(0, 42) + '...';
  }
  
  return n;
}
