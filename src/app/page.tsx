'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { FeatureCollection } from 'geojson';
import {
  STATE_CENTERS,
  filterByRadius,
  Facility,
  fetchAqsMonitors,
  AqsMonitor,
  getNearestMonitor,
  NeiFacilityData,
  NeiCountyData,
  fetchNeiCounty,
} from '@/lib/data-service';
import { US_STATES } from '@/lib/constants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Search, MapPin, Wind, Database, Download, FlaskConical, BarChart3, AlertTriangle, Mountain, ShieldAlert, Activity } from 'lucide-react';
import PermitBadge from '@/components/PermitBadge';
import ErrorLogger from '@/components/ErrorLogger';
import PsdTab from '@/components/tabs/PsdTab';
import ToxicsTab from '@/components/tabs/ToxicsTab';
import NaaqsTab from '@/components/tabs/NaaqsTab';
import FacilityInventoryTab from '@/components/tabs/FacilityInventoryTab';

const RadiusMap = dynamic(() => import('@/components/RadiusMap'), { ssr: false });

type ActiveTab = 'inventory' | 'psd' | 'toxics' | 'naaqs';

export default function EmissionsDashboard() {
  const [allFacilities, setAllFacilities] = useState<Facility[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedState, setSelectedState] = useState('MS');
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [radiusMi, setRadiusMi] = useState(50);
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [mapFilter, setMapFilter] = useState<'all' | 'nei' | 'camd' | 'tri' | 'major' | 'synthetic' | 'minor'>('all');
  const [mapTriYear, setMapTriYear] = useState<string>('All');
  const [activeTab, setActiveTab] = useState<ActiveTab>('inventory');
  const [dataSource, setDataSource] = useState<string>('');

  // NEI shared state
  const [neiData, setNeiData] = useState<NeiFacilityData | null>(null);
  const [neiLoading, setNeiLoading] = useState(false);
  const [countyData, setCountyData] = useState<NeiCountyData | null>(null);
  const [countyLoading, setCountyLoading] = useState(false);

  // Federal Class I Area overlay
  const [classIGeoJson, setClassIGeoJson] = useState<FeatureCollection | null>(null);
  const [showClassI, setShowClassI] = useState(false);
  const [classILoading, setClassILoading] = useState(false);

  // AQS Monitoring
  const [aqsMonitors, setAqsMonitors] = useState<AqsMonitor[]>([]);
  const [showAqsMonitors, setShowAqsMonitors] = useState(false);
  const [selectedMonitor, setSelectedMonitor] = useState<AqsMonitor | null>(null);
  const [aqsLoading, setAqsLoading] = useState(false);
  const [aqsError, setAqsError] = useState<string | null>(null);
  const [hasRefreshedSession, setHasRefreshedSession] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    fetch('/api/sync-tri')
      .then(res => res.json())
      .then(data => console.log('[Sync TRI] Initial check completed:', data))
      .catch(err => console.error('[Sync TRI] Failed to trigger sync check:', err));
  }, []);

  useEffect(() => {
    setLoading(true);
    setAllFacilities([]);
    setCenter(null);
    setSelectedFacility(null);
    setDataSource('');
    setCountyData(null);
    setClassIGeoJson(null);
    setShowClassI(false);
    setAqsMonitors([]);
    setShowAqsMonitors(false);
    setSelectedMonitor(null);
    setNeiData(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    fetch(`/api/facilities?state=${selectedState}`, { signal: controller.signal })
      .then(res => { clearTimeout(timeoutId); if (!res.ok) throw new Error('API Response Error'); return res.json(); })
      .then(data => {
        setAllFacilities(data);
        if (data.length > 0) setDataSource(data[0].dataSource || '');
        console.log(`Loaded ${data.length} facilities for ${selectedState}`);
      })
      .catch(err => { clearTimeout(timeoutId); if (err.name !== 'AbortError') console.error('Failed to load facility data:', err.message); })
      .finally(() => setLoading(false));

    return () => { clearTimeout(timeoutId); controller.abort(); };
  }, [selectedState]);

  useEffect(() => {
    if (!center) { setCountyData(null); return; }
    setCountyLoading(true);
    fetchNeiCounty(center[0], center[1])
      .then(data => { setCountyData(data); setCountyLoading(false); })
      .catch(() => setCountyLoading(false));
  }, [center]);

  useEffect(() => {
    if (activeTab === 'psd' && mapFilter === 'tri') {
      setMapFilter('all');
    } else if (activeTab === 'toxics' && mapFilter === 'nei') {
      setMapFilter('all');
    }
  }, [activeTab, mapFilter]);

  const nearbyFacilities = useMemo(() => {
    let sourceList = allFacilities;
    if (mapFilter === 'tri') {
      sourceList = sourceList.filter(f => f.triId);
      if (mapTriYear !== 'All') sourceList = sourceList.filter(f => f.triYears?.includes(mapTriYear));
    } else if (mapFilter === 'nei') {
      sourceList = sourceList.filter(f => f.eisId);
    } else if (mapFilter === 'camd') {
      sourceList = sourceList.filter(f => f.camdId);
    } else if (mapFilter === 'major') {
      sourceList = sourceList.filter(f => f.permitType === 'Major');
    } else if (mapFilter === 'synthetic') {
      sourceList = sourceList.filter(f => f.permitType === 'Synthetic Minor');
    } else if (mapFilter === 'minor') {
      sourceList = sourceList.filter(f => f.permitType === 'Federally Reportable Minor' || f.permitType === 'Other');
    }
    if (showAll) return sourceList;
    if (!center) return [];
    return filterByRadius(sourceList, center[0], center[1], radiusMi);
  }, [allFacilities, center, radiusMi, showAll, mapFilter, mapTriYear]);

  const proximityFacilities = useMemo(() => {
    let sourceList = allFacilities;
    if (mapFilter === 'tri') {
      sourceList = sourceList.filter(f => f.triId);
      if (mapTriYear !== 'All') sourceList = sourceList.filter(f => f.triYears?.includes(mapTriYear));
    } else if (mapFilter === 'nei') {
      sourceList = sourceList.filter(f => f.eisId);
    } else if (mapFilter === 'camd') {
      sourceList = sourceList.filter(f => f.camdId);
    } else if (mapFilter === 'major') {
      sourceList = sourceList.filter(f => f.permitType === 'Major');
    } else if (mapFilter === 'synthetic') {
      sourceList = sourceList.filter(f => f.permitType === 'Synthetic Minor');
    } else if (mapFilter === 'minor') {
      sourceList = sourceList.filter(f => f.permitType === 'Federally Reportable Minor' || f.permitType === 'Other');
    }
    if (!center) return showAll ? sourceList : [];
    return filterByRadius(sourceList, center[0], center[1], radiusMi);
  }, [allFacilities, center, radiusMi, showAll, mapFilter, mapTriYear]);

  const handleFacilityClick = (f: Facility) => {
    setSelectedFacility(f);
    setSelectedMonitor(null);
    setNeiData(null);
    if (activeTab === 'inventory') setActiveTab('psd');
  };

  const handleExport = async () => {
    if (proximityFacilities.length === 0) return;
    const eisIds = proximityFacilities.map(f => f.eisId).filter(Boolean) as string[];
    const triIds = proximityFacilities.map(f => f.triId).filter(Boolean) as string[];
    const mode = activeTab === 'toxics' ? 'Toxics' : 'PSD';

    let enrichedData: Record<string, any> = {};
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eisIds, triIds, mode, year: mapTriYear })
      });
      if (res.ok) enrichedData = await res.json();
    } catch (err) { console.warn('Export enrichment failed:', err); }

    const baseHeaders = ['Name', 'Registry_ID', 'TRI_ID', 'EIS_ID', 'Address', 'City', 'State', 'Permit_Type', 'Major_Source', 'HPV', 'Latitude', 'Longitude', 'Distance_mi'];
    let headers = [...baseHeaders];
    if (mode === 'PSD') {
      headers.push('NOx (TPY)', 'SO2 (TPY)', 'PM2.5 (TPY)', 'VOC (TPY)', 'CO (TPY)', 'Data_Source');
    } else {
      headers.push('Total_HAPs (lbs)', 'HAP_Count', 'Reporting_Year', 'HAPs_Inventory', 'Data_Source');
    }

    const csvContent = [
      headers.join(','),
      ...proximityFacilities.map(f => {
        const row = [`"${f.name}"`, f.id, f.triId || '', f.eisId || '', `"${f.address}"`, f.city, f.state, f.permitType || '', f.isMajor ? 'Y' : 'N', f.hasHpv ? 'Y' : 'N', f.lat, f.lon, f.distance?.toFixed(2)];
        if (mode === 'PSD') {
          const d = enrichedData[f.eisId || ''] || {};
          row.push(d.nox || '', d.so2 || '', d.pm25 || '', d.voc || '', d.co || '', d.nox !== undefined ? 'NEI 2020' : '');
        } else {
          const d = enrichedData[f.triId || ''] || {};
          row.push(d.totalHaps !== undefined ? d.totalHaps.toFixed(4) : '', d.hapCount || '', d.year || '', d.hapsList ? `"${d.hapsList}"` : '', d.totalHaps !== undefined ? 'TRI' : '');
        }
        return row.join(',');
      })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const filterSuffix = mapFilter !== 'all' ? `_filter_${mapFilter}` : '_all_sources';
    link.download = `${selectedState.toLowerCase()}_${mode.toLowerCase()}_export_${radiusMi}mi${filterSuffix}.csv`;
    link.click();
  };

  const handleClassIToggle = async () => {
    const next = !showClassI;
    setShowClassI(next);
    if (next && (!classIGeoJson || classIGeoJson.features.length === 0)) {
      setClassILoading(true);
      try {
        const res = await fetch(`/api/class1-areas?state=${selectedState}`);
        if (res.ok) setClassIGeoJson(await res.json());
      } catch (err) { console.warn('Class I fetch failed:', err); }
      finally { setClassILoading(false); }
    }
  };

  const handleAqsToggle = async () => {
    const next = !showAqsMonitors;
    setShowAqsMonitors(next);
    if (next && aqsMonitors.length === 0) {
      setAqsLoading(true);
      setAqsError(null);
      try {
        const isFirstEnable = !hasRefreshedSession;
        const data = await fetchAqsMonitors(selectedState, isFirstEnable);
        if (isFirstEnable) setHasRefreshedSession(true);
        setAqsMonitors(data);
      } catch (err: any) {
        console.warn('AQS fetch failed:', err);
        setAqsError(err.message || 'Failed to connect to EPA AQS service.');
      } finally { setAqsLoading(false); }
    }
  };

  const handleMonitorClick = (monitor: AqsMonitor) => {
    setSelectedFacility(null);
    setSelectedMonitor(monitor);
  };

  const mapDefaultCenter = STATE_CENTERS[selectedState] || [32.35, -89.39];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50">
        <Loader2 className="h-10 w-10 animate-spin text-blue-600 mb-4" />
        <p className="text-slate-600 font-medium">Loading {US_STATES.find(s => s[0] === selectedState)?.[1] || selectedState} Facility Data...</p>
        <p className="text-slate-400 text-xs mt-2">Querying EPA ECHO (CAA-regulated sources)</p>
      </div>
    );
  }

  const tabs: { key: ActiveTab; label: string; color: string }[] = [
    { key: 'inventory', label: 'Facility Inventory', color: 'blue' },
    { key: 'psd', label: 'PSD / Emissions', color: 'blue' },
    { key: 'toxics', label: 'Toxics', color: 'purple' },
    { key: 'naaqs', label: 'NAAQS', color: 'emerald' },
  ];

  return (
    <main className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="bg-indigo-600 text-white text-[10px] py-1 text-center font-bold uppercase tracking-[0.2em] mb-4 rounded shadow-lg animate-pulse">
        System Active: AQS Monitoring Enabled · Logs Initialized
      </div>
      <ErrorLogger />
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex flex-col md:flex-row md:items-center justify-between w-full relative gap-6">
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-slate-900 leading-tight">MS DEQ Air Division Dashboard</h1>
              <p className="text-slate-500 italic mt-1 text-sm">PSD · Toxics · NAAQS · Facility Inventory</p>
              {dataSource && (
                <div className="flex items-center gap-1.5 mt-2 text-slate-400 text-[10px]">
                  <Database className="h-3 w-3" />
                  Source: {dataSource === 'ECHO' ? 'EPA ECHO Database' : 'EPA Toxics Release Inventory (Local Data)'}
                  {' · '}{allFacilities.length} facilities loaded
                </div>
              )}
              {/* Tab Bar */}
              <div className="flex gap-1 mt-4">
                {tabs.map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                      activeTab === tab.key
                        ? `bg-${tab.color}-600 text-white border-${tab.color}-600 shadow-lg shadow-${tab.color}-100`
                        : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'
                    }`}
                    style={activeTab === tab.key ? {
                      backgroundColor: tab.color === 'blue' ? '#2563eb' : tab.color === 'purple' ? '#9333ea' : '#059669',
                      borderColor: tab.color === 'blue' ? '#2563eb' : tab.color === 'purple' ? '#9333ea' : '#059669',
                      color: 'white',
                    } : {}}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col items-center md:items-end gap-6">
              <img src="/MDEQ_Logo.gif" alt="MDEQ Logo" className="h-16 w-auto object-contain" />
              <div className="flex flex-wrap items-center justify-center md:justify-end gap-4 bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                <div className="flex flex-col items-end">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">State</span>
                  <select
                    value={selectedState}
                    onChange={e => setSelectedState(e.target.value)}
                    className="mt-0.5 text-xs font-bold text-slate-700 border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    {US_STATES.map(([abbr, name]) => (
                      <option key={abbr} value={abbr}>{abbr} — {name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col items-end border-l border-slate-200 pl-4">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Radius</span>
                  <div className="flex items-center gap-2">
                    <input type="range" min="1" max="100" value={radiusMi} onChange={e => setRadiusMi(parseInt(e.target.value))} className="w-24 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600" />
                    <span className="font-mono text-blue-600 text-xs font-bold w-10 text-right">{radiusMi}mi</span>
                  </div>
                </div>
                <div className="flex flex-col items-end border-l-2 border-indigo-400 pl-4 bg-indigo-50/30 p-1 rounded-r-lg">
                  <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-1">Ambient Monitors</span>
                  <button
                    onClick={handleAqsToggle}
                    className={`flex items-center gap-1.5 text-[10px] font-bold px-4 py-1.5 rounded-lg border-2 shadow-sm transition-all ${showAqsMonitors ? 'bg-indigo-700 text-white border-indigo-700 ring-4 ring-indigo-100' : 'bg-white text-indigo-700 border-indigo-600 hover:bg-indigo-50'}`}
                  >
                    {aqsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : '📡'}
                    {showAqsMonitors ? 'MONITORING: ON' : 'SHOW AQS SITES'}
                  </button>
                </div>
                <button
                  onClick={handleExport}
                  disabled={proximityFacilities.length === 0}
                  className="bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-xs font-bold flex items-center gap-1.5 shadow-sm shadow-slate-200"
                >
                  <Download className="h-3.5 w-3.5" /> Export
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Map + Table (always visible) */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="overflow-hidden border-slate-200 shadow-sm">
              <CardHeader className="bg-white border-b border-slate-100 py-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-sm font-bold text-slate-600 uppercase tracking-tight flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-blue-500" />
                    Facility Proximity Map ({allFacilities.length} total)
                    {center && (
                      <button onClick={() => { setCenter(null); setSelectedFacility(null); }} className="ml-2 bg-slate-100 hover:bg-red-50 text-slate-400 hover:text-red-500 px-2 py-0.5 rounded text-[10px] transition-colors">
                        ✕ Clear map pin
                      </button>
                    )}
                  </CardTitle>
                  {!center && !showAll && (
                    <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-1 rounded-full animate-pulse font-bold">CLICK MAP TO SET PROJECT LOCATION</span>
                  )}
                  <div className="flex items-center gap-2">
                    {mapFilter === 'tri' && (
                      <select value={mapTriYear} onChange={e => setMapTriYear(e.target.value)} className="text-[10px] font-bold px-2 py-1 rounded-full border border-purple-200 bg-purple-50 text-purple-700 outline-none cursor-pointer">
                        <option value="All">All TRI Years</option>
                        {Array.from(new Set(allFacilities.flatMap(f => f.triYears || []))).sort((a, b) => parseInt(b) - parseInt(a)).map(yr => (
                          <option key={yr} value={yr}>{yr}</option>
                        ))}
                      </select>
                    )}
                    <select
                      value={mapFilter}
                      onChange={e => setMapFilter(e.target.value as any)}
                      className={`text-[10px] font-bold px-3 py-1.5 rounded-full border transition-all cursor-pointer outline-none ${
                        mapFilter === 'all'
                          ? 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                          : mapFilter === 'tri'
                            ? 'bg-purple-600 text-white border-purple-600'
                            : mapFilter === 'camd'
                              ? 'bg-blue-600 text-white border-blue-600'
                              : mapFilter === 'nei'
                                ? 'bg-violet-600 text-white border-violet-600'
                                : mapFilter === 'major'
                                  ? 'bg-red-600 text-white border-red-600'
                                  : mapFilter === 'synthetic'
                                    ? 'bg-amber-500 text-white border-amber-500'
                                    : 'bg-slate-600 text-white border-slate-600'
                      }`}
                    >
                      <option value="all" className="bg-white text-slate-700">Filter: None (Show All)</option>
                      {(activeTab === 'inventory' || activeTab === 'psd' || activeTab === 'naaqs') && (
                        <option value="nei" className="bg-white text-slate-700">Filter: NEI 2020 Reporters</option>
                      )}
                      <option value="camd" className="bg-white text-slate-700">Filter: CAMD (Power Plants)</option>
                      {(activeTab === 'inventory' || activeTab === 'toxics' || activeTab === 'naaqs') && (
                        <option value="tri" className="bg-white text-slate-700">Filter: TRI (Toxics) Reporters</option>
                      )}
                      <option value="major" className="bg-white text-slate-700">Filter: Title V Major</option>
                      <option value="synthetic" className="bg-white text-slate-700">Filter: Synthetic Minor</option>
                      <option value="minor" className="bg-white text-slate-700">Filter: Minor/Other</option>
                    </select>
                    <button
                      onClick={handleClassIToggle}
                      disabled={classILoading}
                      className={`flex items-center gap-1.5 text-[10px] font-bold px-3 py-1 rounded-full border transition-all ${showClassI ? 'bg-green-700 text-white border-green-700' : 'bg-white text-slate-500 border-slate-200 hover:border-green-500 hover:text-green-700'}`}
                    >
                      {classILoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mountain className="h-3 w-3" />}
                      Class I Areas
                    </button>
                    <button
                      onClick={() => setShowAll(!showAll)}
                      className={`text-[10px] font-bold px-3 py-1 rounded-full border transition-all ${showAll ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200 hover:border-blue-400'}`}
                    >
                      {showAll ? 'Showing All' : 'Show All Facilities'}
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <RadiusMap
                  key={selectedState}
                  defaultCenter={mapDefaultCenter}
                  center={center}
                  radiusMi={radiusMi}
                  facilities={nearbyFacilities}
                  aqsMonitors={showAqsMonitors ? aqsMonitors : []}
                  onMapClick={(lat, lon) => setCenter([lat, lon])}
                  onFacilityClick={handleFacilityClick}
                  onMonitorClick={handleMonitorClick}
                  classIGeoJson={showClassI ? classIGeoJson : null}
                />
              </CardContent>
            </Card>

            {/* Facility Table */}
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="py-4">
                <CardTitle className="text-sm font-bold text-slate-600 uppercase tracking-tight flex items-center gap-2">
                  <Database className="h-4 w-4 text-emerald-500" />
                  Nearby Facilities ({proximityFacilities.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-[400px]">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-slate-700">Facility Name</th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-700">City</th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-700">Type</th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-700">Sources</th>
                        <th className="px-4 py-3 text-right font-semibold text-slate-700">Lat</th>
                        <th className="px-4 py-3 text-right font-semibold text-slate-700">Lon</th>
                        <th className="px-4 py-3 text-right font-semibold text-slate-700">Distance</th>
                        <th className="px-4 py-3 text-center font-semibold text-slate-700">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {proximityFacilities.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-12 text-center text-slate-400 italic">
                            {center ? 'No facilities found in this radius.' : 'Click the map to identify surrounding facilities.'}
                          </td>
                        </tr>
                      ) : (
                        proximityFacilities.map(f => (
                          <tr key={f.id} className={`hover:bg-blue-50/50 transition-colors ${selectedFacility?.id === f.id ? 'bg-blue-50' : ''}`}>
                            <td className="px-4 py-3 font-medium text-slate-900">{f.name}</td>
                            <td className="px-4 py-3 text-slate-500">{f.city}</td>
                            <td className="px-4 py-3">
                              <PermitBadge permitType={f.permitType} isMajor={f.isMajor} hasHpv={f.hasHpv} />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1 flex-wrap">
                                {f.triId && <span className="text-[7px] font-bold px-1 py-0.5 rounded bg-purple-100 text-purple-600">TRI</span>}
                                {f.eisId && <span className="text-[7px] font-bold px-1 py-0.5 rounded bg-violet-100 text-violet-600">NEI</span>}
                                {f.camdId && <span className="text-[7px] font-bold px-1 py-0.5 rounded bg-blue-100 text-blue-600">CAMD</span>}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-[10px] text-slate-400">
                              {typeof f.lat === 'number' ? f.lat.toFixed(4) : '—'}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-[10px] text-slate-400">
                              {typeof f.lon === 'number' ? f.lon.toFixed(4) : '—'}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-blue-600 font-bold">
                              {typeof f.distance === 'number' ? `${f.distance.toFixed(1)} mi` : '—'}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button onClick={() => handleFacilityClick(f)} className="text-[10px] text-slate-700 font-bold uppercase tracking-tighter bg-white border border-slate-200 px-2 py-1 rounded hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300 transition-colors">
                                View Details
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Sidebar — switches based on active tab */}
          <div className="space-y-6">
            {activeTab === 'inventory' ? (
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="bg-slate-900 text-white rounded-t-xl">
                  <CardTitle className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                    <Database className="h-4 w-4" /> Facility Inventory
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <FacilityInventoryTab selectedState={selectedState} allFacilities={allFacilities} isMounted={isMounted} />
                </CardContent>
              </Card>
            ) : activeTab === 'naaqs' ? (
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="bg-emerald-900 text-white rounded-t-xl">
                  <CardTitle className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4" /> NAAQS Attainment
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <NaaqsTab selectedState={selectedState} isMounted={isMounted} />
                </CardContent>
              </Card>
            ) : (
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className={`text-white transition-colors duration-500 rounded-t-xl ${activeTab === 'toxics' ? 'bg-purple-900' : 'bg-slate-900'}`}>
                  <CardTitle className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                    {activeTab === 'toxics' ? <FlaskConical className="h-4 w-4" /> : <Wind className="h-4 w-4" />}
                    {activeTab === 'toxics' ? 'Toxics Inventory' : 'PSD / Emissions'}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  {/* Data Source Matrix */}
                  {selectedFacility && (
                    <div className="mb-6 p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <ShieldAlert className="h-3 w-3" /> Data Source Matrix
                      </h3>
                      <div className="grid grid-cols-2 gap-2">
                        <div className={`p-2 rounded-lg border text-center ${selectedFacility.triId ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-slate-300 border-slate-100'}`}>
                          <p className="text-[10px] font-bold">TRI</p>
                          <p className="text-[8px] opacity-80">{selectedFacility.triId ? 'Reporting Form R' : 'No TRI ID'}</p>
                        </div>
                        <div className={`p-2 rounded-lg border text-center ${selectedFacility.eisId ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-300 border-slate-100'}`}>
                          <p className="text-[10px] font-bold">NEI</p>
                          <p className="text-[8px] opacity-80">{selectedFacility.eisId ? 'Modeling Inventory' : 'No EIS ID'}</p>
                        </div>
                        <div className={`p-2 rounded-lg border text-center ${selectedFacility.camdId ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-300 border-slate-100'}`}>
                          <p className="text-[10px] font-bold">CAMD</p>
                          <p className="text-[8px] opacity-80">{selectedFacility.camdId ? 'CEMS Monitoring' : 'No CAMD ID'}</p>
                        </div>
                        {(() => {
                          const nearest = getNearestMonitor(selectedFacility.lat, selectedFacility.lon, aqsMonitors);
                          const isAqsActive = showAqsMonitors && nearest && nearest.distance < 10;
                          return (
                            <div className={`p-2 rounded-lg border text-center ${isAqsActive ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-300 border-slate-100'}`}>
                              <p className="text-[10px] font-bold">AQS</p>
                              <p className="text-[8px] opacity-80">{nearest ? `${(nearest.distance ?? 0).toFixed(1)}mi Near` : 'No Nearby Site'}</p>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Monitor Info Card */}
                  {selectedMonitor ? (
                    <div className="space-y-4">
                      <div>
                        <h2 className="text-lg font-bold text-indigo-900 leading-tight flex items-center gap-2">
                          📡 {selectedMonitor.local_site_name || 'Monitoring Site'}
                        </h2>
                        <p className="text-sm text-slate-500 mt-1">{selectedMonitor.address || `${selectedMonitor.county} County`}, {selectedState}</p>
                        <div className="mt-2 text-[10px] font-mono text-slate-400">AQS ID: {selectedMonitor.id}</div>
                      </div>

                      {/* Pollutants Monitored */}
                      {selectedMonitor.pollutants && selectedMonitor.pollutants.length > 0 && (
                        <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100">
                          <h3 className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                            <Activity className="h-3 w-3" /> Parameters Monitored
                          </h3>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedMonitor.pollutants.map((p, i) => (
                              <span key={i} className="text-[9px] font-bold px-2 py-1 rounded-full bg-white border border-indigo-200 text-indigo-700">
                                {p}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Location */}
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                        <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Location</h3>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <p className="text-[9px] text-slate-400">Latitude</p>
                            <p className="font-mono font-bold text-slate-700">{selectedMonitor.lat.toFixed(4)}</p>
                          </div>
                          <div>
                            <p className="text-[9px] text-slate-400">Longitude</p>
                            <p className="font-mono font-bold text-slate-700">{selectedMonitor.lon.toFixed(4)}</p>
                          </div>
                          <div>
                            <p className="text-[9px] text-slate-400">County</p>
                            <p className="font-bold text-slate-700">{selectedMonitor.county}</p>
                          </div>
                          <div>
                            <p className="text-[9px] text-slate-400">Network</p>
                            <p className="font-bold text-slate-700">
                              {(selectedMonitor.local_site_name || '').includes('NCORE') ? 'NCore' : 'SLAMS'}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* NAAQS pointer */}
                      <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
                        <p className="text-[10px] text-emerald-700 leading-relaxed">
                          <strong>Design values and attainment status</strong> for this monitor are available on the <strong>NAAQS tab</strong>. Switch tabs to view certified EPA design values for all criteria pollutants.
                        </p>
                        <button
                          onClick={() => { setActiveTab('naaqs'); setSelectedMonitor(null); }}
                          className="mt-2 w-full py-1.5 bg-emerald-600 text-white text-[10px] font-bold rounded-lg hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 shadow-sm"
                        >
                          <ShieldAlert className="h-3 w-3" /> View NAAQS Design Values →
                        </button>
                      </div>

                      <button onClick={() => setSelectedMonitor(null)} className="w-full py-2 text-xs font-bold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                        Deselect Site
                      </button>
                    </div>
                  ) : selectedFacility ? (
                    <div className="space-y-6">
                      <div>
                        <h2 className="text-lg font-bold text-slate-900 leading-tight">{selectedFacility.name}</h2>
                        <p className="text-sm text-slate-500 mt-1">{selectedFacility.address}, {selectedFacility.city}, {selectedFacility.state || selectedState}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="inline-block bg-slate-100 px-2 py-1 rounded text-[10px] font-mono font-bold text-slate-600">ID: {selectedFacility.id}</span>
                          {selectedFacility.triId && <span className="inline-block bg-purple-50 px-2 py-1 rounded text-[10px] font-mono font-bold text-purple-600">TRI: {selectedFacility.triId}</span>}
                          <PermitBadge permitType={selectedFacility.permitType} isMajor={selectedFacility.isMajor} hasHpv={selectedFacility.hasHpv} />
                        </div>
                        {selectedFacility.hasHpv && (
                          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1.5">
                            <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                            High Priority Violation on record (EPA ECHO)
                          </div>
                        )}
                      </div>

                      {activeTab === 'toxics' ? (
                        <ToxicsTab
                          selectedFacility={selectedFacility}
                          neiData={neiData} setNeiData={setNeiData}
                          neiLoading={neiLoading} setNeiLoading={setNeiLoading}
                          isMounted={isMounted}
                          aqsMonitors={aqsMonitors} showAqsMonitors={showAqsMonitors}
                          handleAqsToggle={handleAqsToggle} aqsError={aqsError} aqsLoading={aqsLoading}
                          filterReported={mapFilter === 'tri'} mapTriYear={mapTriYear}
                        />
                      ) : (
                        <PsdTab
                          selectedFacility={selectedFacility}
                          neiData={neiData} setNeiData={setNeiData}
                          neiLoading={neiLoading} setNeiLoading={setNeiLoading}
                          isMounted={isMounted}
                        />
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-20">
                      <div className="bg-slate-50 h-12 w-12 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Search className="h-6 w-6 text-slate-300" />
                      </div>
                      <p className="text-sm text-slate-400 italic px-4">Select a facility from the map or table to view modeling parameters.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* County Background Emissions */}
            {(center || countyLoading) && (
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="py-3 border-b border-slate-100">
                  <CardTitle className="text-sm font-bold text-slate-600 uppercase tracking-tight flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-teal-500" /> County Background
                    {countyData?.county && !countyLoading && (
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 ml-auto normal-case tracking-normal">{countyData.county}</span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-3 pb-4 px-4">
                  {countyLoading ? (
                    <div className="flex items-center gap-2 text-xs text-slate-400 italic"><Loader2 className="h-3 w-3 animate-spin" /> Looking up county emissions…</div>
                  ) : countyData?.found && countyData.emissions.length > 0 ? (
                    <div>
                      <p className="text-[9px] text-slate-400 mb-3 leading-relaxed">2020 NEI total county emissions (all source categories). Useful for PSD cumulative impact context.</p>
                      <div className="space-y-2">
                        {countyData.emissions.map((e, i) => {
                          const maxTotal = countyData.emissions[0]?.total ?? 1;
                          const pct = Math.min(100, ((e.total ?? 0) / maxTotal) * 100);
                          return (
                            <div key={i}>
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[9px] font-semibold text-slate-600">{e.pollutant}</span>
                                <span className="text-[9px] font-mono font-bold text-teal-700">{(e.total ?? 0).toLocaleString()} TPY</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                  <div className="bg-teal-400 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                              {(e.point != null || e.nonpoint != null) && (
                                <div className="flex gap-2 mt-0.5 text-[8px] text-slate-400">
                                  {e.point != null && <span>Point: {e.point.toLocaleString()}</span>}
                                  {e.nonpoint != null && <span>Area: {e.nonpoint.toLocaleString()}</span>}
                                  {e.onroad != null && <span>Onroad: {e.onroad.toLocaleString()}</span>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-[8px] text-slate-300 mt-3">Source: EPA NEI 2020 · {countyData.county}, {countyData.state}</p>
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-400 italic">{center ? 'No NEI county data found for this location.' : 'Set a project location to see county context.'}</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Map Legend */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Map Legend</p>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <svg width="10" height="13" viewBox="0 0 18 22" className="flex-shrink-0"><polygon points="10,1 2,12 9,12 8,21 16,10 9,10" fill="#f97316" stroke="white" strokeWidth="1.5" strokeLinejoin="round" /></svg>
                  <span className="text-xs text-slate-600">Power Plant (CAMPD)</span>
                </div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500 inline-block flex-shrink-0"></span><span className="text-xs text-slate-600">Major Source (Title V)</span></div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-amber-500 inline-block flex-shrink-0"></span><span className="text-xs text-slate-600">Synthetic Minor</span></div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block flex-shrink-0"></span><span className="text-xs text-slate-600">Minor / Other CAA Source</span></div>
              </div>
            </div>

            {/* Quick Guide */}
            <div className={`rounded-2xl p-6 text-white shadow-lg transition-colors duration-500 ${activeTab === 'inventory' ? 'bg-slate-700 shadow-slate-200' : activeTab === 'toxics' ? 'bg-purple-600 shadow-purple-200' : activeTab === 'naaqs' ? 'bg-emerald-700 shadow-emerald-200' : 'bg-blue-600 shadow-blue-200'}`}>
              <h3 className="font-bold text-lg mb-2">
                {activeTab === 'inventory' ? 'Inventory' : activeTab === 'naaqs' ? 'NAAQS' : activeTab === 'toxics' ? 'Toxics' : 'PSD'} Quick Guide
              </h3>
              <p className={`text-xs leading-relaxed opacity-90 ${activeTab === 'inventory' ? 'text-slate-200' : activeTab === 'toxics' ? 'text-purple-50' : activeTab === 'naaqs' ? 'text-emerald-50' : 'text-blue-100'}`}>
                {activeTab === 'inventory'
                  ? 'High-level summary of all CAA-regulated facilities. Shows data freshness across EPA databases, permit breakdowns, and NAAQS attainment status at a glance.'
                  : activeTab === 'naaqs'
                  ? 'Shows CFR-compliant NAAQS design values for all criteria pollutants. Data sourced from EPA ArcGIS certified design values.'
                  : activeTab === 'toxics'
                  ? 'Displays HAP emissions from NEI/EIS for all CAA-regulated sources. TRI API is currently unavailable; NEI data covers all major & minor permitted sources with actual and PTE values.'
                  : 'Use radius search to identify surrounding facilities for PSD multi-source analysis. Major sources shown in red.'}
              </p>
              <div className={`mt-4 pt-4 border-t ${activeTab === 'inventory' ? 'border-slate-500/30' : activeTab === 'toxics' ? 'border-purple-500/30' : activeTab === 'naaqs' ? 'border-emerald-500/30' : 'border-blue-500/30'}`}>
                <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${activeTab === 'inventory' ? 'text-slate-300' : activeTab === 'toxics' ? 'text-purple-200' : activeTab === 'naaqs' ? 'text-emerald-200' : 'text-blue-200'}`}>Tips</p>
                <ul className={`text-[10px] space-y-2 list-disc pl-4 ${activeTab === 'inventory' ? 'text-slate-200' : activeTab === 'toxics' ? 'text-purple-50' : activeTab === 'naaqs' ? 'text-emerald-50' : 'text-blue-50'}`}>
                  {activeTab === 'inventory' ? (
                    <>
                      <li>Click a facility to view detailed PSD/Toxics data</li>
                      <li>NEI publishes every 3 years — check for latest cycle</li>
                      <li>NAAQS snapshot reflects EPA certified design values</li>
                    </>
                  ) : activeTab === 'naaqs' ? (
                    <>
                      <li>O₃ design values use truncation, not rounding</li>
                      <li>PM₂.₅ uses POC-filtered data per CFR requirements</li>
                      <li>Use the pollutant filter to focus on specific standards</li>
                    </>
                  ) : activeTab === 'toxics' ? (
                    <>
                      <li>Check for bioaccumulative chemicals (PBTs)</li>
                      <li>Use total releases for worst-case screening</li>
                      <li>Compare with state air toxics thresholds</li>
                    </>
                  ) : (
                    <>
                      <li>Major sources require full PSD analysis review</li>
                      <li>Check stack heights for GEP compliance</li>
                      <li>Export CSV includes permit classification</li>
                    </>
                  )}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className="mt-12 py-8 border-t border-slate-200">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-slate-500 text-xs font-medium">For comments, bug reports, questions, or suggestions, please contact:</p>
          <p className="text-slate-900 text-sm font-bold mt-1">Rodney Cuevas — <a href="mailto:RCuevas@mdeq.ms.gov" className="text-blue-600 hover:underline">RCuevas@mdeq.ms.gov</a></p>
          <div className="mt-4 flex items-center justify-center gap-2 text-[10px] text-slate-400 uppercase tracking-widest">
            <span>Mississippi Department of Environmental Quality</span>
            <span>·</span>
            <span>Air Division — PSD · Toxics · NAAQS</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

