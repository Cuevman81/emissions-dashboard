'use client';

import { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from 'recharts';
import { Loader2, ShieldAlert, ChevronDown, ChevronUp } from 'lucide-react';
import { fetchNaaqsDesignValues, NaaqsDesignValue, NaaqsTrend, NaaqsCompleteness } from '@/lib/data-service';
import { NaaqsTooltip } from '@/components/ChartTooltips';

const POLLUTANT_ORDER = ['O3', 'PM2.5', 'PM10', 'NO2', 'SO2', 'CO'];
const POLLUTANT_COLORS: Record<string, string> = {
  'O3': '#10b981', 'PM2.5': '#8b5cf6', 'PM10': '#f59e0b',
  'NO2': '#ef4444', 'SO2': '#3b82f6', 'CO': '#64748b',
};

interface NaaqsTabProps {
  selectedState: string;
  isMounted: boolean;
}

export default function NaaqsTab({ selectedState, isMounted }: NaaqsTabProps) {
  const [designValues, setDesignValues] = useState<NaaqsDesignValue[]>([]);
  const [trends, setTrends] = useState<NaaqsTrend[]>([]);
  const [completeness, setCompleteness] = useState<NaaqsCompleteness[]>([]);
  const [loading, setLoading] = useState(true);
  const [endYear, setEndYear] = useState<number | undefined>(undefined);
  const [latestYear, setLatestYear] = useState<number>(2024);
  const [pollutantFilter, setPollutantFilter] = useState<string>('All');
  const [showCompleteness, setShowCompleteness] = useState(false);
  const [showTrends, setShowTrends] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchNaaqsDesignValues(selectedState, endYear).then(result => {
      if (cancelled) return;
      setDesignValues(result.designValues);
      setTrends(result.trends);
      setCompleteness(result.completeness);
      setLatestYear(result.latestYear || result.endYear || 2024);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedState, endYear]);

  const yearsList = useMemo(() => {
    const years = [];
    for (let y = latestYear; y >= 2020; y--) {
      years.push(y);
    }
    return years;
  }, [latestYear]);

  // Helper: exclude Jackson NCORE from NO2 data (Pascagoula is the only relevant NO2 site for MS)
  const isNcoreNO2 = (pollutant: string, siteName: string) =>
    pollutant === 'NO2' && siteName.toLowerCase().includes('ncore');

  // Count unique sites per pollutant for badges
  const pollutantSiteCounts = useMemo(() => {
    const counts: Record<string, { sites: number; exceedances: number }> = {};
    for (const p of POLLUTANT_ORDER) {
      const dvs = designValues.filter(dv => dv.pollutant === p && !isNcoreNO2(dv.pollutant, dv.siteName));
      const uniqueSites = new Set(dvs.map(dv => dv.siteId));
      const exceedingSites = new Set(dvs.filter(dv => dv.status === 'Exceedance').map(dv => dv.siteId));
      if (uniqueSites.size > 0) {
        counts[p] = { sites: uniqueSites.size, exceedances: exceedingSites.size };
      }
    }
    return counts;
  }, [designValues]);

  const activePollutants = useMemo(() => {
    return POLLUTANT_ORDER.filter(p => pollutantSiteCounts[p]);
  }, [pollutantSiteCounts]);

  // Filter DVs — exclude PM10 from the table (exceedance-based, not a numeric DV) + NCORE from NO2
  const filteredDvs = useMemo(() => {
    let dvs = designValues.filter(dv => dv.pollutant !== 'PM10' && !isNcoreNO2(dv.pollutant, dv.siteName));
    if (pollutantFilter !== 'All') dvs = dvs.filter(dv => dv.pollutant === pollutantFilter);
    return dvs;
  }, [designValues, pollutantFilter]);

  // Group PM2.5 rows by site for combined display
  const pm25Sites = useMemo(() => {
    const pm25Dvs = filteredDvs.filter(dv => dv.pollutant === 'PM2.5');
    const siteMap = new Map<string, { annual?: NaaqsDesignValue; daily?: NaaqsDesignValue }>();
    for (const dv of pm25Dvs) {
      if (!siteMap.has(dv.siteId)) siteMap.set(dv.siteId, {});
      const entry = siteMap.get(dv.siteId)!;
      if (dv.metric.includes('Annual')) entry.annual = dv;
      else entry.daily = dv;
    }
    return siteMap;
  }, [filteredDvs]);

  // Non-PM2.5 DVs (displayed in the regular table)
  const nonPM25Dvs = useMemo(() => {
    return filteredDvs.filter(dv => dv.pollutant !== 'PM2.5');
  }, [filteredDvs]);

  const trendsByPollutant = useMemo(() => {
    const map: Record<string, NaaqsTrend[]> = {};
    const pollutants = pollutantFilter === 'All' ? activePollutants : [pollutantFilter];
    for (const p of pollutants) {
      // Exclude PM10 trends (exceedance days, not useful for charting)
      if (p === 'PM10') continue;
      map[p] = trends.filter(t => t.pollutant === p && !isNcoreNO2(t.pollutant, t.siteName));
    }
    return map;
  }, [trends, pollutantFilter, activePollutants]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500 mb-3" />
        <p className="text-sm text-slate-500 font-medium">Loading NAAQS Design Values...</p>
        <p className="text-[10px] text-slate-400 mt-1">Querying EPA for {selectedState} ({endYear || latestYear || 'Latest'})</p>
      </div>
    );
  }

  const showPM25 = pollutantFilter === 'All' || pollutantFilter === 'PM2.5';
  const showOtherTable = nonPM25Dvs.length > 0 && pollutantFilter !== 'PM2.5';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">NAAQS Design Values</h3>
          <div className="flex items-center gap-2">
            <select
              value={pollutantFilter}
              onChange={e => setPollutantFilter(e.target.value)}
              className="text-[10px] font-bold px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 outline-none cursor-pointer"
            >
              <option value="All">All Pollutants</option>
              {activePollutants.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <select
              value={endYear || latestYear}
              onChange={e => setEndYear(parseInt(e.target.value))}
              className="text-[10px] font-bold px-2 py-1 rounded bg-slate-50 text-slate-700 border border-slate-200 outline-none cursor-pointer"
            >
              {yearsList.map(yr => (
                <option key={yr} value={yr}>{yr}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-[9px] text-slate-400 leading-relaxed">
          Official EPA design values from the Air Quality Design Values report. Source: EPA ArcGIS FeatureServer.
        </p>
      </div>

      {/* Summary badges */}
      <div className="flex flex-wrap gap-2">
        {activePollutants.map(p => {
          const { sites, exceedances } = pollutantSiteCounts[p];
          return (
            <button
              key={p}
              onClick={() => setPollutantFilter(pollutantFilter === p ? 'All' : p)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                pollutantFilter === p ? 'ring-2 ring-offset-1' : ''
              } ${exceedances > 0
                ? 'bg-red-50 text-red-700 border-red-200'
                : 'bg-green-50 text-green-700 border-green-200'
              }`}
              style={pollutantFilter === p ? { outlineColor: POLLUTANT_COLORS[p] } : {}}
            >
              {p}: {sites} {sites === 1 ? 'site' : 'sites'} {exceedances > 0 && `(${exceedances} exceed)`}
            </button>
          );
        })}
      </div>

      {/* PM2.5 Combined Table — Annual + 24-hr side by side */}
      {showPM25 && pm25Sites.size > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: POLLUTANT_COLORS['PM2.5'] }}>PM2.5</span>
            <span className="text-[9px] text-slate-400">Annual NAAQS: 9.0 µg/m³ · 24-hr NAAQS: 35 µg/m³</span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-[10px]">
              <thead className="bg-purple-50/50 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left font-bold text-slate-500">Site</th>
                  <th className="px-3 py-2 text-left font-bold text-slate-500">County</th>
                  <th className="px-3 py-2 text-right font-bold text-purple-600">Annual DV</th>
                  <th className="px-3 py-2 text-center font-bold text-slate-400">Status</th>
                  <th className="px-3 py-2 text-right font-bold text-purple-600">24-hr DV</th>
                  <th className="px-3 py-2 text-center font-bold text-slate-400">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Array.from(pm25Sites.entries())
                  .sort(([, a], [, b]) => (a.annual?.siteName || '').localeCompare(b.annual?.siteName || ''))
                  .map(([siteId, { annual, daily }]) => {
                    const siteName = annual?.siteName || daily?.siteName || '';
                    const county = annual?.county || daily?.county || '';
                    const annualExceed = annual?.status === 'Exceedance';
                    const dailyExceed = daily?.status === 'Exceedance';
                    const rowHighlight = annualExceed || dailyExceed;
                    return (
                      <tr key={siteId} className={rowHighlight ? 'bg-red-50/50' : 'hover:bg-slate-50'}>
                        <td className="px-3 py-2 text-slate-700 truncate max-w-[120px]" title={siteName}>{siteName}</td>
                        <td className="px-3 py-2 text-slate-500">{county}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-800">
                          {annual ? annual.designValue.toFixed(1) : '—'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {annual && (
                            <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full ${
                              annualExceed ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                            }`}>
                              {annualExceed ? '> 9.0' : '✓'}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-800">
                          {daily ? daily.designValue.toFixed(0) : '—'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {daily && (
                            <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full ${
                              dailyExceed ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                            }`}>
                              {dailyExceed ? '> 35' : '✓'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Other Pollutants Table (O3, NO2, SO2, CO) */}
      {showOtherTable && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-[10px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-left font-bold text-slate-500">Pollutant</th>
                <th className="px-3 py-2 text-left font-bold text-slate-500">Site</th>
                <th className="px-3 py-2 text-left font-bold text-slate-500">County</th>
                <th className="px-3 py-2 text-left font-bold text-slate-500">Metric</th>
                <th className="px-3 py-2 text-right font-bold text-slate-500">DV</th>
                <th className="px-3 py-2 text-right font-bold text-slate-500">NAAQS</th>
                <th className="px-3 py-2 text-center font-bold text-slate-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {nonPM25Dvs
                .sort((a, b) => POLLUTANT_ORDER.indexOf(a.pollutant) - POLLUTANT_ORDER.indexOf(b.pollutant) || a.siteName.localeCompare(b.siteName))
                .map((dv, i) => (
                  <tr key={i} className={dv.status === 'Exceedance' ? 'bg-red-50/50' : 'hover:bg-slate-50'}>
                    <td className="px-3 py-2 font-bold" style={{ color: POLLUTANT_COLORS[dv.pollutant] }}>{dv.pollutant}</td>
                    <td className="px-3 py-2 text-slate-700 truncate max-w-[120px]" title={dv.siteName}>{dv.siteName}</td>
                    <td className="px-3 py-2 text-slate-500">{dv.county}</td>
                    <td className="px-3 py-2 text-slate-500">{dv.metric}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-slate-800">
                      {dv.units === 'ppm' ? dv.designValue.toFixed(3) : dv.designValue.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400">
                      {dv.units === 'ppm' ? dv.naaqs.toFixed(3) : dv.naaqs} {dv.units}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full ${
                        dv.status === 'Exceedance' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                      }`}>
                        {dv.status}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PM10 note — exceedance-based, no concentration DV */}
      {(pollutantFilter === 'All' || pollutantFilter === 'PM10') && pollutantSiteCounts['PM10'] && (
        <div className="bg-amber-50/50 rounded-lg border border-amber-200 px-4 py-3">
          <p className="text-[10px] font-bold text-amber-700 mb-1">PM10 — 24-hr Standard (150 µg/m³)</p>
          <p className="text-[9px] text-amber-600">
            PM10 uses an exceedance-based form: not to be exceeded more than once per year on avg over 3 years.
            {pollutantSiteCounts['PM10'].sites} monitor site{pollutantSiteCounts['PM10'].sites > 1 ? 's' : ''} in {selectedState} — 0 estimated exceedance days. In attainment.
          </p>
        </div>
      )}

      {/* No data fallback */}
      {filteredDvs.length === 0 && pollutantFilter !== 'PM10' && (
        <div className="text-center py-8 bg-slate-50 rounded-lg border border-dashed border-slate-200">
          <ShieldAlert className="h-5 w-5 text-slate-300 mx-auto mb-2" />
          <p className="text-[10px] text-slate-400">No design values available for this selection.</p>
        </div>
      )}

      {/* Data Completeness */}
      <div className="border-t border-slate-100 pt-4">
        <button
          onClick={() => setShowCompleteness(!showCompleteness)}
          className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider hover:text-slate-700 transition-colors"
        >
          {showCompleteness ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          Data Completeness ({completeness.length} records)
        </button>
        {showCompleteness && completeness.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-[9px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-2 py-1.5 text-left font-bold text-slate-500">Site</th>
                  <th className="px-2 py-1.5 text-left font-bold text-slate-500">Pollutant</th>
                  <th className="px-2 py-1.5 text-center font-bold text-slate-500">Year</th>
                  <th className="px-2 py-1.5 text-center font-bold text-slate-500">Q</th>
                  <th className="px-2 py-1.5 text-right font-bold text-slate-500">Obs %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {completeness.slice(0, 100).map((c, i) => (
                  <tr key={i} className={!c.sufficient ? 'bg-amber-50/50' : ''}>
                    <td className="px-2 py-1 text-slate-600 truncate max-w-[100px]">{c.siteName}</td>
                    <td className="px-2 py-1 text-slate-500">{c.pollutant}</td>
                    <td className="px-2 py-1 text-center text-slate-500">{c.year}</td>
                    <td className="px-2 py-1 text-center text-slate-500">Q{c.quarter}</td>
                    <td className="px-2 py-1 text-right font-mono">
                      <span className={`font-bold ${c.sufficient ? 'text-green-600' : 'text-amber-600'}`}>
                        {c.observationPct.toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {completeness.length > 100 && (
              <p className="text-[8px] text-slate-400 text-center py-2">Showing first 100 of {completeness.length} records</p>
            )}
          </div>
        )}
      </div>

      {/* 10-Year Trend Charts */}
      <div className="border-t border-slate-100 pt-4">
        <button
          onClick={() => setShowTrends(!showTrends)}
          className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider hover:text-slate-700 transition-colors"
        >
          {showTrends ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          10-Year Trend Charts
        </button>
        {showTrends && isMounted && (
          <div className="mt-3 space-y-6">
            {Object.entries(trendsByPollutant).map(([pollutant, pollTrends]) => {
              if (pollTrends.length === 0) return null;

              // Get unique metrics for this pollutant
              const metrics = [...new Set(pollTrends.map(t => t.metric))];
              const naaqs = pollTrends[0].naaqs;
              const units = pollTrends[0].units;

              // Pick the primary metric
              const primaryMetric = metrics[0];
              const metricTrends = pollTrends.filter(t => t.metric === primaryMetric);

              // Build chart data
              const sites = [...new Set(metricTrends.map(t => t.siteId))];
              const siteNames: Record<string, string> = {};
              metricTrends.forEach(t => { siteNames[t.siteId] = t.siteName; });

              const years = [...new Set(metricTrends.map(t => t.year))].sort();
              const chartData = years.map(yr => {
                const point: any = { year: yr };
                sites.forEach(sid => {
                  const match = metricTrends.find(t => t.siteId === sid && t.year === yr);
                  if (match) point[siteNames[sid] || sid] = match.value;
                });
                return point;
              });

              const siteLabels = sites.map(s => siteNames[s] || s);
              const lineColors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#64748b', '#ec4899', '#06b6d4'];

              const refNaaqs = designValues.find(dv => dv.pollutant === pollutant)?.naaqs ?? naaqs;

              // Calculate Y-axis domain boundaries dynamically
              const allValues: number[] = [];
              chartData.forEach(point => {
                Object.keys(point).forEach(key => {
                  if (key !== 'year' && point[key] != null) {
                    allValues.push(point[key]);
                  }
                });
              });
              if (refNaaqs != null) {
                allValues.push(refNaaqs);
              }
              const dataMin = allValues.length > 0 ? Math.min(...allValues) : 0;
              const dataMax = allValues.length > 0 ? Math.max(...allValues) : 100;
              const range = dataMax - dataMin;
              const padding = range === 0 ? (dataMax === 0 ? 1 : dataMax * 0.1) : range * 0.1;
              const yMin = pollutant === 'PM10' ? 0 : Math.max(0, dataMin - padding);
              const yMax = dataMax + padding;

              return (
                <div key={pollutant} className="bg-white rounded-lg border border-slate-200 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: POLLUTANT_COLORS[pollutant] }}>
                      {pollutant} — {primaryMetric}
                    </h4>
                    <span className="text-[9px] text-slate-400">{units}</span>
                  </div>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                        <XAxis dataKey="year" fontSize={9} tickMargin={8} tick={{ fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                        <YAxis
                          fontSize={9}
                          tick={{ fill: '#94A3B8' }}
                          axisLine={false}
                          tickLine={false}
                          domain={[yMin, yMax]}
                          tickFormatter={(val) => {
                            if (pollutant === 'O3') return val.toFixed(3);
                            if (pollutant === 'PM10') return val.toFixed(0);
                            return val.toFixed(1);
                          }}
                        />
                        <Tooltip content={<NaaqsTooltip />} position={{ x: -215, y: 15 }} />
                        <Legend wrapperStyle={{ fontSize: '8px', paddingTop: '10px' }} iconType="circle" height={40} verticalAlign="bottom" />
                        <ReferenceLine
                          y={refNaaqs}
                          stroke="#ef4444"
                          strokeDasharray="6 3"
                          strokeWidth={1.5}
                          label={{ value: `NAAQS: ${refNaaqs}`, position: 'right', fontSize: 8, fill: '#ef4444' }}
                        />
                        {siteLabels.slice(0, 8).map((label, idx) => (
                          <Line
                            key={label}
                            type="monotone"
                            dataKey={label}
                            stroke={lineColors[idx % lineColors.length]}
                            strokeWidth={1.5}
                            dot={{ r: 2.5, strokeWidth: 1 }}
                            activeDot={{ r: 4, strokeWidth: 0 }}
                            connectNulls
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-[8px] text-slate-300 text-center mt-4">
        Source: EPA Air Quality Design Values Report · ArcGIS FeatureServer · {selectedState} {endYear || latestYear}
      </p>
    </div>
  );
}
