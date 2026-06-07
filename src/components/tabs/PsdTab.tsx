'use client';

import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { Loader2, BarChart3, Database, ShieldAlert } from 'lucide-react';
import { CamdTooltip } from '@/components/ChartTooltips';
import StackInventory from '@/components/StackInventory';
import { PSD_SER, normalizePsdPollutant } from '@/lib/constants';
import {
  Facility,
  StackParameter,
  EmissionRecord,
  fetchEmissions,
  fetchNeiFacility,
  NeiFacilityData,
} from '@/lib/data-service';

interface PsdTabProps {
  selectedFacility: Facility;
  neiData: NeiFacilityData | null;
  setNeiData: (d: NeiFacilityData | null) => void;
  neiLoading: boolean;
  setNeiLoading: (b: boolean) => void;
  isMounted: boolean;
}

export default function PsdTab({ selectedFacility, neiData, setNeiData, neiLoading, setNeiLoading, isMounted }: PsdTabProps) {
  const [stacks, setStacks] = useState<StackParameter[]>([]);
  const [stacksLoading, setStacksLoading] = useState(false);
  const [emissions, setEmissions] = useState<EmissionRecord[]>([]);
  const [emissionsYear, setEmissionsYear] = useState<number | null>(null);
  const [emissionsLoading, setEmissionsLoading] = useState(false);
  const [historicalEmissions, setHistoricalEmissions] = useState<Record<string, EmissionRecord[]>>({});
  const [manualEmissions, setManualEmissions] = useState<EmissionRecord[]>([]);
  const [showManualEmissionForm, setShowManualEmissionForm] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);
  const [localStackData, setLocalStackData] = useState<Record<string, StackParameter[]>>({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setEmissionsLoading(true);
      setManualEmissions([]);

      if (selectedFacility.eisId) {
        setNeiLoading(true);
        fetchNeiFacility(selectedFacility.eisId)
          .then(result => { if (!cancelled) { setNeiData(result); setNeiLoading(false); } })
          .catch(() => { if (!cancelled) setNeiLoading(false); });
      }

      const data = await fetchEmissions(selectedFacility.id, selectedFacility.camdId ?? undefined);
      if (cancelled) return;
      setEmissions(data.emissions);
      setEmissionsYear(data.year);
      setHistoricalEmissions(data.historicalEmissions || {});
      setIsSimulated(data.isSimulated);
      setEmissionsLoading(false);

      if (localStackData[selectedFacility.id]) {
        setStacks(localStackData[selectedFacility.id]);
        return;
      }
      setStacksLoading(true);
      const stackParams = new URLSearchParams({ registryId: selectedFacility.id });
      if (selectedFacility.camdId) stackParams.set('camdId', selectedFacility.camdId);
      if (selectedFacility.naics) stackParams.set('naics', selectedFacility.naics);
      if (selectedFacility.sector) stackParams.set('sector', selectedFacility.sector);
      const stackRes = await fetch(`/api/stacks?${stackParams}`);
      if (cancelled) return;
      const stackData: StackParameter[] = stackRes.ok ? await stackRes.json() : [];
      setStacks(stackData);
      setStacksLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [selectedFacility.id]);

  const combinedEmissions = [...emissions, ...manualEmissions];
  let actualEmissions = combinedEmissions.filter(e => e.emissionsType === 'actual' || !e.emissionsType);
  const pteEmissions = combinedEmissions.filter(e => e.emissionsType === 'potential');

  const isNeiFallback = actualEmissions.length === 0 && neiData?.found && neiData.emissions.length > 0;
  if (isNeiFallback) {
    actualEmissions = neiData!.emissions.map(ne => ({
      pollutant: ne.pollutant,
      amount: ne.amount,
      unit: 'Tons/Year',
      emissionsType: 'actual' as const,
    }));
  } else if (selectedFacility.camdId && neiData?.found && neiData.emissions.length > 0) {
    const existingPollutants = new Set(
      actualEmissions.map(e => normalizePsdPollutant(e.pollutant)).filter(Boolean) as string[]
    );
    neiData.emissions.forEach(ne => {
      const normNe = normalizePsdPollutant(ne.pollutant);
      if (normNe && !existingPollutants.has(normNe)) {
        actualEmissions.push({
          pollutant: ne.pollutant,
          amount: ne.amount,
          unit: 'Tons/Year',
          emissionsType: 'actual' as const,
        });
      }
    });
  }

  const hasEmissionsData = actualEmissions.length > 0 || pteEmissions.length > 0;

  return (
    <>
      {/* Emissions Section */}
      <div className="border-t border-slate-100 pt-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
            <BarChart3 className="h-3 w-3" /> Criteria Pollutant Emissions
          </h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowManualEmissionForm(!showManualEmissionForm)}
              className="text-[9px] font-bold px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
            >
              {showManualEmissionForm ? 'Cancel' : '+ Add Data'}
            </button>
            {emissionsYear && !isSimulated && (
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                {emissionsYear} CAMPD
              </span>
            )}
          </div>
        </div>

        {showManualEmissionForm && (
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 mb-4">
            <p className="text-[10px] font-bold text-slate-500 mb-2 uppercase">Add Manual Emission Record</p>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input id="manual-pollutant" placeholder="Pollutant (e.g. PM2.5)" className="text-xs p-1.5 border rounded" />
              <input id="manual-amount" type="number" placeholder="Amount (TPY)" className="text-xs p-1.5 border rounded" />
            </div>
            <button
              onClick={() => {
                const p = (document.getElementById('manual-pollutant') as HTMLInputElement).value;
                const a = parseFloat((document.getElementById('manual-amount') as HTMLInputElement).value);
                if (p && !isNaN(a)) {
                  setManualEmissions([...manualEmissions, { pollutant: p, amount: a, unit: 'TPY', emissionsType: 'actual' }]);
                  setShowManualEmissionForm(false);
                }
              }}
              className="w-full bg-blue-600 text-white text-xs font-bold py-1.5 rounded hover:bg-blue-700"
            >
              Add Record
            </button>
          </div>
        )}

        {emissionsLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 italic py-4">
            <Loader2 className="h-3 w-3 animate-spin" /> Fetching emissions data...
          </div>
        ) : hasEmissionsData ? (
          <div className="mb-6 space-y-4">
            {selectedFacility.camdId && (
              <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-2.5 text-[10px] text-blue-700 leading-relaxed flex gap-2">
                <Database className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Data Source Note:</span> For electricity generating units (EGUs),
                  SO₂ and NOₓ values are fetched live from <span className="font-semibold">EPA CAMD ({emissionsYear || '2023-2025'})</span>.
                  PM, VOC, CO, and Lead values are populated from the <span className="font-semibold">2020 NEI</span>.
                </div>
              </div>
            )}
            {actualEmissions.length > 0 && (
              <div>
                <p className="text-[9px] font-bold text-blue-600 uppercase tracking-widest mb-1.5">Actual Emissions</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {actualEmissions.map((e, i) => (
                    <div key={i} className="bg-blue-50/60 p-2 rounded border border-blue-100 relative group">
                      <p className="text-[8px] font-bold text-slate-400 uppercase">{e.pollutant}</p>
                      <p className="text-xs font-bold text-blue-700">{e.amount.toLocaleString()} <span className="font-normal text-[9px] text-slate-400">{e.unit}</span></p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {pteEmissions.length > 0 && (
              <div>
                <p className="text-[9px] font-bold text-amber-600 uppercase tracking-widest mb-1.5">Potential to Emit (PTE)</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {pteEmissions.map((e, i) => (
                    <div key={i} className="bg-amber-50/60 p-2 rounded border border-amber-100">
                      <p className="text-[8px] font-bold text-slate-400 uppercase">{e.pollutant}</p>
                      <p className="text-xs font-bold text-amber-700">{e.amount.toLocaleString()} <span className="font-normal text-[9px] text-slate-400">TPY</span></p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Historical CAMD Trend Chart */}
            {selectedFacility.camdId && Object.keys(historicalEmissions).length > 1 && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Historical CEMS Trend (CAMD)</h3>
                <div className="h-56 w-full">
                  {isMounted ? (
                    <ResponsiveContainer width="100%" height="100%">
                      {(() => {
                        const years = Object.keys(historicalEmissions).sort((a, b) => parseInt(a) - parseInt(b));
                        const chartData = years.map(y => {
                          const so2Match = historicalEmissions[y].find(e => normalizePsdPollutant(e.pollutant) === 'SO2');
                          const noxMatch = historicalEmissions[y].find(e => normalizePsdPollutant(e.pollutant) === 'NOx');
                          return { year: y, 'SO2': so2Match ? so2Match.amount : 0, 'NOx': noxMatch ? noxMatch.amount : 0 };
                        });
                        return (
                          <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                            <XAxis dataKey="year" fontSize={9} tickMargin={8} tick={{ fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                            <YAxis fontSize={9} tick={{ fill: '#94A3B8' }} axisLine={false} tickLine={false} unit=" T" />
                            <Tooltip content={<CamdTooltip />} position={{ x: -175, y: 15 }} />
                            <Legend wrapperStyle={{ fontSize: '9px', marginTop: '10px' }} iconType="circle" />
                            <Line type="monotone" dataKey="SO2" name="SO2 (Tons)" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3, strokeWidth: 1, stroke: '#3b82f6', fill: '#fff' }} activeDot={{ r: 5, strokeWidth: 0, fill: '#3b82f6' }} />
                            <Line type="monotone" dataKey="NOx" name="NOx (Tons)" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, strokeWidth: 1, stroke: '#f59e0b', fill: '#fff' }} activeDot={{ r: 5, strokeWidth: 0, fill: '#f59e0b' }} />
                          </LineChart>
                        );
                      })()}
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full w-full bg-slate-50/50 animate-pulse rounded-lg flex items-center justify-center text-[10px] text-slate-400">Loading chart...</div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : !emissionsLoading ? (
          <div className="mb-4 text-center py-6 bg-slate-50 rounded-lg border border-dashed border-slate-200 px-4">
            <p className="text-[10px] text-slate-500 font-medium mb-1">
              {selectedFacility.camdId ? 'No CAMPD emissions data for this unit.' : 'Emissions data not available via EPA API.'}
            </p>
            <p className="text-[9px] text-slate-400 leading-relaxed mb-2">
              {selectedFacility.camdId
                ? 'This EGU may not have recent CEMS monitoring records.'
                : 'EPA EIS_ANNUAL_EMISSIONS endpoint is deprecated. Use "+ Add Data" to manually enter values from the report below.'}
            </p>
            <a
              href={`https://echo.epa.gov/air-pollutant-report/air-pollutant-report?facility_uin=${selectedFacility.id}`}
              target="_blank" rel="noopener noreferrer"
              className="text-[9px] font-bold text-blue-600 hover:underline"
            >
              View ECHO Air Pollutant Report →
            </a>
          </div>
        ) : null}
      </div>

      {/* PSD Significance Threshold Screener */}
      {hasEmissionsData && (() => {
        const serRows: { key: string; ser: number; actual: number | null; pte: number | null }[] = [];
        Object.entries(PSD_SER).forEach(([key, ser]) => {
          const actualMatch = actualEmissions.find(e => normalizePsdPollutant(e.pollutant) === key);
          const pteMatch = pteEmissions.find(e => normalizePsdPollutant(e.pollutant) === key);
          if (actualMatch || pteMatch) {
            serRows.push({ key, ser, actual: actualMatch ? actualMatch.amount : null, pte: pteMatch ? pteMatch.amount : null });
          }
        });
        if (serRows.length === 0) return null;
        const anyExceedance = serRows.some(r => (r.actual !== null && r.actual >= r.ser) || (r.pte !== null && r.pte >= r.ser));
        return (
          <div className="border-t border-slate-100 pt-5 mt-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <ShieldAlert className="h-3 w-3" /> PSD Significance Screener
              </h3>
              {anyExceedance ? (
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Exceeds SER</span>
              ) : (
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Below SER</span>
              )}
            </div>
            <p className="text-[9px] text-slate-400 mb-2 leading-relaxed">
              Compare against PSD Significant Emission Rates (40 CFR 52.21). Red = meets or exceeds significance threshold.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[9px]">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left font-bold text-slate-400 uppercase pb-1 pr-2">Pollutant</th>
                    <th className="text-right font-bold text-blue-500 uppercase pb-1 px-2">Actual</th>
                    <th className="text-right font-bold text-amber-600 uppercase pb-1 px-2">PTE</th>
                    <th className="text-right font-bold text-slate-400 uppercase pb-1 pl-2">SER</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {serRows.map(({ key, ser, actual, pte }) => {
                    const actualOver = actual !== null && actual >= ser;
                    const pteOver = pte !== null && pte >= ser;
                    return (
                      <tr key={key}>
                        <td className="font-bold text-slate-600 py-1 pr-2">{key}</td>
                        <td className="text-right py-1 px-2">
                          {actual !== null ? (
                            <span className={`font-bold ${actualOver ? 'text-red-600' : 'text-blue-600'}`}>
                              {actual >= 1 ? actual.toLocaleString(undefined, { maximumFractionDigits: 1 }) : actual.toFixed(3)}
                              {actualOver && ' ⚠'}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="text-right py-1 px-2">
                          {pte !== null ? (
                            <span className={`font-bold ${pteOver ? 'text-red-600' : 'text-amber-600'}`}>
                              {pte >= 1 ? pte.toLocaleString(undefined, { maximumFractionDigits: 1 }) : pte.toFixed(3)}
                              {pteOver && ' ⚠'}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="text-right font-mono text-slate-400 py-1 pl-2">{ser}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[8px] text-slate-300 mt-2">All values in TPY · SER = Significant Emission Rate · ⚠ = PSD significance triggered</p>
          </div>
        );
      })()}

      {/* NEI 2020 Reported Emissions */}
      {(neiLoading || (neiData?.found && neiData.emissions.length > 0)) && (
        <div className="border-t border-slate-100 pt-5 mt-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
              <BarChart3 className="h-3 w-3" /> NEI 2020 Reported
            </h3>
            {!neiLoading && (
              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">2020 NEI</span>
            )}
          </div>
          {neiLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400 italic py-3">
              <Loader2 className="h-3 w-3 animate-spin" /> Querying NEI 2020…
            </div>
          ) : (
            <>
              {neiData!.emissions.length > 0 && (
                <>
                  <p className="text-[9px] text-slate-400 mb-2">Criteria air pollutants (CAPs) — facility-reported, actual emissions.</p>
                  <div className="grid grid-cols-2 gap-1.5 mb-3">
                    {neiData!.emissions.map((e, i) => (
                      <div key={i} className="bg-emerald-50/70 p-2 rounded border border-emerald-100">
                        <p className="text-[8px] font-bold text-slate-400 uppercase truncate">{e.pollutant}</p>
                        <p className="text-xs font-bold text-emerald-700">{e.amount.toLocaleString()} <span className="font-normal text-[9px] text-slate-400">{e.unit}</span></p>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {neiData?.county && <p className="text-[9px] text-slate-300 mt-2">County: {neiData.county} · FIPS: {neiData.fips}</p>}
            </>
          )}
        </div>
      )}

      <StackInventory
        stacks={stacks}
        loading={stacksLoading}
        facilityName={selectedFacility.name}
        camdId={selectedFacility.camdId}
        onUpload={(data) => {
          setLocalStackData(prev => ({ ...prev, [selectedFacility.id]: data }));
          setStacks(data);
        }}
      />
    </>
  );
}
