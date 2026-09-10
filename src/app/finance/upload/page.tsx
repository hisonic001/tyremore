import { redirect } from "next/navigation";
import { getSession, hasPerm } from "@/lib/auth";
import { uploadLedger } from "@/lib/upload-ledger";
import Link from "@/lib/link";
import { FinShell } from "@/components/fin/shell";
import { pickYm } from "@/lib/ym";
import { uploadCoverage, coverageStatus } from "@/lib/upload-coverage";
import { cancelFinUpload } from "@/lib/fin-upload";
import { FinUpload } from "./upload-ui";

export const dynamic = "force-dynamic";

/** 폼에서 부르는 배치 취소 — 폼 액션은 반환값이 없어야 해서 얇게 감싼다 (현황과 같은 관용구) */
async function cancelBatch(id: number, _fd: FormData): Promise<void> {
  "use server";
  await cancelFinUpload(id);
}

/**
 * ⭐ 돈 관리 — 엑셀 올리기 (ERP 1단계, 2026-08-24). 사장님 전용
 * 🔴 2026 감사 R3·R5(2026-08-26): 맨 위에 「어디까지 올렸나」(원천별 마지막 날짜), 아래에
 *    「최근 올린 파일 — 되돌리기」. 전엔 8월 카드 자료가 8/14에서 끊긴 걸 알 길이 없었다.
 */
export default async function FinanceUploadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await hasPerm("finance"))) redirect("/"); // 권한 스위치 (2026-09-02)

  const sp = await searchParams;
  const ym = pickYm(sp.ym);
  const cov = await uploadCoverage();
  const st = coverageStatus(cov, ym);
  const lag = new Set(st.lagging.map((r) => r.key));
  // ⭐ 정본 하나 (2026-09-10, upload-ledger.ts) — 「올린 자료」 화면과 같은 목록·같은 상태
  const uploads = await uploadLedger({ limit: 8 });

  return (
    <FinShell tab="upload" ym={ym}>
      <p className="mt-2 text-sm text-slate-500">
        월말에 인터넷뱅킹 거래내역(통장 2개), 법인카드 이용내역(신한·우리), 여신협회 카드매출 자료, 홈택스
        세금계산서 엑셀을 그대로 올리시면 됩니다. 같은 파일을 또 올려도 두 번 계산되지 않습니다.
      </p>

      {/* ⭐ 어디까지 올렸나 — 원천별 마지막 자료 날짜 (현황 체크리스트와 같은 정본) */}
      <section className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">
          {Number(ym.slice(5, 7))}월 자료, 어디까지 올라왔나{" "}
          {st.ok ? (
            <span className="text-sm font-normal text-emerald-700">— 다 올라왔습니다 ✓</span>
          ) : (
            <span className="text-sm font-normal text-amber-700">— {st.lagging.length}곳이 아직입니다</span>
          )}
        </h2>
        <ul className="mt-2 grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {cov.map((r) => (
            <li
              key={r.key}
              className={`tabular flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 ${
                lag.has(r.key) ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-600"
              }`}
            >
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="shrink-0 text-xs">
                {r.last ? `~${r.granularity === "month" ? r.last : r.last.slice(5)}` : "없음"}
                {lag.has(r.key) && " ⚠"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-xs text-slate-400">
          기준일 {st.endShown.slice(5)} 3일 전까지 안 온 자료에 ⚠ — 은행·카드사는 하루이틀 늦게 나옵니다.
        </p>
      </section>

      <FinUpload ym={ym} />

      {/* 최근 올린 파일 — 잘못 올렸으면 되돌리기 (전엔 현황 「내역」 안쪽에만 있었다) */}
      {uploads.length > 0 && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-600">최근 올린 파일 — 잘못 올렸으면 되돌리기</h2>
          <p className="mt-1 text-xs text-slate-400">
            되돌리면 그 파일이 새로 넣은 줄만 잠재웁니다 — 같은 파일을 다시 올리면 되살아납니다
          </p>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {uploads.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0">
                  <span className="tabular text-xs text-slate-400">{u.at}</span>{" "}
                  <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{u.source}</span>
                  <span className="break-all text-xs">
                    {u.accountLabel ? `${u.accountLabel} · ` : ""}
                    {u.fileName}
                  </span>
                  <span className="tabular ml-1 text-xs text-slate-500">
                    {u.periodFrom && u.periodTo ? `${u.periodFrom.slice(2)}~${u.periodTo.slice(5)} · ` : ""}새 {u.newCount} · 중복 {u.dupCount}
                    {u.note === "정리 안 됨" && (
                      <Link href={u.openHref} className="ml-1 text-amber-700 underline">정리 안 된 {u.open}줄</Link>
                    )}
                  </span>
                </span>
                {u.status === "취소" ? (
                  <span className="shrink-0 text-xs text-slate-400">되돌림</span>
                ) : (
                  <form action={cancelBatch.bind(null, u.id)}>
                    <button type="submit" className="shrink-0 text-xs text-slate-400 underline">
                      되돌리기
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">
            전체 목록·검색은 <Link href={`/finance/files?ym=${ym}`} className="underline">올린 자료</Link>에서.
          </p>
        </section>
      )}
    </FinShell>
  );
}
