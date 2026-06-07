'use client';

import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { Loader2, FlaskConical, BarChart3, AlertTriangle, ShieldAlert, Activity, Clock } from 'lucide-react';
import { CustomTooltip } from '@/components/ChartTooltips';
import {
  Facility,
  HapRecord,
  fetchHaps,
  fetchNeiFacility,
  NeiFacilityData,
  AqsMonitor,
  getNearestMonitor,
} from '@/lib/data-service';
import { shortenChemicalName } from '@/lib/constants';

interface ToxicsTabProps {
  selectedFacility: Facility;
  neiData: NeiFacilityData | null;
  setNeiData: (d: NeiFacilityData | null) => void;
  neiLoading: boolean;
  setNeiLoading: (b: boolean) => void;
  isMounted: boolean;
  aqsMonitors: AqsMonitor[];
  showAqsMonitors: boolean;
  handleAqsToggle: () => void;
  aqsError: string | null;
  aqsLoading: boolean;
  filterReported: boolean;
  mapTriYear: string;
}

export default function ToxicsTab({
  selectedFacility, neiData, setNeiData, neiLoading, setNeiLoading, isMounted,
  aqsMonitors, showAqsMonitors, handleAqsToggle, aqsError, aqsLoading,
  filterReported, mapTriYear,
}: ToxicsTabProps) {
  const [toxics, setToxics] = useState<HapRecord[]>([]);
  const [toxicsYear, setToxicsYear] = useState<number | string | null>(null);
  const [toxicsLoading, setToxicsLoading] = useState(false);
  const [historicalHaps, setHistoricalHaps] = useState<Record<string, HapRecord[]>>({});
  const [isTRIReporter, setIsTRIReporter] = useState<boolean | null>(null);
  const [availableToxicsYears, setAvailableToxicsYears] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setToxicsLoading(true);
      setIsTRIReporter(null);
      setToxicsYear(null);
      setHistoricalHaps({});

      if (selectedFacility.eisId) {
        setNeiLoading(true);
        fetchNeiFacility(selectedFacility.eisId)
          .then(result => { if (!cancelled) { setNeiData(result); setNeiLoading(false); } })
          .catch(() => { if (!cancelled) setNeiLoading(false); });
      }

      const targetYear = (filterReported && mapTriYear !== 'All') ? mapTriYear : undefined;
      const data = await fetchHaps(selectedFacility.id, selectedFacility.triId ?? undefined, targetYear);
      if (cancelled) return;

      setToxics(data.haps);
      setToxicsYear(data.year);
      setAvailableToxicsYears(data.availableYears || []);
      setHistoricalHaps(data.historicalHaps || {});
      setIsTRIReporter(data.isTRIReporter ?? null);
      setToxicsLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [selectedFacility.id]);

  // Ambient context panel
  const nearest = getNearestMonitor(selectedFacility.lat, selectedFacility.lon, aqsMonitors);
  const isAqsOff = !showAqsMonitors;

  return (
    <>
      {/* Ambient Context */}
      {(() => {
        if (isAqsOff) {
          return (
            <div className="mb-6 p-4 bg-slate-50 rounded-xl border border-dashed border-slate-200">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <FlaskConical className="h-3.5 w-3.5" /> Ambient Check
                </h3>
                <button onClick={handleAqsToggle} className="text-[10px] font-bold text-indigo-600 hover:underline">Enable AQS Layer</button>
              </div>
              <p className="text-[10px] text-slate-400">Enable the AQS layer to find the nearest EPA monitoring station for this facility.</p>
            </div>
          );
        }

        if (aqsError) {
          return (
            <div className="mb-6 p-4 bg-red-50 rounded-xl border border-red-100">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-bold text-red-700 flex items-center gap-2">
                  <ShieldAlert className="h-3.5 w-3.5" /> AQS Link Failed
                </h3>
              </div>
              <p className="text-[10px] text-red-600 leading-tight">{aqsError}</p>
              <button onClick={handleAqsToggle} className="mt-2 text-[10px] font-bold text-red-700 hover:underline">Retry Connection →</button>
            </div>
          );
        }

        if (!nearest || nearest.distance > 30) {
          return (
            <div className="mb-6 p-4 bg-amber-50 rounded-xl border border-amber-100">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-bold text-amber-700 flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5" /> No Monitors Nearby
                </h3>
                <span className="text-[9px] text-amber-400 font-medium">Radius: 30mi</span>
              </div>
              {aqsLoading ? (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
                  <span className="text-[10px] text-amber-600">Querying EPA Data Mart...</span>
                </div>
              ) : (
                <p className="text-[10px] text-amber-600 leading-tight">
                  {aqsMonitors.length === 0
                    ? "AQS server returned no active monitors for this state. Try again in a few moments."
                    : "No EPA AQS monitoring sites found within 30 miles of this facility."}
                </p>
              )}
              <div className="mt-2 pt-2 border-t border-amber-100 flex justify-between text-[8px] font-mono text-amber-400 uppercase tracking-tighter">
                <span>Fac: {selectedFacility.lat.toFixed(3)}, {selectedFacility.lon.toFixed(3)}</span>
                <span>Sites: {aqsMonitors.length}</span>
              </div>
            </div>
          );
        }

        return (
          <div className="mb-6 p-4 bg-indigo-50/50 rounded-xl border border-indigo-100 shadow-sm border-l-4 border-l-indigo-500">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-indigo-900 flex items-center gap-2">
                <Activity className="h-4 w-4" /> Nearby Ambient Context
              </h3>
              <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold">
                {(nearest.distance ?? 0).toFixed(1)} mi away
              </span>
            </div>
            <p className="text-[10px] text-indigo-600 mb-2 leading-tight">
              Nearest ambient monitor: <strong>{nearest.monitor.local_site_name || nearest.monitor.county}</strong>.
              {nearest.monitor.pollutants && nearest.monitor.pollutants.length > 0 && (
                <> Monitors: {nearest.monitor.pollutants.slice(0, 4).join(', ')}{nearest.monitor.pollutants.length > 4 ? '...' : ''}.</>
              )}
            </p>
            <p className="text-[8px] text-indigo-400 italic">See NAAQS tab for design values. Click monitor on map for details.</p>
            <div className="mt-2 pt-2 border-t border-indigo-100 flex justify-between text-[8px] font-mono text-indigo-400 uppercase tracking-tighter">
              <span>Fac: {selectedFacility.lat.toFixed(3)}, {selectedFacility.lon.toFixed(3)}</span>
              <span>Mon: {nearest.monitor.lat.toFixed(3)}, {nearest.monitor.lon.toFixed(3)}</span>
            </div>
          </div>
        );
      })()}

      {/* HAPs Inventory */}
      <div className="border-t border-slate-100 pt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">HAPs Inventory (TRI)</h3>
          {availableToxicsYears.length > 0 ? (
            <select
              value={toxicsYear || ''}
              onChange={async (e) => {
                const yr = e.target.value;
                setToxicsLoading(true);
                const data = await fetchHaps(selectedFacility.id, selectedFacility.triId ?? undefined, yr);
                setToxics(data.haps);
                setToxicsYear(data.year);
                setToxicsLoading(false);
              }}
              className="text-[10px] font-bold px-2 py-1 rounded bg-purple-100 text-purple-700 border-none outline-none focus:ring-1 focus:ring-purple-400 cursor-pointer"
            >
              {availableToxicsYears.map(yr => (
                <option key={yr} value={yr}>{yr} TRI</option>
              ))}
            </select>
          ) : toxicsYear ? (
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">{toxicsYear} TRI</span>
          ) : null}
        </div>
        <p className="text-[9px] text-slate-300 mb-3 leading-relaxed">
          Chemical air releases from EPA Toxics Release Inventory (TRI Form R). Actual releases in tons/year.
        </p>
        {toxicsLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 italic py-4">
            <Loader2 className="h-3 w-3 animate-spin" /> Fetching TRI inventory...
          </div>
        ) : toxics.length > 0 ? (
          <>
            <div className="space-y-1.5 mb-6">
              {toxics.map((h, i) => {
                const isTons = h.unit.toLowerCase().includes('ton') || h.unit.toLowerCase() === 'tpy';
                const tonsVal = isTons ? h.amount : h.amount / 2000;
                const lbsVal = isTons ? h.amount * 2000 : h.amount;
                const formattedTons = tonsVal === 0 ? '0' : (tonsVal < 0.0001 ? '<0.0001' : tonsVal.toLocaleString(undefined, { maximumFractionDigits: 4 }));
                const formattedLbs = lbsVal === 0 ? '0' : (lbsVal < 0.1 ? '<0.1' : lbsVal.toLocaleString(undefined, { maximumFractionDigits: 2 }));
                return (
                  <div key={i} className="flex items-center justify-between bg-purple-50/50 p-2 rounded border border-purple-100 hover:border-purple-200 transition-colors">
                    <span className="text-xs font-medium text-slate-700 pr-2">{h.pollutant}</span>
                    <div className="text-right flex-shrink-0">
                      <div className="text-xs font-bold text-purple-700">
                        {formattedTons} <span className="font-normal text-[9px] text-slate-500">Tons/Yr</span>
                      </div>
                      <div className="text-[10px] font-semibold text-slate-500 mt-0.5">
                        {formattedLbs} <span className="font-normal text-[9px] text-slate-400">lbs/yr</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Trend Chart */}
            {Object.keys(historicalHaps).length > 1 && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Historical Release Trend</h3>
                <div className="h-64 w-full">
                  {isMounted ? (
                    <ResponsiveContainer width="100%" height="100%">
                      {(() => {
                        const pollutantTotals: Record<string, number> = {};
                        Object.values(historicalHaps).forEach(arr => {
                          arr.forEach(h => { pollutantTotals[h.pollutant] = (pollutantTotals[h.pollutant] || 0) + h.amount; });
                        });
                        const sortedPollutants = Object.keys(pollutantTotals).sort((a, b) => pollutantTotals[b] - pollutantTotals[a]);
                        const topPollutants = sortedPollutants.slice(0, 5);
                        const hasOthers = sortedPollutants.length > 5;
                        const years = Object.keys(historicalHaps).sort((a, b) => parseInt(a) - parseInt(b));
                        const chartData = years.map(y => {
                          const point: any = { year: y };
                          let otherSum = 0;
                          historicalHaps[y].forEach(h => {
                            if (topPollutants.includes(h.pollutant)) { point[h.pollutant] = h.amount; }
                            else { otherSum += h.amount; }
                          });
                          if (hasOthers) point['Other HAPs (Combined)'] = otherSum;
                          return point;
                        });
                        const linesToRender = [...topPollutants];
                        if (hasOthers) linesToRender.push('Other HAPs (Combined)');
                        const colors = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#94a3b8'];
                        return (
                          <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                            <XAxis dataKey="year" fontSize={9} tickMargin={8} tick={{ fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                            <YAxis fontSize={9} tick={{ fill: '#94A3B8' }} axisLine={false} tickLine={false} tickFormatter={(val) => val < 1 && val > 0 ? '<1' : val} />
                            <Tooltip content={<CustomTooltip />} position={{ x: -175, y: 15 }} />
                            <Legend wrapperStyle={{ fontSize: '9px', paddingTop: '10px' }} iconType="circle" height={45} verticalAlign="bottom" formatter={shortenChemicalName} />
                            {linesToRender.map((pollutant, idx) => (
                              <Line
                                key={pollutant} type="monotone" dataKey={pollutant}
                                stroke={pollutant === 'Other HAPs (Combined)' ? '#94a3b8' : colors[idx % (colors.length - 1)]}
                                strokeWidth={pollutant === 'Other HAPs (Combined)' ? 1.5 : 2}
                                strokeDasharray={pollutant === 'Other HAPs (Combined)' ? '4 4' : undefined}
                                dot={{ r: 3, strokeWidth: 1 }} activeDot={{ r: 5, strokeWidth: 0 }}
                              />
                            ))}
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
          </>
        ) : (
          <div className="text-center py-8 bg-slate-50 rounded-lg border border-dashed border-slate-200 text-slate-400 text-xs px-4">
            {isTRIReporter === false ? (
              <>
                <p className="font-semibold text-slate-500 mb-1">Not a TRI Reporter</p>
                <p className="text-[10px] text-slate-400 leading-relaxed">HAP data is only required for facilities in covered NAICS codes that process listed chemicals above reporting thresholds.</p>
              </>
            ) : isTRIReporter === true ? (
              <div className="flex flex-col items-center justify-center py-4">
                <span className="text-2xl font-bold text-slate-300">0</span>
                <p className="font-semibold text-slate-500 mb-1">lbs Air Releases (TRI)</p>
                <p className="text-[10px] text-slate-400 leading-relaxed max-w-xs text-center">
                  Facility reported to TRI but indicated exactly zero air releases for {toxicsYear ? `the ${toxicsYear} reporting year.` : 'this year.'}
                </p>
              </div>
            ) : (
              <p className="text-[10px] text-slate-300">Select a facility to view TRI data.</p>
            )}
            <a
              href={`https://echo.epa.gov/facilities/facility-search/results?facility_uin=${selectedFacility.id}`}
              target="_blank" rel="noopener noreferrer"
              className="inline-block mt-3 text-[9px] font-bold text-blue-600 hover:underline"
            >
              View on EPA ECHO →
            </a>
          </div>
        )}

        {/* NEI 2020 HAPs */}
        {(neiLoading || (neiData?.found && neiData.haps.length > 0)) && (
          <div className="border-t border-slate-100 pt-5 mt-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                <BarChart3 className="h-3 w-3" /> NEI 2020 HAPs
              </h3>
              {!neiLoading && (
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">2020 NEI</span>
              )}
            </div>
            {neiLoading ? (
              <div className="flex items-center gap-2 text-xs text-slate-400 italic py-3">
                <Loader2 className="h-3 w-3 animate-spin" /> Querying NEI 2020…
              </div>
            ) : (
              <>
                <p className="text-[9px] text-slate-400 mb-2">
                  Hazardous air pollutants (HAPs) — 2020 NEI facility-reported, actual emissions.
                </p>
                <div className="space-y-1">
                  {neiData!.haps.map((h, i) => (
                    <div key={i} className="flex items-center justify-between bg-violet-50/60 p-1.5 rounded border border-violet-100">
                      <span className="text-[9px] font-medium text-slate-600 truncate max-w-[60%]">{h.pollutant}</span>
                      <span className="text-[9px] font-bold text-violet-700 ml-1 shrink-0">
                        {h.amount < 0.0001 ? '<0.0001' : h.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} TPY
                      </span>
                    </div>
                  ))}
                </div>
                {neiData?.county && <p className="text-[9px] text-slate-300 mt-2">County: {neiData.county} · FIPS: {neiData.fips}</p>}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
