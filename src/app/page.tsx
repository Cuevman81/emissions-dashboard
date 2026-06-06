'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import type { FeatureCollection } from 'geojson';
import {
  STATE_CENTERS,
  filterByRadius,
  Facility,
  HapRecord,
  fetchHaps,
  StackParameter,
  EmissionRecord,
  fetchEmissions,
  fetchNeiFacility,
  fetchNeiCounty,
  NeiFacilityData,
  NeiCountyData,
  AqsMonitor,
  AqsSample,
  fetchAqsMonitors,
  fetchAqsSamples,
  fetchAqsAnnualData,
  getNearestMonitor,
} from '@/lib/data-service';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Search, MapPin, Wind, Database, Download, FlaskConical, BarChart3, AlertTriangle, Mountain, ShieldAlert, Activity, Clock } from 'lucide-react';
import StackInventory from '@/components/StackInventory';
import ErrorLogger from '@/components/ErrorLogger';

const RadiusMap = dynamic(() => import('@/components/RadiusMap'), { ssr: false });

const US_STATES = [
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
];

// PSD Significant Emission Rates — 40 CFR 52.21(b)(23)
const PSD_SER: Record<string, number> = {
  'CO': 100,
  'NOx': 40,
  'SO2': 40,
  'PM10': 25,
  'PM2.5': 10,
  'VOC': 40,
  'Lead': 0.6,
};

function normalizePsdPollutant(name: string): string | null {
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

function PermitBadge({ permitType, isMajor, hasHpv }: { permitType?: string; isMajor?: boolean; hasHpv?: boolean }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {isMajor && (
        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 whitespace-nowrap">Major</span>
      )}
      {!isMajor && permitType === 'Synthetic Minor' && (
        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap">Syn. Minor</span>
      )}
      {!isMajor && permitType === 'Federally Reportable Minor' && (
        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 whitespace-nowrap">Fed. Minor</span>
      )}
      {hasHpv && (
        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-500 border border-red-200 whitespace-nowrap">HPV</span>
      )}
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-950/95 backdrop-blur-sm p-3 rounded-xl border border-slate-800 shadow-2xl text-[10px] text-white max-w-[160px] pointer-events-none">
        <p className="font-bold border-b border-slate-800 pb-1 mb-1.5 text-center text-purple-400">{label} TRI</p>
        <div className="space-y-1.5">
          {payload.slice(0, 5).map((item: any, index: number) => {
            const val = item.value;
            const formattedVal = val < 0.0001 ? '<0.0001' : val.toLocaleString(undefined, { maximumFractionDigits: 4 });
            return (
              <div key={index} className="flex flex-col border-b border-slate-800/40 pb-0.5 last:border-0 last:pb-0">
                <span className="text-[9px] text-slate-400 truncate block max-w-[140px]" title={item.name}>
                  {item.name}
                </span>
                <span className="font-mono font-bold" style={{ color: item.color || '#e2e8f0' }}>
                  {formattedVal} <span className="font-normal text-[8px] text-slate-500">Tons/Yr</span>
                </span>
              </div>
            );
          })}
          {payload.length > 5 && (
            <p className="text-[8px] text-slate-500 italic pt-0.5 text-center">
              + {payload.length - 5} more chemicals
            </p>
          )}
        </div>
      </div>
    );
  }
  return null;
};

const CamdTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-950/95 backdrop-blur-sm p-3 rounded-xl border border-slate-800 shadow-2xl text-[10px] text-white max-w-[160px] pointer-events-none">
        <p className="font-bold border-b border-slate-800 pb-1 mb-1.5 text-center text-blue-400">{label} CAMD</p>
        <div className="space-y-1.5">
          {payload.map((item: any, index: number) => {
            const val = item.value;
            const formattedVal = val.toLocaleString(undefined, { maximumFractionDigits: 1 });
            return (
              <div key={index} className="flex flex-col border-b border-slate-800/40 pb-0.5 last:border-0 last:pb-0">
                <span className="text-[9px] text-slate-400 truncate block max-w-[140px]" title={item.name}>
                  {item.name}
                </span>
                <span className="font-mono font-bold" style={{ color: item.color || '#e2e8f0' }}>
                  {formattedVal} <span className="font-normal text-[8px] text-slate-500">Tons</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  return null;
};

export default function EmissionsDashboard() {
  const [allFacilities, setAllFacilities] = useState<Facility[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedState, setSelectedState] = useState('MS');
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [radiusMi, setRadiusMi] = useState(50);
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [stacks, setStacks] = useState<StackParameter[]>([]);
  const [stacksLoading, setStacksLoading] = useState(false);
  const [emissions, setEmissions] = useState<EmissionRecord[]>([]);
  const [emissionsYear, setEmissionsYear] = useState<number | null>(null);
  const [emissionsLoading, setEmissionsLoading] = useState(false);
  const [historicalEmissions, setHistoricalEmissions] = useState<Record<string, EmissionRecord[]>>({});
  const [toxics, setToxics] = useState<HapRecord[]>([]);
  const [toxicsYear, setToxicsYear] = useState<number | string | null>(null);
  const [availableToxicsYears, setAvailableToxicsYears] = useState<string[]>([]);
  const [historicalHaps, setHistoricalHaps] = useState<Record<string, HapRecord[]>>({});
  const [isTRIReporter, setIsTRIReporter] = useState<boolean | null>(null);
  const [isSimulated, setIsSimulated] = useState(false);
  const [toxicsLoading, setToxicsLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [filterReported, setFilterReported] = useState(false);
  const [mapTriYear, setMapTriYear] = useState<string>('All');
  const [modelingMode, setModelingMode] = useState<'PSD' | 'Toxics'>('PSD');
  const [localStackData, setLocalStackData] = useState<Record<string, StackParameter[]>>({});
  const [dataSource, setDataSource] = useState<string>('');
  const [manualEmissions, setManualEmissions] = useState<EmissionRecord[]>([]);
  const [showManualEmissionForm, setShowManualEmissionForm] = useState(false);

  // NEI 2020 facility & county data
  const [neiData, setNeiData] = useState<NeiFacilityData | null>(null);
  const [neiLoading, setNeiLoading] = useState(false);
  const [countyData, setCountyData] = useState<NeiCountyData | null>(null);
  const [countyLoading, setCountyLoading] = useState(false);

  // Federal Class I Area overlay
  const [classIGeoJson, setClassIGeoJson] = useState<FeatureCollection | null>(null);
  const [showClassI, setShowClassI] = useState(false);
  const [classILoading, setClassILoading] = useState(false);
  // AQS Monitoring data
  const [aqsMonitors, setAqsMonitors] = useState<AqsMonitor[]>([]);
  const [showAqsMonitors, setShowAqsMonitors] = useState(false);
  const [selectedMonitor, setSelectedMonitor] = useState<AqsMonitor | null>(null);
  const [aqsSamples, setAqsSamples] = useState<AqsSample[]>([]);
  const [aqsAnnualData, setAqsAnnualData] = useState<any[]>([]);
  const [aqsYear, setAqsYear] = useState<string>('2024');
  const [aqsLoading, setAqsLoading] = useState(false);
  const [aqsError, setAqsError] = useState<string | null>(null);
  const [hasRefreshedSession, setHasRefreshedSession] = useState(false);

  // Trigger automatic check/sync for new TRI datasets in the background on app load
  useEffect(() => {
    setIsMounted(true);
    fetch('/api/sync-tri')
      .then(res => res.json())
      .then(data => console.log('[Sync TRI] Initial check completed:', data))
      .catch(err => console.error('[Sync TRI] Failed to trigger sync check:', err));
  }, []);

  // Reload facilities whenever the selected state changes
  useEffect(() => {
    setLoading(true);
    setAllFacilities([]);
    setCenter(null);
    setSelectedFacility(null);
    setStacks([]);
    setEmissions([]);
    setManualEmissions([]);
    setHistoricalEmissions({});
    setToxics([]);
    setAvailableToxicsYears([]);
    setHistoricalHaps({});
    setIsTRIReporter(null);
    setDataSource('');
    setCountyData(null);
    setClassIGeoJson(null);
    setShowClassI(false);
    setAqsMonitors([]);
    setShowAqsMonitors(false);
    setSelectedMonitor(null);
    setAqsSamples([]);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    fetch(`/api/facilities?state=${selectedState}`, { signal: controller.signal })
      .then(res => {
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error('API Response Error');
        return res.json();
      })
      .then(data => {
        setAllFacilities(data);
        if (data.length > 0) setDataSource(data[0].dataSource || '');
        console.log(`Loaded ${data.length} facilities for ${selectedState}`);
      })
      .catch(err => {
        clearTimeout(timeoutId);
        if (err.name !== 'AbortError') {
          console.error('Failed to load facility data:', err.message);
        }
      })
      .finally(() => setLoading(false));

    return () => { clearTimeout(timeoutId); controller.abort(); };
  }, [selectedState]);

  // Fetch county-level NEI 2020 totals whenever the project center changes
  useEffect(() => {
    if (!center) { setCountyData(null); return; }
    setCountyLoading(true);
    fetchNeiCounty(center[0], center[1])
      .then(data => { setCountyData(data); setCountyLoading(false); })
      .catch(() => setCountyLoading(false));
  }, [center]);

  const nearbyFacilities = useMemo(() => {
    let sourceList = allFacilities;
    if (filterReported) {
      if (modelingMode === 'PSD') {
        sourceList = sourceList.filter(f => f.eisId); // NEI 2020 reported
      } else if (modelingMode === 'Toxics') {
        sourceList = sourceList.filter(f => f.triId); // TRI reporter
        if (mapTriYear !== 'All') {
          sourceList = sourceList.filter(f => f.triYears?.includes(mapTriYear));
        }
      }
    }
    if (showAll) return sourceList;
    if (!center) return [];
    return filterByRadius(sourceList, center[0], center[1], radiusMi);
  }, [allFacilities, center, radiusMi, showAll, modelingMode, filterReported, mapTriYear]);

  const handleFacilityClick = async (f: Facility) => {
    setSelectedFacility(f);
    setNeiData(null);

    if (modelingMode === 'Toxics') {
      setToxicsLoading(true);
      setIsTRIReporter(null);
      setToxicsYear(null);
      setHistoricalHaps({});

      // Fire NEI 2020 fetch in parallel (non-blocking — for NEI HAPs)
      if (f.eisId) {
        setNeiLoading(true);
        fetchNeiFacility(f.eisId)
          .then(result => { setNeiData(result); setNeiLoading(false); })
          .catch(() => setNeiLoading(false));
      }

      // If a specific map year is selected, try to load that year for the clicked facility
      const targetYear = (filterReported && mapTriYear !== 'All') ? mapTriYear : undefined;
      const data = await fetchHaps(f.id, f.triId ?? undefined, targetYear);

      setToxics(data.haps);
      setToxicsYear(data.year);
      setAvailableToxicsYears(data.availableYears || []);
      setHistoricalHaps(data.historicalHaps || {});
      setIsTRIReporter(data.isTRIReporter ?? null);
      setIsSimulated(false);
      setToxicsLoading(false);
    } else {
      setEmissionsLoading(true);

      // Fire NEI 2020 fetch in parallel (non-blocking — updates state when done)
      if (f.eisId) {
        setNeiLoading(true);
        fetchNeiFacility(f.eisId)
          .then(result => { setNeiData(result); setNeiLoading(false); })
          .catch(() => setNeiLoading(false));
      }

      const data = await fetchEmissions(f.id, f.camdId ?? undefined);
      setEmissions(data.emissions);
      setEmissionsYear(data.year);
      setHistoricalEmissions(data.historicalEmissions || {});
      setIsSimulated(data.isSimulated);
      setEmissionsLoading(false);

      if (localStackData[f.id]) {
        setStacks(localStackData[f.id]);
        return;
      }
      setStacksLoading(true);
      const stackParams = new URLSearchParams({ registryId: f.id });
      if (f.camdId) stackParams.set('camdId', f.camdId);
      if (f.naics) stackParams.set('naics', f.naics);
      if (f.sector) stackParams.set('sector', f.sector);
      const stackRes = await fetch(`/api/stacks?${stackParams}`);
      const stackData: StackParameter[] = stackRes.ok ? await stackRes.json() : [];
      setStacks(stackData);
      setStacksLoading(false);
    }
  };

  const handleExport = async () => {
    if (nearbyFacilities.length === 0) return;

    // 1. Identify IDs for batch fetching
    const eisIds = nearbyFacilities.map(f => f.eisId).filter(Boolean) as string[];
    const triIds = nearbyFacilities.map(f => f.triId).filter(Boolean) as string[];

    // 2. Fetch enriched data from our new export API
    let enrichedData: Record<string, any> = {};
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eisIds,
          triIds,
          mode: modelingMode,
          year: toxicsYear || mapTriYear
        })
      });
      if (res.ok) enrichedData = await res.json();
    } catch (err) {
      console.warn('Export enrichment failed, falling back to basic data:', err);
    }

    // 3. Define Headers based on Mode
    const baseHeaders = ['Name', 'Registry_ID', 'TRI_ID', 'EIS_ID', 'Address', 'City', 'State', 'Permit_Type', 'Major_Source', 'HPV', 'Latitude', 'Longitude', 'Distance_mi'];

    let headers = [...baseHeaders];
    if (modelingMode === 'PSD') {
      headers.push('NOx (TPY)', 'SO2 (TPY)', 'PM2.5 (TPY)', 'VOC (TPY)', 'CO (TPY)', 'Data_Source');
    } else {
      headers.push('Total_HAPs (lbs)', 'HAP_Count', 'Reporting_Year', 'HAPs_Inventory', 'Data_Source');
    }

    // 4. Construct CSV Content
    const csvContent = [
      headers.join(','),
      ...nearbyFacilities.map(f => {
        const row = [
          `"${f.name}"`, f.id, f.triId || '', f.eisId || '', `"${f.address}"`, f.city, f.state,
          f.permitType || '', f.isMajor ? 'Y' : 'N', f.hasHpv ? 'Y' : 'N',
          f.lat, f.lon, f.distance?.toFixed(2)
        ];

        if (modelingMode === 'PSD') {
          const d = enrichedData[f.eisId || ''] || {};
          row.push(
            d.nox || '', d.so2 || '', d.pm25 || '', d.voc || '', d.co || '',
            d.nox !== undefined ? 'NEI 2020' : ''
          );
        } else {
          const d = enrichedData[f.triId || ''] || {};
          row.push(
            d.totalHaps !== undefined ? d.totalHaps.toFixed(4) : '',
            d.hapCount || '',
            d.year || '',
            d.hapsList ? `"${d.hapsList}"` : '',
            d.totalHaps !== undefined ? 'TRI' : ''
          );
        }

        return row.join(',');
      })
    ].join('\n');

    // 5. Trigger Download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const filterSuffix = filterReported ? `_reporters_only` : `_all_sources`;
    link.download = `${selectedState.toLowerCase()}_${modelingMode.toLowerCase()}_export_${radiusMi}mi${filterSuffix}.csv`;
    link.click();
  };

  const handleClassIToggle = async () => {
    const next = !showClassI;
    setShowClassI(next);
    // Fetch if enabling and we don't yet have a non-empty dataset
    if (next && (!classIGeoJson || classIGeoJson.features.length === 0)) {
      setClassILoading(true);
      try {
        const res = await fetch(`/api/class1-areas?state=${selectedState}`);
        if (res.ok) {
          const data: FeatureCollection = await res.json();
          setClassIGeoJson(data);
        }
      } catch (err) {
        console.warn('Class I fetch failed:', err);
      } finally {
        setClassILoading(false);
      }
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
        
        if (data.length === 0) {
          console.warn('AQS fetch returned 0 monitors for state', selectedState);
        }
        setAqsMonitors(data);
      } catch (err: any) {
        console.warn('AQS fetch failed:', err);
        setAqsError(err.message || 'Failed to connect to EPA AQS service.');
      } finally {
        setAqsLoading(false);
      }
    }
  };

  const handleMonitorClick = async (monitor: AqsMonitor, forcedYear?: string) => {
    setSelectedFacility(null); // Deselect facility if a monitor is clicked
    setSelectedMonitor(monitor);
    setAqsLoading(true);
    setAqsSamples([]);
    setAqsAnnualData([]);

    // Use forcedYear if provided (from dropdown), otherwise use current state
    const targetYear = forcedYear || aqsYear;

    try {
      // Fetch current year samples and historical annual data in parallel
      const fetchers: Promise<any>[] = [fetchAqsSamples(monitor.id, targetYear)];
      
      if (modelingMode === 'Toxics') {
        fetchers.push(fetchAqsAnnualData(monitor.id));
      }

      const results = await Promise.all(fetchers);
      setAqsSamples(results[0]);
      if (results[1]) setAqsAnnualData(results[1]);
      
    } catch (err) {
      console.warn('AQS data fetch failed:', err);
    } finally {
      setAqsLoading(false);
    }
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

  const combinedEmissions = [...emissions, ...manualEmissions];
  let actualEmissions = combinedEmissions.filter(e => e.emissionsType === 'actual' || !e.emissionsType);
  const pteEmissions = combinedEmissions.filter(e => e.emissionsType === 'potential');

  const isNeiFallback = actualEmissions.length === 0 && neiData?.found && neiData.emissions.length > 0;
  if (isNeiFallback) {
    actualEmissions = neiData.emissions.map(ne => ({
      pollutant: ne.pollutant,
      amount: ne.amount,
      unit: 'Tons/Year',
      emissionsType: 'actual' as const,
    }));
  } else if (selectedFacility?.camdId && neiData?.found && neiData.emissions.length > 0) {
    // For EGUs (power plants), merge NEI pollutants not reported by CAMD (like PM, VOC, CO, Lead)
    const existingPollutants = new Set(
      actualEmissions
        .map(e => normalizePsdPollutant(e.pollutant))
        .filter(Boolean) as string[]
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
    <main className="min-h-screen bg-slate-50 p-4 md:p-8">
      {/* Visibility Test Banner */}
      <div className="bg-indigo-600 text-white text-[10px] py-1 text-center font-bold uppercase tracking-[0.2em] mb-4 rounded shadow-lg animate-pulse">
        System Active: AQS Monitoring Enabled · Logs Initialized
      </div>
      <ErrorLogger />
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex flex-col md:flex-row md:items-center justify-between w-full relative gap-6">
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-slate-900 leading-tight">Emissions & PSD Modeling Dashboard</h1>
              <p className="text-slate-500 italic mt-1 text-sm">Point source inventory · proximity analysis · stack parameters</p>
              {dataSource && (
                <div className="flex items-center gap-1.5 mt-2 text-slate-400 text-[10px]">
                  <Database className="h-3 w-3" />
                  Source: {dataSource === 'ECHO' ? 'EPA ECHO Database' : 'EPA Toxics Release Inventory (Local Data)'}
                  {' · '}{allFacilities.length} facilities loaded
                </div>
              )}
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setModelingMode('PSD')}
                  className={`flex-1 md:flex-none px-6 py-2 rounded-xl text-sm font-bold transition-all border ${modelingMode === 'PSD' ? 'bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-100' : 'bg-white text-slate-400 border-slate-200 hover:border-blue-300'}`}
                >
                  PSD Modeling Mode
                </button>
                <button
                  onClick={() => setModelingMode('Toxics')}
                  className={`flex-1 md:flex-none px-6 py-2 rounded-xl text-sm font-bold transition-all border relative overflow-hidden group ${modelingMode === 'Toxics' ? 'bg-purple-600 text-white border-purple-600 shadow-lg shadow-purple-200' : 'bg-white text-slate-400 border-slate-200 hover:border-purple-300 hover:text-purple-500'}`}
                >
                  <span className="relative z-10">Toxics Modeling</span>
                  {modelingMode !== 'Toxics' && <div className="absolute inset-0 bg-purple-50 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />}
                </button>
              </div>
            </div>

            {/* Logo and Controls */}
            <div className="flex flex-col items-center md:items-end gap-6">
              <img
                src="/MDEQ_Logo.gif"
                alt="MDEQ Logo"
                className="h-16 w-auto object-contain"
              />
              <div className="flex flex-wrap items-center justify-center md:justify-end gap-4 bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                {/* State Selector */}
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

                {/* Radius Slider */}
                <div className="flex flex-col items-end border-l border-slate-200 pl-4">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Radius</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="range" min="1" max="100" value={radiusMi}
                      onChange={(e) => setRadiusMi(parseInt(e.target.value))}
                      className="w-24 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    />
                    <span className="font-mono text-blue-600 text-xs font-bold w-10 text-right">{radiusMi}mi</span>
                  </div>
                </div>

                {/* AQS Ambient Monitoring Toggle */}
                <div className="flex flex-col items-end border-l-2 border-indigo-400 pl-4 bg-indigo-50/30 p-1 rounded-r-lg">
                  <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-1">Ambient Monitors</span>
                  <button
                    onClick={handleAqsToggle}
                    id="aqs-toggle-global"
                    className={`flex items-center gap-1.5 text-[10px] font-bold px-4 py-1.5 rounded-lg border-2 shadow-sm transition-all ${showAqsMonitors ? 'bg-indigo-700 text-white border-indigo-700 ring-4 ring-indigo-100' : 'bg-white text-indigo-700 border-indigo-600 hover:bg-indigo-50'}`}
                  >
                    {aqsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : '📡'}
                    {showAqsMonitors ? 'MONITORING: ON' : 'SHOW AQS SITES'}
                  </button>
                </div>

                {/* Export Button */}
                <button
                  onClick={handleExport}
                  disabled={nearbyFacilities.length === 0}
                  className="bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-xs font-bold flex items-center gap-1.5 shadow-sm shadow-slate-200"
                >
                  <Download className="h-3.5 w-3.5" /> Export
                </button>
              </div>
            </div>
          </div>
        </div>


        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Map Section */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="overflow-hidden border-slate-200 shadow-sm">
              <CardHeader className="bg-white border-b border-slate-100 py-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-sm font-bold text-slate-600 uppercase tracking-tight flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-blue-500" />
                    Facility Proximity Map ({allFacilities.length} total)
                    {center && (
                      <button
                        onClick={() => { setCenter(null); setSelectedFacility(null); }}
                        className="ml-2 bg-slate-100 hover:bg-red-50 text-slate-400 hover:text-red-500 px-2 py-0.5 rounded text-[10px] transition-colors"
                      >
                        ✕ Clear map pin
                      </button>
                    )}
                  </CardTitle>
                  {!center && !showAll && (
                    <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-1 rounded-full animate-pulse font-bold">
                      CLICK MAP TO SET PROJECT LOCATION
                    </span>
                  )}
                  <div className="flex items-center gap-2">
                    {filterReported && modelingMode === 'Toxics' && (
                      <select
                        value={mapTriYear}
                        onChange={(e) => setMapTriYear(e.target.value)}
                        className="text-[10px] font-bold px-2 py-1 rounded-full border border-purple-200 bg-purple-50 text-purple-700 outline-none cursor-pointer"
                      >
                        <option value="All">All TRI Years</option>
                        {Array.from(new Set(allFacilities.flatMap(f => f.triYears || []))).sort((a, b) => parseInt(b) - parseInt(a)).map(yr => (
                          <option key={yr} value={yr}>{yr}</option>
                        ))}
                      </select>
                    )}
                    <button
                      onClick={() => setFilterReported(!filterReported)}
                      className={`text-[10px] font-bold px-3 py-1 rounded-full border transition-all ${filterReported ? (modelingMode === 'PSD' ? 'bg-amber-600 text-white border-amber-600' : 'bg-purple-600 text-white border-purple-600') : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}
                    >
                      {filterReported
                        ? (modelingMode === 'PSD' ? 'Showing NEI 2020 Reporters' : 'Showing TRI Reporters')
                        : (modelingMode === 'PSD' ? 'Filter: NEI 2020 Reporters' : 'Filter: TRI Reporters')
                      }
                    </button>
                    <button
                      onClick={handleClassIToggle}
                      disabled={classILoading}
                      className={`flex items-center gap-1.5 text-[10px] font-bold px-3 py-1 rounded-full border transition-all ${showClassI ? 'bg-green-700 text-white border-green-700' : 'bg-white text-slate-500 border-slate-200 hover:border-green-500 hover:text-green-700'}`}
                    >
                      {classILoading
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Mountain className="h-3 w-3" />}
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

            {/* Results Table */}
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="py-4">
                <CardTitle className="text-sm font-bold text-slate-600 uppercase tracking-tight flex items-center gap-2">
                  <Database className="h-4 w-4 text-emerald-500" />
                  Nearby Facilities ({nearbyFacilities.length})
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
                      {nearbyFacilities.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-12 text-center text-slate-400 italic">
                            {center ? 'No facilities found in this radius.' : 'Click the map to identify surrounding facilities.'}
                          </td>
                        </tr>
                      ) : (
                        nearbyFacilities.map(f => (
                          <tr key={f.id} className={`hover:bg-blue-50/50 transition-colors ${selectedFacility?.id === f.id ? 'bg-blue-50' : ''}`}>
                            <td className="px-4 py-3 font-medium text-slate-900">{f.name}</td>
                            <td className="px-4 py-3 text-slate-500">{f.city}</td>
                            <td className="px-4 py-3">
                              <PermitBadge permitType={f.permitType} isMajor={f.isMajor} hasHpv={f.hasHpv} />
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
                              <button
                                onClick={() => handleFacilityClick(f)}
                                className="text-[10px] font-bold uppercase tracking-tighter bg-white border border-slate-200 px-2 py-1 rounded hover:bg-slate-50"
                              >
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

          {/* Details Sidebar */}
          <div className="space-y-6">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className={`text-white transition-colors duration-500 rounded-t-xl ${modelingMode === 'Toxics' ? 'bg-purple-900' : 'bg-slate-900'}`}>
                <CardTitle className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                  {modelingMode === 'Toxics' ? <FlaskConical className="h-4 w-4" /> : <Wind className="h-4 w-4" />}
                  {modelingMode === 'Toxics' ? 'Toxics Inventory' : 'Facility Details'}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {/* Unified Data Source Matrix */}
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

                {/* Ambient Context: SHOW IF FACILITY SELECTED */}
                {modelingMode === 'Toxics' && selectedFacility && (() => {
                  const nearest = getNearestMonitor(selectedFacility.lat, selectedFacility.lon, aqsMonitors);
                  const isAqsOff = !showAqsMonitors;
                  
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
                          <span>Fac: {(selectedFacility?.lat ?? 0).toFixed(3)}, {(selectedFacility?.lon ?? 0).toFixed(3)}</span>
                          <span>Sites: {aqsMonitors.length}</span>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="mb-6 p-4 bg-indigo-50/50 rounded-xl border border-indigo-100 shadow-sm border-l-4 border-l-indigo-500">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-bold text-indigo-900 flex items-center gap-2">
                          <Activity className="h-4 w-4" />
                          Nearby Ambient Context
                        </h3>
                        <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold">
                          {(nearest.distance ?? 0).toFixed(1)} mi away
                        </span>
                      </div>
                      <p className="text-[10px] text-indigo-600 mb-2 leading-tight">
                        Compared against measurements at <strong>{nearest.monitor.local_site_name || nearest.monitor.county}</strong> monitor.
                      </p>
                      <button
                        onClick={() => handleMonitorClick(nearest.monitor)}
                        className="w-full py-1.5 bg-indigo-600 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 shadow-sm"
                      >
                         View Monitor Measurements →
                      </button>
                      <div className="mt-3 pt-2 border-t border-indigo-100 flex justify-between text-[8px] font-mono text-indigo-400 uppercase tracking-tighter">
                          <span>Fac: {(selectedFacility?.lat ?? 0).toFixed(3)}, {(selectedFacility?.lon ?? 0).toFixed(3)}</span>
                          <span>Mon: {(nearest?.monitor?.lat ?? 0).toFixed(3)}, {(nearest?.monitor?.lon ?? 0).toFixed(3)}</span>
                      </div>
                    </div>
                  );
                })()}

                {/* AQS Global Monitoring Toggle (Visible in Toxics mode if no facility/monitor selected) */}
                {modelingMode === 'Toxics' && !selectedFacility && !selectedMonitor && (
                  <div className={`p-6 rounded-2xl border-2 transition-all duration-500 shadow-sm ${showAqsMonitors ? 'bg-indigo-600 border-indigo-700 text-white' : 'bg-white border-slate-100 text-slate-900 group'}`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-2 rounded-xl bg-indigo-100 text-indigo-700">
                        <FlaskConical className="h-6 w-6" />
                      </div>
                      <button
                        onClick={handleAqsToggle}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${showAqsMonitors ? 'bg-white text-indigo-600 hover:bg-indigo-50' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                      >
                        {aqsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (showAqsMonitors ? 'Hide Monitors' : 'Show Monitors')}
                      </button>
                    </div>
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-base font-bold">Ambient AQS Monitoring</h3>
                      {showAqsMonitors && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/30 text-white">{aqsMonitors.length} sites loaded</span>}
                    </div>
                    <p className={`text-xs opacity-80 leading-relaxed ${showAqsMonitors ? 'text-indigo-100' : 'text-slate-500'}`}>
                      Toggle real-world Hazardous Air Pollutant (HAP) & Criteria measurements from EPA's Air Quality System monitors.
                    </p>
                  </div>
                )}

                {selectedMonitor ? (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-lg font-bold text-indigo-900 leading-tight">📡 {selectedMonitor.local_site_name || 'Monitoring Site'}</h2>
                      <p className="text-sm text-slate-500 mt-1">
                        {selectedMonitor.address || `${selectedMonitor.county} County`}, {selectedState}
                      </p>
                      <div className="mt-2 text-[10px] font-mono text-slate-400">AQS ID: {selectedMonitor.id}</div>
                    </div>

                     <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                             {modelingMode === 'Toxics' ? 'Ambient Toxics Measurements' : 'Ambient Monitor Data'}
                          </h3>
                          <select
                            value={aqsYear}
                            onChange={(e) => {
                              const yr = e.target.value;
                              setAqsYear(yr);
                              if (selectedMonitor) handleMonitorClick(selectedMonitor, yr);
                            }}
                            className="text-[10px] font-bold px-2 py-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer"
                          >
                            {['2025', '2024', '2023', '2022', '2021', '2020'].map(yr => (
                              <option key={yr} value={yr}>{yr} AQS</option>
                            ))}
                          </select>
                        </div>

                        {aqsLoading ? (
                          <div className="space-y-3 py-4 text-center">
                            <div className="flex items-center justify-center gap-2 text-[10px] text-indigo-500 font-bold uppercase tracking-widest">
                               <Loader2 className="h-3 w-3 animate-spin" />
                               Checking EPA Data for {aqsYear}...
                            </div>
                            <div className="h-1.5 w-64 mx-auto bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-indigo-500 rounded-full animate-[progress_2s_ease-in-out_infinite]"></div>
                            </div>
                            <p className="text-[10px] text-slate-400 italic">
                               Queries for {aqsYear} can take up to 20 seconds.
                            </p>
                            <style jsx>{`
                              @keyframes progress {
                                0% { width: 0%; margin-left: 0%; }
                                50% { width: 40%; margin-left: 30%; }
                                100% { width: 0%; margin-left: 100%; }
                              }
                            `}</style>
                          </div>
                        ) : (() => {
                          const criteriaParams = ['44201', '42401', '42602', '88101', '81102', '42101'];
                          let filteredSamples = aqsSamples;
                          
                          if (modelingMode === 'Toxics') {
                            filteredSamples = aqsSamples.filter(s => !criteriaParams.includes(s.parameter_code));
                          }

                          if (filteredSamples.length === 0) {
                            return (
                              <div className="bg-slate-50 rounded-lg p-6 text-center border border-slate-100">
                                <Activity className="h-5 w-5 text-slate-300 mx-auto mb-2" />
                                <p className="text-[10px] text-slate-500">
                                  {modelingMode === 'Toxics' 
                                    ? "No HAP samples found for this site in the selected year. The EPA may only monitor criteria pollutants here." 
                                    : "No measurements found for this site in the selected year."}
                                </p>
                              </div>
                            );
                          }

                          return (
                            <div className="space-y-2">
                              {filteredSamples.slice(0, 30).map((s, i) => {
                                const isCriteria = criteriaParams.includes(s.parameter_code);
                                return (
                                  <div key={i} className={`p-2 rounded border flex justify-between items-center text-xs transition-colors hover:border-slate-300 ${isCriteria ? 'bg-blue-50/30 border-blue-100' : 'bg-purple-50/30 border-purple-100'}`}>
                                    <div className="flex-1 min-w-0 pr-2">
                                      <div className="flex items-center gap-1.5 mb-0.5">
                                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isCriteria ? 'bg-blue-400' : 'bg-purple-400'}`}></span>
                                        <span className={`font-bold truncate ${isCriteria ? 'text-blue-900' : 'text-purple-900'}`}>{s.parameter_name}</span>
                                        {!isCriteria && <span className="text-[8px] font-bold px-1 rounded flex-shrink-0 bg-purple-100 text-purple-600">HAP</span>}
                                      </div>
                                      <div className="text-[9px] text-slate-500 font-medium truncate">
                                        {s.date_local} · {s.duration_description || s.sample_duration}
                                      </div>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                      <div className={`font-mono font-bold text-sm ${isCriteria ? 'text-blue-700' : 'text-purple-700'}`}>
                                        {typeof s.sample_measurement === 'number' ? s.sample_measurement.toFixed(4) : 'N/A'}
                                      </div>
                                      <div className="text-[8px] text-slate-400 font-bold uppercase">{s.units_of_measure}</div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                     </div>

                     {/* Multi-Year Toxics History */}
                     {modelingMode === 'Toxics' && !aqsLoading && aqsAnnualData.length > 0 && (
                       <div className="mt-8 border-t border-slate-100 pt-6">
                         <div className="flex items-center justify-between mb-4">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Multi-Year Toxics Profile</h3>
                            <Clock className="h-3.5 w-3.5 text-slate-300" />
                         </div>
                         <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                           <table className="w-full text-left">
                             <thead>
                               <tr className="text-[9px] font-bold text-slate-400 uppercase border-b border-slate-200">
                                 <th className="pb-2">Year</th>
                                 <th className="pb-2">Pollutant</th>
                                 <th className="pb-2 text-right">Avg (µg/m³)</th>
                               </tr>
                             </thead>
                             <tbody className="divide-y divide-slate-100">
                               {aqsAnnualData.filter(d => !['44201', '42401', '42602', '88101', '81102', '42101'].includes(d.parameter_code)).slice(0, 15).map((d, i) => (
                                 <tr key={i} className="text-[10px]">
                                   <td className="py-2 text-slate-500 font-medium">{d.year}</td>
                                   <td className="py-2 text-slate-900 font-bold truncate max-w-[100px]">{d.parameter}</td>
                                   <td className="py-2 text-right text-purple-600 font-mono font-bold">
                                     {typeof d.arithmetic_mean === 'number' ? d.arithmetic_mean.toFixed(5) : 'N/A'}
                                   </td>
                                 </tr>
                               ))}
                             </tbody>
                           </table>
                           {aqsAnnualData.filter(d => !['44201', '42401', '42602', '88101', '81102', '42101'].includes(d.parameter_code)).length === 0 && (
                             <p className="text-[10px] text-slate-400 italic text-center py-4">No historical HAP averages recorded for this site.</p>
                           )}
                           <p className="text-[8px] text-slate-300 mt-3 text-center uppercase tracking-tighter italic">Source: EPA AQS Annual Statistics (2014-2024)</p>
                         </div>
                       </div>
                     )}

                     {modelingMode === 'Toxics' && !aqsLoading && aqsAnnualData.length === 0 && (
                       <div className="mt-8 border-t border-slate-100 pt-6">
                         <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                            <h4 className="text-[10px] font-bold text-amber-700 mb-1 flex items-center gap-1.5">
                               <ShieldAlert className="h-3.5 w-3.5" /> Site Lacks Toxics Profile
                            </h4>
                            <p className="text-[10px] text-amber-600 leading-tight">
                              This monitoring station does not have any historical Hazardous Air Pollutant (HAP) records. It may only monitor criteria pollutants like Ozone or Particulate Matter.
                            </p>
                         </div>
                       </div>
                     )}

                    <button
                      onClick={() => setSelectedMonitor(null)}
                      className="w-full py-2 text-xs font-bold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      Deselect Site
                    </button>
                  </div>
                ) : selectedFacility ? (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900 leading-tight">{selectedFacility.name}</h2>
                      <p className="text-sm text-slate-500 mt-1">
                        {selectedFacility.address}, {selectedFacility.city}, {selectedFacility.state || selectedState}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="inline-block bg-slate-100 px-2 py-1 rounded text-[10px] font-mono font-bold text-slate-600">
                          ID: {selectedFacility.id}
                        </span>
                        {selectedFacility.triId && (
                          <span className="inline-block bg-purple-50 px-2 py-1 rounded text-[10px] font-mono font-bold text-purple-600">
                            TRI: {selectedFacility.triId}
                          </span>
                        )}
                        <PermitBadge permitType={selectedFacility.permitType} isMajor={selectedFacility.isMajor} hasHpv={selectedFacility.hasHpv} />
                      </div>
                      {selectedFacility.hasHpv && (
                        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1.5">
                          <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                          High Priority Violation on record (EPA ECHO)
                        </div>
                      )}
                    </div>

                    {modelingMode === 'Toxics' ? (
                      <div className="border-t border-slate-100 pt-6">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">HAPs Inventory (TRI)</h3>
                          {availableToxicsYears.length > 0 ? (
                            <select
                              value={toxicsYear || ''}
                              onChange={async (e) => {
                                const yr = e.target.value;
                                setToxicsLoading(true);
                                const data = await fetchHaps(selectedFacility!.id, selectedFacility!.triId ?? undefined, yr);
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
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                              {toxicsYear} TRI
                            </span>
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

                            {/* TREND CHART */}
                            {Object.keys(historicalHaps).length > 1 && (
                              <div className="mt-4 pt-4 border-t border-slate-100">
                                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Historical Release Trend</h3>
                                <div className="h-56 w-full">
                                  {isMounted ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                      {(() => {
                                        // 1. Calculate total historical volume per pollutant to find the Top 5
                                        const pollutantTotals: Record<string, number> = {};
                                        Object.values(historicalHaps).forEach(arr => {
                                          arr.forEach(h => {
                                            pollutantTotals[h.pollutant] = (pollutantTotals[h.pollutant] || 0) + h.amount;
                                          });
                                        });
                                        const sortedPollutants = Object.keys(pollutantTotals).sort((a, b) => pollutantTotals[b] - pollutantTotals[a]);
                                        const topPollutants = sortedPollutants.slice(0, 5);
                                        const hasOthers = sortedPollutants.length > 5;

                                        // 2. Build the chart data grouped by Top 5 + "Other HAPs"
                                        const years = Object.keys(historicalHaps).sort((a, b) => parseInt(a) - parseInt(b));
                                        const chartData = years.map(y => {
                                          const point: any = { year: y };
                                          let otherSum = 0;
                                          historicalHaps[y].forEach(h => {
                                            if (topPollutants.includes(h.pollutant)) {
                                              point[h.pollutant] = h.amount;
                                            } else {
                                              otherSum += h.amount;
                                            }
                                          });
                                          if (hasOthers) {
                                            point['Other HAPs (Combined)'] = otherSum;
                                          }
                                          return point;
                                        });

                                        const linesToRender = [...topPollutants];
                                        if (hasOthers) linesToRender.push('Other HAPs (Combined)');

                                        const colors = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#94a3b8']; // slate-400 for 'Others'

                                        return (
                                          <LineChart data={chartData}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                            <XAxis dataKey="year" fontSize={9} tickMargin={8} tick={{ fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                                            <YAxis fontSize={9} tick={{ fill: '#94A3B8' }} axisLine={false} tickLine={false} tickFormatter={(val) => val < 1 && val > 0 ? '<1' : val} />
                                            <Tooltip
                                              content={<CustomTooltip />}
                                              position={{ x: -175, y: 15 }}
                                            />
                                            <Legend wrapperStyle={{ fontSize: '9px', marginTop: '10px' }} iconType="circle" />
                                            {linesToRender.map((pollutant, idx) => (
                                              <Line
                                                key={pollutant}
                                                type="monotone"
                                                dataKey={pollutant}
                                                stroke={pollutant === 'Other HAPs (Combined)' ? '#94a3b8' : colors[idx % (colors.length - 1)]}
                                                strokeWidth={pollutant === 'Other HAPs (Combined)' ? 1.5 : 2}
                                                strokeDasharray={pollutant === 'Other HAPs (Combined)' ? '4 4' : undefined}
                                                dot={{ r: 3, strokeWidth: 1 }}
                                                activeDot={{ r: 5, strokeWidth: 0 }}
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
                              href={selectedFacility ? `https://echo.epa.gov/facilities/facility-search/results?facility_uin=${selectedFacility.id}` : '#'}
                              target="_blank" rel="noopener noreferrer"
                              className="inline-block mt-3 text-[9px] font-bold text-blue-600 hover:underline"
                            >
                              View on EPA ECHO →
                            </a>
                          </div>
                        )}

                        {/* ── NEI 2020 HAPs ── */}
                        {(neiLoading || (neiData?.found && neiData.haps.length > 0)) && (
                          <div className="border-t border-slate-100 pt-5 mt-2">
                            <div className="flex items-center justify-between mb-3">
                              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                                <BarChart3 className="h-3 w-3" /> NEI 2020 HAPs
                              </h3>
                              {!neiLoading && (
                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                                  2020 NEI
                                </span>
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
                                {neiData?.county && (
                                  <p className="text-[9px] text-slate-300 mt-2">County: {neiData.county} · FIPS: {neiData.fips}</p>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        {/* Emissions Section — Actual vs PTE */}
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
                              {selectedFacility?.camdId && (
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
                                  <p className="text-[9px] font-bold text-blue-600 uppercase tracking-widest mb-1.5">
                                    Actual Emissions
                                  </p>
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
                                  <p className="text-[9px] font-bold text-amber-600 uppercase tracking-widest mb-1.5">
                                    Potential to Emit (PTE)
                                  </p>
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
                              {selectedFacility?.camdId && Object.keys(historicalEmissions).length > 1 && (
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
                                            return {
                                              year: y,
                                              'SO2': so2Match ? so2Match.amount : 0,
                                              'NOx': noxMatch ? noxMatch.amount : 0,
                                            };
                                          });

                                          return (
                                            <LineChart data={chartData}>
                                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                              <XAxis dataKey="year" fontSize={9} tickMargin={8} tick={{ fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                                              <YAxis fontSize={9} tick={{ fill: '#94A3B8' }} axisLine={false} tickLine={false} unit=" T" />
                                              <Tooltip
                                                content={<CamdTooltip />}
                                                position={{ x: -175, y: 15 }}
                                              />
                                              <Legend wrapperStyle={{ fontSize: '9px', marginTop: '10px' }} iconType="circle" />
                                              <Line
                                                type="monotone"
                                                dataKey="SO2"
                                                name="SO2 (Tons)"
                                                stroke="#3b82f6"
                                                strokeWidth={2}
                                                dot={{ r: 3, strokeWidth: 1, stroke: '#3b82f6', fill: '#fff' }}
                                                activeDot={{ r: 5, strokeWidth: 0, fill: '#3b82f6' }}
                                              />
                                              <Line
                                                type="monotone"
                                                dataKey="NOx"
                                                name="NOx (Tons)"
                                                stroke="#f59e0b"
                                                strokeWidth={2}
                                                dot={{ r: 3, strokeWidth: 1, stroke: '#f59e0b', fill: '#fff' }}
                                                activeDot={{ r: 5, strokeWidth: 0, fill: '#f59e0b' }}
                                              />
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
                                {selectedFacility?.camdId ? 'No CAMPD emissions data for this unit.' : 'Emissions data not available via EPA API.'}
                              </p>
                              <p className="text-[9px] text-slate-400 leading-relaxed mb-2">
                                {selectedFacility?.camdId
                                  ? 'This EGU may not have recent CEMS monitoring records.'
                                  : 'EPA EIS_ANNUAL_EMISSIONS endpoint is deprecated. Use "+ Add Data" to manually enter values from the report below.'}
                              </p>
                              <a
                                href={`https://echo.epa.gov/air-pollutant-report/air-pollutant-report?facility_uin=${selectedFacility?.id}`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-[9px] font-bold text-blue-600 hover:underline"
                              >
                                View ECHO Air Pollutant Report →
                              </a>
                            </div>
                          ) : null}
                        </div>

                        {/* ── PSD Significance Threshold Screener ── */}
                        {hasEmissionsData && (() => {
                          // Build per-pollutant map of actual & PTE values
                          const serRows: { key: string; ser: number; actual: number | null; pte: number | null }[] = [];
                          Object.entries(PSD_SER).forEach(([key, ser]) => {
                            const actualMatch = actualEmissions.find(e => normalizePsdPollutant(e.pollutant) === key);
                            const pteMatch = pteEmissions.find(e => normalizePsdPollutant(e.pollutant) === key);
                            if (actualMatch || pteMatch) {
                              serRows.push({
                                key,
                                ser,
                                actual: actualMatch ? actualMatch.amount : null,
                                pte: pteMatch ? pteMatch.amount : null,
                              });
                            }
                          });
                          if (serRows.length === 0) return null;
                          const anyExceedance = serRows.some(r =>
                            (r.actual !== null && r.actual >= r.ser) ||
                            (r.pte !== null && r.pte >= r.ser)
                          );
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

                        {/* ── NEI 2020 Reported Emissions ── */}
                        {(neiLoading || (neiData?.found && neiData.emissions.length > 0)) && (
                          <div className="border-t border-slate-100 pt-5 mt-2">
                            <div className="flex items-center justify-between mb-3">
                              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                                <BarChart3 className="h-3 w-3" /> NEI 2020 Reported
                              </h3>
                              {!neiLoading && (
                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                                  2020 NEI
                                </span>
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
                                    <p className="text-[9px] text-slate-400 mb-2">
                                      Criteria air pollutants (CAPs) — facility-reported, actual emissions.
                                    </p>
                                    <div className="grid grid-cols-2 gap-1.5 mb-3">
                                      {neiData!.emissions.map((e, i) => (
                                        <div key={i} className="bg-emerald-50/70 p-2 rounded border border-emerald-100">
                                          <p className="text-[8px] font-bold text-slate-400 uppercase truncate">{e.pollutant}</p>
                                          <p className="text-xs font-bold text-emerald-700">
                                            {e.amount.toLocaleString()} <span className="font-normal text-[9px] text-slate-400">{e.unit}</span>
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                  </>
                                )}
                                {neiData?.county && (
                                  <p className="text-[9px] text-slate-300 mt-2">County: {neiData.county} · FIPS: {neiData.fips}</p>
                                )}
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

            {/* County Background Emissions (NEI 2020) */}
            {(center || countyLoading) && (
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="py-3 border-b border-slate-100">
                  <CardTitle className="text-sm font-bold text-slate-600 uppercase tracking-tight flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-teal-500" />
                    County Background
                    {countyData?.county && !countyLoading && (
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 ml-auto normal-case tracking-normal">
                        {countyData.county}
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-3 pb-4 px-4">
                  {countyLoading ? (
                    <div className="flex items-center gap-2 text-xs text-slate-400 italic">
                      <Loader2 className="h-3 w-3 animate-spin" /> Looking up county emissions…
                    </div>
                  ) : countyData?.found && countyData.emissions.length > 0 ? (
                    <div>
                      <p className="text-[9px] text-slate-400 mb-3 leading-relaxed">
                        2020 NEI total county emissions (all source categories). Useful for PSD cumulative impact context.
                      </p>
                      <div className="space-y-2">
                        {countyData.emissions.map((e, i) => {
                          const maxTotal = countyData.emissions[0]?.total ?? 1;
                          const pct = Math.min(100, ((e.total ?? 0) / maxTotal) * 100);
                          return (
                            <div key={i}>
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[9px] font-semibold text-slate-600">{e.pollutant}</span>
                                <span className="text-[9px] font-mono font-bold text-teal-700">
                                  {(e.total ?? 0).toLocaleString()} TPY
                                </span>
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
                    <p className="text-[10px] text-slate-400 italic">
                      {center ? 'No NEI county data found for this location.' : 'Set a project location to see county context.'}
                    </p>
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
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-red-500 inline-block flex-shrink-0"></span>
                  <span className="text-xs text-slate-600">Major Source (Title V)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-amber-500 inline-block flex-shrink-0"></span>
                  <span className="text-xs text-slate-600">Synthetic Minor</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-blue-500 inline-block flex-shrink-0"></span>
                  <span className="text-xs text-slate-600">Minor / Other CAA Source</span>
                </div>
              </div>
            </div>

            <div className={`rounded-2xl p-6 text-white shadow-lg transition-colors duration-500 ${modelingMode === 'Toxics' ? 'bg-purple-600 shadow-purple-200' : 'bg-blue-600 shadow-blue-200'}`}>
              <h3 className="font-bold text-lg mb-2">{modelingMode} Quick Guide</h3>
              <p className={`text-xs leading-relaxed opacity-90 ${modelingMode === 'Toxics' ? 'text-purple-50' : 'text-blue-100'}`}>
                {modelingMode === 'Toxics'
                  ? 'Displays HAP emissions from NEI/EIS for all CAA-regulated sources. TRI API is currently unavailable; NEI data covers all major & minor permitted sources with actual and PTE values.'
                  : 'Use radius search to identify surrounding facilities for PSD multi-source analysis. Major sources shown in red.'}
              </p>
              <div className={`mt-4 pt-4 border-t ${modelingMode === 'Toxics' ? 'border-purple-500/30' : 'border-blue-500/30'}`}>
                <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${modelingMode === 'Toxics' ? 'text-purple-200' : 'text-blue-200'}`}>Modeling Tips</p>
                <ul className={`text-[10px] space-y-2 list-disc pl-4 ${modelingMode === 'Toxics' ? 'text-purple-50' : 'text-blue-50'}`}>
                  {modelingMode === 'Toxics' ? (
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
          <p className="text-slate-500 text-xs font-medium">
            For comments, bug reports, questions, or suggestions, please contact:
          </p>
          <p className="text-slate-900 text-sm font-bold mt-1">
            Rodney Cuevas — <a href="mailto:RCuevas@mdeq.ms.gov" className="text-blue-600 hover:underline">RCuevas@mdeq.ms.gov</a>
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 text-[10px] text-slate-400 uppercase tracking-widest">
            <span>Mississippi Department of Environmental Quality</span>
            <span>·</span>
            <span>Air Toxics & PSD Modeling Unit</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
