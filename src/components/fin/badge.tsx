/**
 * ⭐ 상태 뱃지 정본 (ERP 구조화 배치1, 2026-08-25)
 *
 *   cash_txn·tax_invoice의 recon_status CHECK 4값을 그대로 받아
 *   화면 말·색을 전 화면 공통으로 통일한다 (화면마다 다르던 것 수렴).
 */
const MAP: Record<string, { label: string; cls: string }> = {
  미대조: { label: "확인 필요", cls: "bg-amber-100 text-amber-700" },
  제안: { label: "추천", cls: "bg-sky-100 text-sky-700" },
  확정: { label: "맞춰짐", cls: "bg-brand-100 text-brand-700" },
  무시: { label: "정리됨", cls: "bg-slate-100 text-slate-500" },
};

export function StatusBadge({ status }: { status: string }) {
  const m = MAP[status] ?? { label: status, cls: "bg-slate-100 text-slate-500" };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${m.cls}`}>{m.label}</span>;
}
