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

export const PSD_SER: Record<string, number> = {
  'CO': 100,
  'NOx': 40,
  'SO2': 40,
  'PM10': 25,
  'PM2.5': 10,
  'VOC': 40,
  'Lead': 0.6,
};

export function normalizePsdPollutant(name: string): string | null {
  const n = name.toLowerCase().trim();
  if ((n.includes('carbon monoxide') || n === 'co') && !n.includes('co2')) return 'CO';
  if (n.includes('nox') || n.includes('nitrogen ox')) return 'NOx';
  if (n.includes('so2') || n.includes('sulfur diox')) return 'SO2';
  if (n.includes('pm2.5') || n.includes('pm 2.5') || n.includes('fine parti')) return 'PM2.5';
  if (n.includes('pm10') || n.includes('pm 10')) return 'PM10';
  if (n.includes('voc') || n.includes('volatile organic') || n.includes('nmhc')) return 'VOC';
  if (n.includes('lead') || n === 'pb') return 'Lead';
  return null;
}
