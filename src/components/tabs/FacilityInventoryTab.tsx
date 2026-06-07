'use client';

import { useState, useEffect, useMemo } from 'react';
import { Loader2, Database, Activity, ShieldAlert, Clock, BarChart3, AlertTriangle, CheckCircle2, XCircle, Info } from 'lucide-react';
import { fetchNaaqsDesignValues, NaaqsDesignValue, Facility } from '@/lib/data-service';

interface FacilityInventoryTabProps {
  selectedState: string;
  allFacilities: Facility[];
  isMounted: boolean;
  selectedSector: string | null;
  onSectorSelect: (sector: string | null) => void;
  neiYear: '2020' | '2023';
  neiSyncStatus?: 'checking' | 'up-to-date' | 'updating' | 'error';
}

// Static metadata for data sources — latestYear is computed dynamically below
const DATA_SOURCE_META = [
  { key: 'echo', label: 'EPA ECHO', desc: 'CAA-regulated facility inventory', color: 'blue' },
  { key: 'tri', label: 'TRI (Form R)', desc: 'Toxic Release Inventory', color: 'purple' },
  { key: 'nei', label: 'NEI / EIS', desc: 'National Emissions Inventory', color: 'violet' },
  { key: 'camd', label: 'CAMD / CAMPD', desc: 'Continuous Emissions Monitoring', color: 'orange' },
  { key: 'aqs', label: 'AQS / ArcGIS', desc: 'NAAQS Design Values', color: 'emerald' },
];

export default function FacilityInventoryTab({
  selectedState,
  allFacilities,
  isMounted,
  selectedSector,
  onSectorSelect,
  neiYear,
  neiSyncStatus = 'checking',
}: FacilityInventoryTabProps) {
  const [naaqsLoading, setNaaqsLoading] = useState(true);
  const [designValues, setDesignValues] = useState<NaaqsDesignValue[]>([]);
  const [aqsYear, setAqsYear] = useState<number>(2024);

  // ── Dynamic Data Freshness Years ────────────────────────────
  // Derive latest available years from actual loaded data rather than hardcoding
  const dataSources = useMemo(() => {
    // TRI: derive from facility triYears arrays
    const allTriYears = allFacilities.flatMap(f => (f.triYears || []).map(Number)).filter(y => !isNaN(y));
    const latestTri = allTriYears.length > 0 ? String(Math.max(...allTriYears)) : '—';

    // CAMD: latest year from CAMPD streaming API (typically current year - 1)
    const currentYear = new Date().getFullYear();
    const latestCamd = String(currentYear - 1);

    // AQS / ArcGIS: EPA publishes certified DVs
    const latestAqs = String(aqsYear);

    // NEI: triennial — last published is 2023
    const latestNei = '2023';

    const yearMap: Record<string, string> = {
      echo: 'Live',
      tri: latestTri,
      nei: latestNei,
      camd: latestCamd,
      aqs: latestAqs,
    };

    return DATA_SOURCE_META.map(ds => ({ ...ds, latestYear: yearMap[ds.key] }));
  }, [allFacilities, aqsYear]);

  // Fetch NAAQS data for attainment snapshot
  useEffect(() => {
    let cancelled = false;
    setNaaqsLoading(true);
    fetchNaaqsDesignValues(selectedState).then(result => {
      if (cancelled) return;
      setDesignValues(result.designValues);
      setAqsYear(result.endYear);
      setNaaqsLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedState]);

  // ── Facility Stats ──────────────────────────────────────────
  const stats = useMemo(() => {
    const total = allFacilities.length;
    const major = allFacilities.filter(f => f.permitType === 'Major').length;
    const syntheticMinor = allFacilities.filter(f => f.permitType === 'Synthetic Minor').length;
    const minor = allFacilities.filter(f => f.permitType === 'Federally Reportable Minor' || f.permitType === 'Other').length;
    const triReporters = allFacilities.filter(f => f.triId).length;
    const neiReporters = allFacilities.filter(f => neiYear === '2023' ? f.hasNei2023 : f.eisId).length;
    const camdUnits = allFacilities.filter(f => f.camdId).length;
    const hpvCount = allFacilities.filter(f => f.hasHpv).length;

    // Sector breakdown
    const sectors: Record<string, number> = {};
    allFacilities.forEach(f => {
      const s = f.sector || 'Other';
      sectors[s] = (sectors[s] || 0) + 1;
    });

    // Coverage gaps
    const noTri = allFacilities.filter(f => f.isMajor && !f.triId).length;
    const noNei = allFacilities.filter(f => f.isMajor && !(neiYear === '2023' ? f.hasNei2023 : f.eisId)).length;
    const bothIds = allFacilities.filter(f => f.triId && (neiYear === '2023' ? f.hasNei2023 : f.eisId)).length;

    return {
      total, major, syntheticMinor, minor,
      triReporters, neiReporters, camdUnits, hpvCount,
      sectors, noTri, noNei, bothIds,
    };
  }, [allFacilities, neiYear]);

  // ── NAAQS Attainment Snapshot ───────────────────────────────
  const attainmentSnapshot = useMemo(() => {
    const pollutants = ['O3', 'PM2.5', 'PM10', 'NO2', 'SO2', 'CO'];
    return pollutants.map(p => {
      const dvs = designValues.filter(dv => dv.pollutant === p);
      const sites = new Set(dvs.map(dv => dv.siteId)).size;
      const exceedances = new Set(dvs.filter(dv => dv.status === 'Exceedance').map(dv => dv.siteId)).size;
      return { pollutant: p, sites, exceedances, attaining: exceedances === 0 };
    }).filter(p => p.sites > 0);
  }, [designValues]);

  // ── Sector sort ─────────────────────────────────────────────
  const sortedSectors = useMemo(() => {
    return Object.entries(stats.sectors)
      .sort((a, b) => b[1] - a[1]);
  }, [stats.sectors]);

  return (
    <div className="space-y-5">
      {/* ── Data Freshness Overview ── */}
      <div>
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
          <Clock className="h-3 w-3" /> Data Freshness
        </h3>
        <div className="space-y-1.5">
          {dataSources.map(ds => (
            <div key={ds.key} className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-white hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  ds.key === 'echo' ? 'bg-blue-500' :
                  ds.key === 'tri' ? 'bg-purple-500' :
                  ds.key === 'nei' ? 'bg-violet-500' :
                  ds.key === 'camd' ? 'bg-orange-500' :
                  'bg-emerald-500'
                }`} />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-700 leading-tight">{ds.label}</p>
                  <p className="text-[9px] text-slate-400 leading-tight">{ds.desc}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {ds.latestYear === 'Live' ? (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    Live API
                  </span>
                ) : (
                  <span className="text-[10px] font-mono font-bold text-slate-600">{ds.latestYear}</span>
                )}
                {ds.key === 'nei' && (
                  <>
                    {neiSyncStatus === 'checking' && (
                      <span className="text-[9px] font-bold text-slate-400 animate-pulse">Checking...</span>
                    )}
                    {neiSyncStatus === 'updating' && (
                      <span className="text-[9px] font-bold text-violet-600 flex items-center gap-1 bg-violet-50 px-2 py-0.5 rounded-full border border-violet-100">
                        <Loader2 className="h-2.5 w-2.5 animate-spin text-violet-500" />
                        Syncing...
                      </span>
                    )}
                    {neiSyncStatus === 'up-to-date' && (
                      <span className="text-[9px] font-bold text-green-700 flex items-center gap-1 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
                        <CheckCircle2 className="h-2.5 w-2.5 text-green-600" />
                        Up to date
                      </span>
                    )}
                    {neiSyncStatus === 'error' && (
                      <span className="text-[9px] font-bold text-red-700 flex items-center gap-1 bg-red-50 px-2 py-0.5 rounded-full border border-red-100">
                        <AlertTriangle className="h-2.5 w-2.5 text-red-600" />
                        Sync error
                      </span>
                    )}
                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-600">Triennial</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[8px] text-slate-300 mt-2 text-center italic">
          Years auto-detected from loaded data. NEI publishes every 3 years. TRI updates annually each July.
        </p>
      </div>

      {/* ── Facility Statistics ── */}
      <div>
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
          <BarChart3 className="h-3 w-3" /> Facility Statistics
        </h3>

        {/* Big number */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-xl p-4 text-white mb-3">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-3xl font-black">{stats.total.toLocaleString()}</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mt-0.5">CAA-regulated facilities</p>
            </div>
            <Database className="h-8 w-8 text-slate-600" />
          </div>
        </div>

        {/* Permit type breakdown */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-red-50 border border-red-100 rounded-lg p-2.5 text-center">
            <p className="text-lg font-black text-red-600">{stats.major}</p>
            <p className="text-[8px] font-bold text-red-400 uppercase">Title V Major</p>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-2.5 text-center">
            <p className="text-lg font-black text-amber-600">{stats.syntheticMinor}</p>
            <p className="text-[8px] font-bold text-amber-400 uppercase">Syn. Minor</p>
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-2.5 text-center">
            <p className="text-lg font-black text-blue-600">{stats.minor}</p>
            <p className="text-[8px] font-bold text-blue-400 uppercase">Minor/Other</p>
          </div>
        </div>

        {/* Data source coverage */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-purple-500" /> TRI Reporters
            </span>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-700">{stats.triReporters}</span>
              <div className="w-24 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, (stats.triReporters / Math.max(1, stats.total)) * 100)}%` }} />
              </div>
              <span className="text-[9px] text-slate-400 font-mono w-10 text-right">{((stats.triReporters / Math.max(1, stats.total)) * 100).toFixed(1)}%</span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-violet-500" /> NEI {neiYear} Coverage
            </span>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-700">{stats.neiReporters}</span>
              <div className="w-24 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div className="bg-violet-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, (stats.neiReporters / Math.max(1, stats.total)) * 100)}%` }} />
              </div>
              <span className="text-[9px] text-slate-400 font-mono w-10 text-right">{((stats.neiReporters / Math.max(1, stats.total)) * 100).toFixed(1)}%</span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-orange-500" /> CAMD / EGUs
            </span>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-700">{stats.camdUnits}</span>
              <div className="w-24 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div className="bg-orange-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, (stats.camdUnits / Math.max(1, stats.total)) * 100)}%` }} />
              </div>
              <span className="text-[9px] text-slate-400 font-mono w-10 text-right">{((stats.camdUnits / Math.max(1, stats.total)) * 100).toFixed(1)}%</span>
            </div>
          </div>
        </div>

        {stats.hpvCount > 0 && (
          <div className="mt-3 flex items-center gap-2 p-2 rounded-lg bg-red-50 border border-red-100">
            <AlertTriangle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
            <span className="text-[10px] text-red-600">
              <strong>{stats.hpvCount}</strong> facilit{stats.hpvCount === 1 ? 'y' : 'ies'} with High Priority Violations
            </span>
          </div>
        )}
      </div>

      {/* ── Sector Breakdown ── */}
      {sortedSectors.length > 1 && (
        <div>
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            <Activity className="h-3 w-3" /> Industry Sectors
          </h3>
          <div className="space-y-1.5">
            {sortedSectors.map(([sector, count]) => {
              const pct = (count / Math.max(1, stats.total)) * 100;
              const isSelected = selectedSector === sector;
              const hasActiveFilter = selectedSector !== null;
              return (
                <div
                  key={sector}
                  onClick={() => onSectorSelect(isSelected ? null : sector)}
                  className={`flex items-center gap-2 cursor-pointer p-1.5 rounded-lg border transition-all ${
                    isSelected
                      ? 'bg-indigo-50/80 border-indigo-200/60 shadow-sm'
                      : 'hover:bg-slate-50/80 border-transparent'
                  }`}
                >
                  <span className={`text-[10px] truncate w-24 transition-colors ${
                    isSelected
                      ? 'text-indigo-700 font-bold'
                      : (hasActiveFilter ? 'text-slate-400' : 'text-slate-600 font-medium')
                  }`}>
                    {sector}
                  </span>
                  <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        isSelected
                          ? 'bg-indigo-600'
                          : (hasActiveFilter ? 'bg-slate-200' : 'bg-indigo-400')
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className={`text-[10px] font-mono w-8 text-right transition-colors ${
                    isSelected
                      ? 'text-indigo-700 font-bold'
                      : (hasActiveFilter ? 'text-slate-400' : 'text-slate-500 font-bold')
                  }`}>
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── NAAQS Attainment Snapshot ── */}
      <div>
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
          <ShieldAlert className="h-3 w-3" /> NAAQS Attainment Snapshot
        </h3>
        {naaqsLoading ? (
          <div className="flex items-center gap-2 text-xs text-slate-400 py-4 justify-center">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading design values...
          </div>
        ) : attainmentSnapshot.length === 0 ? (
          <div className="text-center py-4">
            <Info className="h-4 w-4 text-slate-300 mx-auto mb-1" />
            <p className="text-[10px] text-slate-400 italic">No NAAQS monitoring data for this state</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {attainmentSnapshot.map(p => (
              <div
                key={p.pollutant}
                className={`p-2.5 rounded-lg border text-center transition-all ${
                  p.attaining
                    ? 'bg-green-50 border-green-200'
                    : 'bg-red-50 border-red-200'
                }`}
              >
                <div className="flex items-center justify-center gap-1 mb-1">
                  {p.attaining
                    ? <CheckCircle2 className="h-3 w-3 text-green-500" />
                    : <XCircle className="h-3 w-3 text-red-500" />
                  }
                  <span className={`text-xs font-black ${p.attaining ? 'text-green-700' : 'text-red-700'}`}>
                    {p.pollutant === 'PM2.5' ? 'PM₂.₅' : p.pollutant === 'PM10' ? 'PM₁₀' : p.pollutant === 'NO2' ? 'NO₂' : p.pollutant === 'SO2' ? 'SO₂' : p.pollutant}
                  </span>
                </div>
                <p className={`text-[8px] font-bold uppercase ${p.attaining ? 'text-green-500' : 'text-red-500'}`}>
                  {p.attaining ? 'Attainment' : `${p.exceedances} Exceedance${p.exceedances > 1 ? 's' : ''}`}
                </p>
                <p className="text-[8px] text-slate-400 mt-0.5">
                  {p.sites} site{p.sites > 1 ? 's' : ''}
                </p>
              </div>
            ))}
          </div>
        )}
        <p className="text-[8px] text-slate-300 mt-2 text-center italic">
          Based on EPA ArcGIS certified design values ({aqsYear - 2}-{aqsYear})
        </p>
      </div>

      {/* ── Data Coverage Gaps ── */}
      <div>
        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
          <Database className="h-3 w-3" /> Data Coverage
        </h3>
        <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Major sources with TRI data</span>
            <span className={`text-[10px] font-bold ${stats.noTri === 0 ? 'text-green-600' : 'text-amber-600'}`}>
              {stats.major - stats.noTri} / {stats.major}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Major sources with NEI {neiYear} data</span>
            <span className={`text-[10px] font-bold ${stats.noNei === 0 ? 'text-green-600' : 'text-amber-600'}`}>
              {stats.major - stats.noNei} / {stats.major}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Sources with both TRI + NEI {neiYear}</span>
            <span className="text-[10px] font-bold text-slate-600">{stats.bothIds}</span>
          </div>

          {(stats.noTri > 0 || stats.noNei > 0) && (
            <div className="pt-2 border-t border-slate-200">
              {stats.noTri > 0 && (
                <p className="text-[9px] text-amber-600 flex items-center gap-1 mb-1">
                  <AlertTriangle className="h-2.5 w-2.5 flex-shrink-0" />
                  {stats.noTri} major source{stats.noTri > 1 ? 's' : ''} missing TRI ID — may not report HAPs
                </p>
              )}
              {stats.noNei > 0 && (
                <p className="text-[9px] text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="h-2.5 w-2.5 flex-shrink-0" />
                  {stats.noNei} major source{stats.noNei > 1 ? 's' : ''} missing NEI {neiYear} data — no emissions inventory
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="text-center pt-2">
        <p className="text-[8px] text-slate-300 uppercase tracking-widest">
          MS DEQ Air Division · Facility Inventory Summary
        </p>
      </div>
    </div>
  );
}
