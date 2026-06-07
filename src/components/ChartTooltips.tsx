export const CustomTooltip = ({ active, payload, label }: any) => {
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

export const CamdTooltip = ({ active, payload, label }: any) => {
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

export const NaaqsTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    // Sort payload so the highest values are at the top
    const sorted = [...payload].sort((a, b) => b.value - a.value);
    return (
      <div className="bg-slate-950/95 backdrop-blur-sm p-3 rounded-xl border border-slate-800 shadow-2xl text-[10px] text-white max-w-[200px] pointer-events-none">
        <p className="font-bold border-b border-slate-800 pb-1 mb-1.5 text-center text-emerald-400">{label} NAAQS</p>
        <div className="space-y-1.5 max-h-[150px] overflow-y-auto pr-1">
          {sorted.map((item: any, index: number) => {
            const val = item.value;
            const formattedVal = val.toLocaleString(undefined, { maximumFractionDigits: 3 });
            return (
              <div key={index} className="flex items-center justify-between gap-4 border-b border-slate-800/40 pb-0.5 last:border-0 last:pb-0">
                <span className="text-[9px] text-slate-400 truncate max-w-[130px]" title={item.name}>
                  {item.name}
                </span>
                <span className="font-mono font-bold text-[9px]" style={{ color: item.color || '#e2e8f0' }}>
                  {formattedVal}
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
