import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/**
 * Enhanced Export API
 * 
 * This route handles the batch resolution of NEI 2020 emissions and TRI HAP data.
 * It is optimized for bulk CSV exports to avoid N+1 frontend fetch waterfalls.
 */

const NEI_SERVICE = 'https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/NEI2020_Facilities_March2023/FeatureServer/0/query';

export async function POST(request: Request) {
    try {
        const { eisIds, triIds, mode, year } = await request.json();

        const results: Record<string, any> = {};

        // 1. Resolve NEI 2020 Data (Bulk ArcGIS Query)
        if (mode === 'PSD' && eisIds && eisIds.length > 0) {
            // ArcGIS 'IN' clauses have limits; we'll batch into chunks of 50 just in case
            const chunks = [];
            for (let i = 0; i < eisIds.length; i += 50) {
                chunks.push(eisIds.slice(i, i + 50));
            }

            for (const chunk of chunks) {
                const idList = chunk.map((id: string) => `'${id}'`).join(',');
                const url = `${NEI_SERVICE}?where=EIS_Facility_ID IN (${idList})&outFields=*&f=json`;

                const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
                if (res.ok) {
                    const data = await res.json();
                    (data.features || []).forEach((f: any) => {
                        const attr = f.attributes;
                        let pm25 = 0, nox = 0, so2 = 0, voc = 0, co = 0;

                        // Dynamically scan properties because ArcGIS alters/truncates field names
                        for (const [key, val] of Object.entries(attr)) {
                            if (typeof val !== 'number') continue;
                            const k = key.toUpperCase();
                            if (k.includes('PM2_5_PRIMARY')) pm25 = val;
                            if (k.includes('NITROGEN_OXIDES')) nox = val;
                            if (k.includes('SULFUR_DIOXIDE')) so2 = val;
                            if (k.includes('VOLATILE_ORGANIC')) voc = val;
                            if (k.includes('CARBON_MONOXIDE')) co = val;
                        }

                        if (pm25 || nox || so2 || voc || co) {
                            results[attr.EIS_Facility_ID] = { pm25, nox, so2, voc, co };
                        }
                    });
                }
            }
        }

        // 2. Resolve TRI HAP Data (Local JSON)
        if (mode === 'Toxics' && triIds && triIds.length > 0) {
            const jsonPath = path.join(process.cwd(), 'src', 'lib', 'tri_emissions.json');
            if (fs.existsSync(jsonPath)) {
                const localEmissions = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                triIds.forEach((triId: string) => {
                    const facilityData = localEmissions[triId];
                    if (facilityData) {
                        const targetYear = (year && facilityData.years[year]) ? year : facilityData.latestYear;
                        const haps = facilityData.years[targetYear] || [];
                        const totalHaps = haps.reduce((sum: number, h: any) => sum + h.amount, 0);
                        const hapsList = haps.map((h: any) => `${h.pollutant}: ${h.amount} lbs`).join(' | ');

                        results[triId] = {
                            totalHaps,
                            year: targetYear,
                            hapCount: haps.length,
                            hapsList
                        };
                    }
                });
            }
        }

        return NextResponse.json(results);
    } catch (err: any) {
        console.error('Export API error:', err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
