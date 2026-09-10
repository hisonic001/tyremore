import { redirect } from "next/navigation";
import { getSession, hasPerm } from "@/lib/auth";
import Link from "@/lib/link";
import { FinShell } from "@/components/fin/shell";
import { SectionCard } from "@/components/fin/section";
import { pickYm } from "@/lib/ym";
import { uploadCoverage, coverageStatus } from "@/lib/upload-coverage";
import { uploadLedger, findUploadOfLine } from "@/lib/upload-ledger";
import { cancelFinUpload } from "@/lib/fin-upload";

export const dynamic = "force-dynamic";

const won = (n: number) => n.toLocaleString("ko-KR");

/** 폼에서 부르는 배치 취소 — 올리기 화면과 같은 관용구 */
async function cancelBatch(id: number, _fd: FormData): Promise<void> {
  "use server";
  await cancelFinUpload(id);
}

/**
 * ⭐ 올린 자료 (사장님 요청 2026-09-10 — "내가 올린 자료들의 내역도 보기가 힘듦")
 *
 *   한 화면에 넷: ① 어느 기간이 비었나(정본 upload-coverage) ② 검색 — 파일로도, **줄(적요·금액)로도**
 *   ③ 줄로 찾으면 「이 줄이 어느 파일에서 왔나」 ④ 언제 무엇을 올렸나 + 정리 안 된 줄 + 되돌리기.
 *   정본은 lib/upload-ledger.ts — 올리기 화면의 「최근 올린 파일」도 같은 함수를 쓴다.
 */
export default async function FinanceFilesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await hasPerm("finance"))) redirect("/");

  const sp = await searchParams;
  const ym = pickYm(sp.ym);
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const cov = await uploadCoverage();
  const st = coverageStatus(cov, ym);
  const lag = new Set(st.lagging.map((r) => r.key));
  const uploads = await uploadLedger({ q: q || null, limit: q ? 100 : 60 });
  const lines = q ? await findUploadOfLine(q) : null;
  const openTotal = uploads.filter((u) => u.status === "반영").reduce((s, u) => s + (u.open ?? 0), 0);

  return (
    <FinShell tab="files" ym={ym}>
      <p className="mt-2 text-sm text-slate-500">
        올린 파일이 언제·무엇·어디까지 들어갔는지, 아직 정리 안 된 줄이 몇 개인지 한 화면에서 봅니다.
      </p>

      {/* ② 어느 기간이 비었나 — 올리기 화면과 같은 정본 */}
      <SectionCard
        title={
          <>
            {Number(ym.slice(5, 7))}월 자료, 어디까지 올라왔나{" "}
            {st.ok ? (
              <span className="text-sm font-normal text-emerald-700">— 다 올라왔습니다 ✓</span>
            ) : (
              <span className="text-sm font-normal text-amber-700">— {st.lagging.length}곳이 비었습니다</span>
            )}
          </>
        }
      >
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
                {lag.has(r.key) && " ⚠ 비었음"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-xs text-slate-400">
          기준일 {st.endShown.slice(5)} 3일 전까지 안 온 자료에 ⚠ — 비었으면{" "}
          <Link href={`/finance/upload?ym=${ym}`} className="underline">올리기</Link>로.
        </p>
      </SectionCard>

      {/* ④ 검색 — 파일명·계좌·원천·달(2026-09) 또는 줄의 적요·금액 */}
      <form action="/finance/files" method="get" className="mt-4 flex gap-2">
        <input type="hidden" name="ym" value={ym} />
        <input
          name="q"
          defaultValue={q}
          placeholder="파일명 · 계좌 · 2026-09 · 적요(예: 미광) · 금액(예: 280000)"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
          찾기
        </button>
        {q && (
          <Link href={`/finance/files?ym=${ym}`} className="shrink-0 self-center text-xs text-slate-500 underline">
            지우기
          </Link>
        )}
      </form>

      {/* ③ 줄로 찾았을 때 — 이 줄이 어느 파일에서 왔나 */}
      {lines && (
        <SectionCard tone="suggest" title={`「${q}」이 든 줄 ${lines.hits.length}개 — 어느 파일에서 왔나`}>
          {lines.hint && <p className="mt-1 text-sm text-slate-600">{lines.hint}</p>}
          {lines.hits.length > 0 && (
            <ul className="mt-2 divide-y divide-sky-100 text-sm">
              {lines.hits.map((h, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
                  <span className="min-w-0">
                    <span className="tabular text-xs text-slate-500">{h.d}</span>{" "}
                    <span className="mr-1 rounded bg-white px-1.5 py-0.5 text-xs text-sky-800 ring-1 ring-sky-200">{h.kind}</span>
                    <span className="break-all">{h.text}</span>
                    {h.status && <span className="ml-1 text-xs text-slate-500">· {h.status}</span>}
                  </span>
                  <span className="tabular shrink-0 font-semibold">{won(h.amount)}원</span>
                  <span className="w-full text-xs text-slate-500">
                    {h.upload
                      ? <>파일: <span className="break-all">{h.upload.fileName}</span> ({h.upload.source} · {h.upload.at}{h.upload.status === "취소" ? " · 되돌린 파일" : ""})</>
                      : "파일 정보 없음 (직접 넣은 줄이거나 옛 자료)"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {/* ① 언제 무엇을 올렸나 + ③ 정리 안 된 줄 */}
      <SectionCard
        title={
          <>
            올린 파일 {uploads.length}건
            {openTotal > 0 && <span className="ml-2 text-sm font-normal text-amber-700">— 정리 안 된 줄 {won(openTotal)}개</span>}
          </>
        }
      >
        {uploads.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">{q ? "걸리는 파일이 없습니다" : "아직 올린 파일이 없습니다"}</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {uploads.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 py-2">
                <span className="min-w-0 flex-1">
                  <span className="tabular text-xs text-slate-400">{u.at}</span>{" "}
                  <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{u.source}</span>
                  <span className="break-all text-sm">
                    {u.accountLabel ? `${u.accountLabel} · ` : ""}
                    {u.fileName}
                  </span>
                  <span className="tabular ml-1 text-xs text-slate-500">
                    {u.periodFrom && u.periodTo ? `${u.periodFrom.slice(2)}~${u.periodTo.slice(5)} · ` : ""}
                    {u.rowCount}줄 · 새 {u.newCount} · 중복 {u.dupCount}
                    {u.by ? ` · ${u.by}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs">
                  {u.note === "취소됨" ? (
                    <span className="text-slate-400">되돌림</span>
                  ) : u.note === "전부 중복" ? (
                    <span className="text-slate-500">전부 중복 — 이미 있던 자료</span>
                  ) : u.note === "정리 안 됨" ? (
                    <Link href={u.openHref} className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800 underline underline-offset-2">
                      정리 안 된 {u.open}줄 →
                    </Link>
                  ) : u.note === "정리 끝" ? (
                    <span className="text-emerald-700">정리 끝 ✓</span>
                  ) : (
                    <span className="text-slate-500">반영됨</span>
                  )}
                  {u.status !== "취소" && (
                    <form action={cancelBatch.bind(null, u.id)}>
                      <button type="submit" className="text-slate-400 underline">
                        되돌리기
                      </button>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-400">
          「정리 안 된 N줄」은 그 파일이 넣은 줄 중 아직 짝을 못 찾았거나 분류 안 된 것 — 누르면 그 화면으로 갑니다.
          되돌리면 그 파일이 새로 넣은 줄만 잠재웁니다 — 같은 파일을 다시 올리면 되살아납니다.
        </p>
      </SectionCard>
    </FinShell>
  );
}
