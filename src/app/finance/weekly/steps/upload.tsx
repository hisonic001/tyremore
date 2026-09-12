/**
 * ⭐ ① 자료 올리기 — 흐름의 첫 단계 (개편 3단계, 2026-09-12)
 *
 *   「어디까지 올라왔나」(정본 uploadCoverage + coverageStatus — 빈 곳 판정은 이 순수 함수 하나)와
 *   올리기 부품(FinUpload — 여러 파일 한 번에, 순서대로 반영), 최근 올린 5줄.
 *   칩 격자는 올리기·올린 자료 화면과 같은 부품(CoverageGrid) — 세 곳이 같은 것을 그린다.
 *   다음 화면 링크(nextStepOf)는 흐름 안에선 숨긴다 — 「다음 →」이 그 역할이다.
 */
import Link from "@/lib/link";
import { uploadCoverage, coverageStatus } from "@/lib/upload-coverage";
import { uploadLedger } from "@/lib/upload-ledger";
import { CoverageGrid } from "@/components/fin/coverage-grid";
import { FinUpload } from "@/app/finance/upload/upload-ui";

export async function UploadStep({ ym }: { ym: string }) {
  const rows = await uploadCoverage();
  const status = coverageStatus(rows, ym);
  const recent = await uploadLedger({ limit: 5 });
  return (
    <section className="mt-4 space-y-4">
      <CoverageGrid rows={rows} status={status} />
      <FinUpload ym={ym} multiple showNext={false} />
      {recent.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500">최근 올린 파일</p>
          <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span className="min-w-0 truncate">
                  <span className="text-slate-400">{r.at}</span> <span className="font-medium">{r.source}</span>
                  {r.accountLabel && <span className="text-slate-500"> · {r.accountLabel}</span>}
                  <span className="text-slate-500"> · {r.fileName}</span>
                </span>
                <span className={`tabular shrink-0 text-xs ${r.note === "정리 안 됨" ? "text-amber-800" : "text-slate-500"}`}>
                  {r.newCount}줄 새로 · {r.note}
                </span>
              </li>
            ))}
          </ul>
          <Link href="/finance/files" className="mt-1 inline-block text-xs text-slate-500 underline underline-offset-2">
            올린 자료 전부 →
          </Link>
        </div>
      )}
    </section>
  );
}
