// Parse EPA ECHO air_rest_services facility records into the dashboard's facility
// shape. Shared by /api/facilities and scripts/refresh_facilities_seed.mjs, which
// imports this file directly through Node's TypeScript type stripping — keep it free
// of imports and of TS-only runtime syntax (enums, namespaces, parameter properties).

// ECHO air_rest_services field names (from actual API response)
export interface EchoFacility {
  RegistryID?: string;
  AIRName?: string;       // facility name
  AIRStreet?: string;
  AIRCity?: string;
  AIRState?: string;
  AIRZip?: string;
  FacLat?: string;
  FacLong?: string;       // NOTE: longitude is "FacLong" not "FacLon"
  AIRUniverse?: string;   // e.g. "Major", "Synthetic Minor", "Minor Emissions"
  AIRClassification?: string;
  AIRHpvStatus?: string;  // e.g. "No High Priority Violation" / "High Priority Violation"
  TRIIDs?: string;
  CamdIDs?: string;       // ORIS plant code — non-null means EGU with CEMS data in CAMPD
  EisIDs?: string;        // NEI/EIS facility ID
  AIRNAICS?: string;      // Primary NAICS code (air program NAICS from ECHO)
  FacNaics?: string;      // Alternate NAICS field (some ECHO response shapes)
  FacPrimaryNaicsCode?: string; // Alternate NAICS field
  [key: string]: string | undefined;
}

type FacilitySector =
  | 'Power Plant'
  | 'Refinery'
  | 'Chemical'
  | 'Cement'
  | 'Paper/Pulp'
  | 'Steel'
  | 'Oil & Gas'
  | 'Wood Products'
  | 'Metal Fabrication'
  | 'Plastics/Rubber'
  | 'Pipeline/Compressor'
  | 'Food Processing'
  | 'Transportation Equip'
  | 'Waste Management'
  | 'Other';

function deriveSector(camdId: string | null, naics: string | undefined): FacilitySector {
  // CAMPD ORIS code is the definitive indicator of an EGU/power plant
  if (camdId) return 'Power Plant';
  if (!naics) return 'Other';
  const n = naics.trim();
  if (n.startsWith('2211')) return 'Power Plant';         // electric power generation
  if (n.startsWith('3241')) return 'Refinery';            // petroleum & coal products
  if (n.startsWith('325')) return 'Chemical';            // chemical manufacturing
  if (n.startsWith('3273') || n.startsWith('3272')) return 'Cement'; // cement & concrete
  if (n.startsWith('3221') || n.startsWith('3222')) return 'Paper/Pulp'; // paper mills
  if (n.startsWith('3311') || n.startsWith('3312')) return 'Steel'; // iron & steel

  // Prominent sub-sectors from "Other"
  if (n.startsWith('211')) return 'Oil & Gas';            // oil & gas extraction
  if (n.startsWith('321')) return 'Wood Products';        // wood products manufacturing
  if (n.startsWith('332')) return 'Metal Fabrication';    // metal fabrication
  if (n.startsWith('326')) return 'Plastics/Rubber';      // plastics & rubber manufacturing
  if (n.startsWith('486')) return 'Pipeline/Compressor';  // pipelines & compressor stations
  if (n.startsWith('311') || n.startsWith('312')) return 'Food Processing'; // food & beverage
  if (n.startsWith('336')) return 'Transportation Equip'; // transportation equipment
  if (n.startsWith('562')) return 'Waste Management';     // waste management & landfills

  return 'Other';
}

function normalizePermitType(raw: string | undefined): 'Major' | 'Synthetic Minor' | 'Federally Reportable Minor' | 'Other' {
  if (!raw) return 'Other';
  const t = raw.toLowerCase();
  if (t.includes('major')) return 'Major';
  if (t.includes('synthetic')) return 'Synthetic Minor';
  if (t.includes('federally') || t.includes('minor emissions') || t.includes('reportable')) return 'Federally Reportable Minor';
  return 'Other';
}

function extractFirstTRIId(triIds: string | undefined): string | null {
  if (!triIds || triIds === 'None' || triIds === '' || triIds === 'null') return null;
  return triIds.split(',')[0].trim() || null;
}

export function parseEchoFacilities(raw: EchoFacility[], state: string) {
  const seenIds = new Set<string>();
  return raw
    .map(f => {
      const lat = parseFloat(f.FacLat || '0');
      const lon = parseFloat(f.FacLong || '0'); // NOTE: field is FacLong, not FacLon
      const id = f.RegistryID || '';
      if (!id || !lat || !lon || isNaN(lat) || isNaN(lon) || lat === 0 || seenIds.has(id)) return null;
      seenIds.add(id);

      // Permit classification comes from AIRUniverse or AIRClassification
      const classification = f.AIRUniverse || f.AIRClassification || '';
      const permitType = normalizePermitType(classification);
      const isMajor = classification.toLowerCase().includes('major');
      const hasHpv = (f.AIRHpvStatus || '').toLowerCase().includes('high priority violation') &&
        !(f.AIRHpvStatus || '').toLowerCase().includes('no high priority');

      const camdId = f.CamdIDs && f.CamdIDs !== 'null' && f.CamdIDs !== 'None'
        ? f.CamdIDs.split(',')[0].trim() : null;
      const eisId = f.EisIDs && f.EisIDs !== 'null' && f.EisIDs !== 'None'
        ? f.EisIDs.split(',')[0].trim() : null;

      const naics = f.AIRNAICS || f.FacNaics || f.FacPrimaryNaicsCode || '';
      const sector = deriveSector(camdId, naics);

      return {
        id,
        triId: extractFirstTRIId(f.TRIIDs),
        camdId,   // ORIS code — present for EGU/power plants
        eisId,    // NEI/EIS facility ID
        name: f.AIRName || 'Unknown Facility',
        address: f.AIRStreet || '',
        city: f.AIRCity || '',
        state: f.AIRState || state,
        zip: f.AIRZip || '',
        lat,
        lon,
        permitType,
        isMajor,
        hasHpv,
        dataSource: 'ECHO' as const,
        naics,
        sector,
      };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);
}
