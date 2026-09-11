/**
 * ⭐ 상태 뱃지 정본 (ERP 구조화 배치1, 2026-08-25 · 용어 ERP화 2026-09-12)
 *
 *   cash_txn·tax_invoice의 recon_status CHECK 값을 그대로 받아
 *   화면 말·색을 전 화면 공통으로 통일한다 (화면마다 다르던 것 수렴).
 *   글자는 `statusWord()`(fin-words.ts) — 사장님(09-11) "ERP 기준 명료한 단어":
 *   미대조→미대사 · 제안→대사 후보 · 확정→대사 완료 · 무시→제외 · 대기→보류(전엔 빠져 날것으로 나옴).
 * 🔴 DB 값('미대조' 등)은 그대로 — 여기서 바꾸는 건 색과 글자뿐.
 */
import { statusWord } from "@/lib/fin-words";

const CLS: Record<string, string> = {
  미대조: "bg-amber-100 text-amber-700",
  제안: "bg-sky-100 text-sky-700",
  확정: "bg-brand-100 text-brand-700",
  무시: "bg-slate-100 text-slate-500",
  대기: "bg-amber-50 text-amber-800",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = CLS[status] ?? "bg-slate-100 text-slate-500";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{statusWord(status)}</span>;
}
