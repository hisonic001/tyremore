import Link from "@/lib/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { FinShell } from "@/components/fin/shell";
import { TableWrap, Money } from "@/components/fin/table";
import { StatusBadge } from "@/components/fin/badge";
import { won } from "@/components/fin/money";
import { pickYm } from "@/lib/ym";
import { partyLedgerData, type LedgerRow } from "@/lib/party-ledger";

export const dynamic = "force-dynamic";

/**
 * ⭐ 거래처 원장 (ERP 구조화 배치3, 사장님 승인 2026-08-25) — 사장님 전용
 *
 *   한 상대의 모든 오간 것(세금계산서·통장 입출금·앱 매입/판매·지급/수금)을
 *   시간순 한 표로. key = 'S:이름' · 'C:고객id' · 'B:사업자번호'.
 */

const KIND_CLS: Record<LedgerRow["kind"], string> = {
  계산서: "bg-violet-100 text-violet-800",
  입금: "bg-emerald-100 text-emerald-800",
  출금: "bg-red-100 text-red-700",
  매입: "bg-sky-100 text-sky-800",
  판매: "bg-emerald-100 text-emerald-800",
  지급: "bg-red-100 text-red-700",
  수금: "bg-emerald-100 text-emerald-800",
};

export default async function FinancePartyLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/");

  const { key: rawKey } = await params;
  const key = decodeURIComponent(rawKey);
  const sp = await searchParams;
  const ym = pickYm(sp.ym);

  const data = await partyLedgerData(key, ym);
  if (!data) notFound();

  // 종류 필터 (?k=) — 있는 종류만 칩으로
  const kinds = [...new Set(data.rows.map((r) => r.kind))];
  const k = typeof sp.k === "string" && kinds.includes(sp.k as LedgerRow["kind"]) ? sp.k : null;
  const rows = k ? data.rows.filter((r) => r.kind === k) : data.rows;
  const base = `/finance/party/${encodeURIComponent(key)}`;
  const chip = (on: boolean) =>
    on
      ? "rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white"
      : "rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-600";

  return (
    <FinShell tab="party" monthNav={{ ym, basePath: base, keep: k ? { k } : undefined }}>
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <h2 className="min-w-0 truncate text-lg font-bold">{data.title}</h2>
        <Link href="/finance/party" className="shrink-0 text-sm text-slate-500 underline underline-offset-4">
          ← 거래처 목록
        </Link>
      </div>
      {data.names.length > 1 && (
        <p className="mt-0.5 text-xs text-slate-400">이 이름들로 찾았습니다: {data.names.join(" · ")}</p>
      )}

      {/* 잔액 요약 — 전체 기간, 미지급·외상 화면과 같은 식 */}
      <section className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Link href="/finance/payables" className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">줄 돈 (미지급)</p>
          <p className={`tabular mt-1 font-bold ${data.payableRemain > 0 ? "text-red-600" : "text-slate-400"}`}>
            {won(data.payableRemain)}원
          </p>
        </Link>
        <Link href="/receivables" className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">받을 돈 (외상)</p>
          <p className={`tabular mt-1 font-bold ${data.receivableRemain > 0 ? "text-emerald-700" : "text-slate-400"}`}>
            {won(data.receivableRemain)}원
          </p>
        </Link>
        <Link href="/finance/tax" className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">계산서 미확인</p>
          <p className={`tabular mt-1 font-bold ${data.taxOpenSum > 0 ? "text-amber-700" : "text-slate-400"}`}>
            {won(data.taxOpenSum)}원
          </p>
        </Link>
      </section>

      {/* 종류 필터 칩 */}
      {kinds.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1.5 text-sm">
          <Link href={`${base}?ym=${ym}`} className={chip(!k)}>
            전체
          </Link>
          {kinds.map((kk) => (
            <Link key={kk} href={`${base}?ym=${ym}&k=${encodeURIComponent(kk)}`} className={chip(k === kk)}>
              {kk}
            </Link>
          ))}
        </div>
      )}

      {/* 원장 표 — 시간순 */}
      <TableWrap
        isEmpty={rows.length === 0}
        empty={`${ym}에는 이 상대와 오간 것이 없습니다 — 달을 넘겨 보세요`}
        minWidth={560}
      >
        <thead>
          <tr className="text-xs text-slate-500">
            <th className="py-1.5 text-left">날짜</th>
            <th className="text-left">구분</th>
            <th className="text-left">내용</th>
            <th className="text-right">금액</th>
            <th className="text-right">상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="py-1.5 text-xs text-slate-500">{r.d.slice(5)}</td>
              <td>
                <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${KIND_CLS[r.kind]}`}>{r.kind}</span>
              </td>
              <td className="max-w-[16rem] truncate text-xs">{r.label}</td>
              <td className="text-right">
                <Money n={r.amount} signed />
              </td>
              <td className="text-right">{r.status ? <StatusBadge status={r.status} /> : null}</td>
            </tr>
          ))}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr className="border-t border-slate-300 font-semibold">
              <td className="py-1.5" colSpan={3}>
                {ym} 합계 (받음−줌)
              </td>
              <td className="text-right">
                <Money n={rows.reduce((s, r) => s + r.amount, 0)} signed />
              </td>
              <td></td>
            </tr>
          </tfoot>
        )}
      </TableWrap>

      <p className="mt-3 text-xs text-slate-400">
        통장 줄은 이름(배운 별명 포함)으로 찾은 것입니다 — 계산서·미지급 화면에서 한 번 이어 두면
        다른 이름의 출금도 여기에 잡힙니다. 계산서·통장의 상태(확인 필요/맞춰짐)는 세금계산서
        대조·입금 정리 화면에서 바꿉니다.
      </p>
    </FinShell>
  );
}
