export default function PermitBadge({ permitType, isMajor, hasHpv }: { permitType?: string; isMajor?: boolean; hasHpv?: boolean }) {
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
