'use client';

import { useState } from 'react';
import { StackParameter } from '@/lib/data-service';
import { Wind, Upload, FileText, AlertCircle, Copy, Check } from 'lucide-react';

interface StackInventoryProps {
  stacks: StackParameter[];
  loading: boolean;
  facilityName: string;
  camdId?: string | null;
  onUpload: (data: StackParameter[]) => void;
}

// Unit conversion helpers for AERMOD
const ftToM = (ft: number) => (ft * 0.3048).toFixed(2);
const fToK = (f: number) => ((f - 32) * 5 / 9 + 273.15).toFixed(2);
const fpsToMs = (fps: number) => (fps * 0.3048).toFixed(2);

function buildAermodLine(s: StackParameter): string {
  const hm = s.height ? ftToM(s.height) : '?.??';
  const tk = s.temp != null ? fToK(s.temp) : '?.??';
  const vm = s.velocity != null ? fpsToMs(s.velocity) : '?.??';
  const dm = s.diameter ? ftToM(s.diameter) : '?.??';
  // Emission rate is facility/pollutant-specific — user fills in (g/s)
  return `SO POINTSOURCE  ${s.stackId}  <em_gs>  ${hm}  ${tk}  ${vm}  ${dm}`;
}

function AermodCopyButton({ line }: { line: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(line);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — fall back to selection
    }
  };

  return (
    <button
      onClick={handleCopy}
      title="Copy AERMOD SO POINTSOURCE line"
      className="flex items-center gap-1 text-[9px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-1 rounded transition-all"
    >
      {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied!' : 'AERMOD'}
    </button>
  );
}

export default function StackInventory({ stacks, loading, facilityName, camdId, onUpload }: StackInventoryProps) {
  const [showManualForm, setShowManualForm] = useState(false);
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n');
      // Expected columns: stackId, height(ft), diameter(ft), temp(°F), velocity(fps), flowRate(optional)
      const parsed: StackParameter[] = lines.slice(1).map(line => {
        const p = line.split(',');
        return {
          stackId: p[0]?.trim() || `SRC-${Math.random().toString(36).slice(2, 6)}`,
          height: parseFloat(p[1]),
          diameter: parseFloat(p[2]),
          temp: parseFloat(p[3]),
          velocity: parseFloat(p[4]),
          flowRate: p[5] ? parseFloat(p[5]) : undefined,
          dataSource: 'User' as const,
          dataYear: String(new Date().getFullYear()),
        };
      }).filter(s => !isNaN(s.height));

      onUpload(parsed);
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
          Stack Parameters (Point Sources)
        </h3>
        <label className="cursor-pointer bg-slate-100 hover:bg-slate-200 p-1.5 rounded transition-colors group" title="Upload stack parameters CSV">
          <Upload className="h-3.5 w-3.5 text-slate-500 group-hover:text-blue-600" />
          <input type="file" className="hidden" accept=".csv" onChange={handleFileChange} />
        </label>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 italic py-4">
          <div className="h-3 w-3 border-2 border-blue-600 border-t-transparent animate-spin rounded-full" />
          Querying EPA EIS database...
        </div>
      ) : stacks.length > 0 ? (
        <div className="space-y-3">
          {stacks.map((s, i) => {
            const aermodLine = buildAermodLine(s);
            return (
              <div key={i} className="bg-slate-50 p-4 rounded-xl border border-slate-100 hover:border-blue-200 transition-all shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <span className="bg-blue-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full">POINT SOURCE #{s.stackId}</span>
                  <div className="flex items-center gap-2">
                    <AermodCopyButton line={aermodLine} />
                    <Wind className="h-3 w-3 text-slate-300" />
                  </div>
                </div>

                {/* Data provenance badge */}
                <div className="flex items-center gap-2 mb-3">
                  {s.dataSource === 'CAMD' && (
                    <span className="text-[8px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">
                      Source: CAMD/CAMPD · {s.dataYear || 'Live'}
                    </span>
                  )}
                  {s.dataSource === 'NEI' && (
                    <span className="text-[8px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                      Source: NEI/EIS · {s.dataYear || '2020'}
                    </span>
                  )}
                  {s.dataSource === 'Estimate' && (
                    <span className="text-[8px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                      ⚠ Estimated · NAICS Industry Median
                    </span>
                  )}
                  {s.dataSource === 'User' && (
                    <span className="text-[8px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
                      Source: User-provided
                    </span>
                  )}
                  {!s.dataSource && (
                    <span className="text-[8px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                      Source: Unknown
                    </span>
                  )}
                </div>

                {/* Stack parameters — imperial display */}
                <div className="grid grid-cols-2 gap-y-3 gap-x-2 mb-3">
                  <div className="space-y-0.5">
                    <p className="text-[9px] text-slate-400 uppercase font-bold tracking-tighter">Stack Height</p>
                    <p className="text-sm font-bold text-slate-800">{s.height} <span className="text-[10px] font-normal text-slate-400">ft</span></p>
                    <p className="text-[9px] text-slate-400">{ftToM(s.height)} m</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[9px] text-slate-400 uppercase font-bold tracking-tighter">Diameter</p>
                    <p className="text-sm font-bold text-slate-800">{s.diameter} <span className="text-[10px] font-normal text-slate-400">ft</span></p>
                    <p className="text-[9px] text-slate-400">{ftToM(s.diameter)} m</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[9px] text-slate-400 uppercase font-bold tracking-tighter">Exit Temp</p>
                    <p className="text-sm font-bold text-slate-800">{s.temp ?? '—'} <span className="text-[10px] font-normal text-slate-400">°F</span></p>
                    {s.temp != null && <p className="text-[9px] text-slate-400">{fToK(s.temp)} K</p>}
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[9px] text-slate-400 uppercase font-bold tracking-tighter">Exit Velocity</p>
                    <p className="text-sm font-bold text-slate-800">{s.velocity ?? '—'} <span className="text-[10px] font-normal text-slate-400">fps</span></p>
                    {s.velocity != null && <p className="text-[9px] text-slate-400">{fpsToMs(s.velocity)} m/s</p>}
                  </div>
                  {s.flowRate != null && (
                    <div className="space-y-0.5 col-span-2">
                      <p className="text-[9px] text-slate-400 uppercase font-bold tracking-tighter">Flow Rate</p>
                      <p className="text-sm font-bold text-slate-800">{s.flowRate} <span className="text-[10px] font-normal text-slate-400">ft³/s</span></p>
                    </div>
                  )}
                </div>

                {/* AERMOD preview line */}
                <div className="bg-slate-900 rounded p-2 mt-1">
                  <p className="text-[8px] text-slate-400 font-bold uppercase tracking-widest mb-1">AERMOD SO POINTSOURCE</p>
                  <code className="text-[9px] text-green-400 font-mono break-all leading-relaxed">{aermodLine}</code>
                  <p className="text-[8px] text-slate-500 mt-1">Replace &lt;em_gs&gt; with emission rate in g/s</p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-8 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 px-5">
          <FileText className="h-8 w-8 text-slate-200 mx-auto mb-3" />
          <p className="text-xs text-slate-600 font-semibold mb-1">
            Stack parameters unavailable via EPA API
          </p>
          <p className="text-[10px] text-slate-400 leading-relaxed mb-3 max-w-xs mx-auto">
            EPA&apos;s EIS stack parameter tables are no longer publicly accessible. Obtain stack data from permit records or the NEI portal.
          </p>

          {camdId && (
            <div className="mb-4 bg-blue-50 border border-blue-100 rounded-lg p-3 text-left">
              <p className="text-[9px] font-bold text-blue-600 uppercase tracking-widest mb-1">⚡ EGU / Power Plant Detected</p>
              <p className="text-[9px] text-blue-700 leading-relaxed">
                CAMPD API was queried for ORIS code <code className="font-mono font-bold">{camdId}</code>. Unit may lack monitored stack records.
              </p>
              <a
                href={`https://campd.epa.gov/`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-1.5 text-[9px] font-bold text-blue-600 hover:underline"
              >
                Open EPA CAMPD Facility Viewer →
              </a>
            </div>
          )}

          <a
            href="https://www.epa.gov/air-emissions-inventories/national-emissions-inventory-nei"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[9px] font-bold text-blue-600 hover:underline mb-4"
          >
            <FileText className="h-3 w-3" /> EPA NEI Data &amp; Documentation →
          </a>

          <p className="text-[9px] text-slate-400 mb-4">
            CSV columns: <code className="font-mono">stackId, height(ft), diameter(ft), temp(°F), velocity(fps)</code>
          </p>

          <div className="flex flex-col gap-3 items-center">
             <button
              onClick={() => setShowManualForm(!showManualForm)}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-5 py-2.5 rounded-lg transition-colors shadow-sm shadow-blue-200"
            >
              {showManualForm ? 'Cancel Entry' : 'Add Stack Manually'}
            </button>
            
            {showManualForm && (
              <div className="w-full max-w-sm bg-white p-4 rounded-lg border border-slate-200 shadow-sm text-left">
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Stack ID</label>
                    <input 
                      type="text" 
                      placeholder="S001"
                      className="w-full text-xs border border-slate-300 rounded p-1.5 focus:border-blue-500 outline-none"
                      id="manual-stack-id"
                    />
                  </div>
                   <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Height (ft)</label>
                    <input 
                      type="number" step="0.1"
                      placeholder="50.0"
                      className="w-full text-xs border border-slate-300 rounded p-1.5 focus:border-blue-500 outline-none"
                      id="manual-stack-height"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Diameter (ft)</label>
                    <input 
                      type="number" step="0.1"
                      placeholder="3.0"
                      className="w-full text-xs border border-slate-300 rounded p-1.5 focus:border-blue-500 outline-none"
                      id="manual-stack-diameter"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Temp (°F)</label>
                    <input 
                      type="number" step="1"
                      placeholder="350"
                      className="w-full text-xs border border-slate-300 rounded p-1.5 focus:border-blue-500 outline-none"
                      id="manual-stack-temp"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Velocity (fps)</label>
                    <input 
                      type="number" step="0.1"
                      placeholder="45.0"
                      className="w-full text-xs border border-slate-300 rounded p-1.5 focus:border-blue-500 outline-none"
                      id="manual-stack-velocity"
                    />
                  </div>
                </div>
                <button 
                  onClick={() => {
                    const idInput = document.getElementById('manual-stack-id') as HTMLInputElement;
                    const hInput = document.getElementById('manual-stack-height') as HTMLInputElement;
                    const dInput = document.getElementById('manual-stack-diameter') as HTMLInputElement;
                    const tInput = document.getElementById('manual-stack-temp') as HTMLInputElement;
                    const vInput = document.getElementById('manual-stack-velocity') as HTMLInputElement;

                    const id = idInput.value;
                    const h = parseFloat(hInput.value);
                    const d = parseFloat(dInput.value);
                    const t = parseFloat(tInput.value);
                    const v = parseFloat(vInput.value);

                    if (id && !isNaN(h) && !isNaN(d)) {
                      onUpload([...stacks, {
                        stackId: id,
                        height: h,
                        diameter: d,
                        temp: !isNaN(t) ? t : undefined,
                        velocity: !isNaN(v) ? v : undefined,
                        dataSource: 'User' as const,
                        dataYear: String(new Date().getFullYear()),
                      }]);
                      setShowManualForm(false);
                      // Clear inputs
                      idInput.value = '';
                      hInput.value = '';
                      dInput.value = '';
                      tInput.value = '';
                      vInput.value = '';
                    }
                  }}
                  className="w-full bg-slate-900 text-white text-xs font-bold py-2 rounded hover:bg-slate-800 transition-colors"
                >
                  Save Stack Parameter
                </button>
              </div>
            )}

            <label className="cursor-pointer inline-flex items-center gap-2 text-slate-500 hover:text-blue-600 text-[10px] font-bold transition-colors">
              <Upload className="h-3 w-3" /> Or Upload CSV
              <input type="file" className="hidden" accept=".csv" onChange={handleFileChange} />
            </label>
          </div>
        </div>
      )}

      <div className="bg-amber-50 border border-amber-100 p-3 rounded-lg flex gap-3">
        <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-[10px] text-amber-800 leading-relaxed">
          <strong>AERMOD Note:</strong> Replace <code className="font-mono">&lt;em_gs&gt;</code> with the source-specific emission rate (g/s). Converted SI values (m, K, m/s) shown below imperial.
        </p>
      </div>
    </div>
  );
}
