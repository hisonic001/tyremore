import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession } from "@/lib/auth";
import { pickYm, ymAdd } from "@/lib/ym";
import { CARD_SETTLE_PATTERN_SQL } from "@/lib/expense-cats";
import { FinShell } from "@/components/fin/shell";
import { won } from "@/components/fin/money";
import { TableWrap } from "@/components/fin/table";

export const dynamic = "force-dynamic";

/**
 * ⭐ 카드 매출 대사 (ERP 3단계, 2026-08-24) — 사장님 전용
 *
 *   여신금융협회 「일별 승인내역」과 앱의 카드 판매를 **날짜별 합계**로 견준다
 *   (여신협회 자료가 건별이 아니라 일합계 — 실파일 실측).
 *   차이가 난 날 = 앱에 안 적힌 카드 매출이 있거나, 반대이거나 — 그날만 들춰 보면 된다.
 *   아래엔 카드사별 월 정산(수수료)과 통장 입금 어림 대조.
 *
 * 🔴 질의 순차 — Promise.all 금지.
 */

// 감사 L3: 달 계산은 lib/ym 정본

export default async function FinanceCardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/");

  const sp = await searchParams;
  const ym = pickYm(sp.ym);
  const start = `${ym}-01`;
  const nextStart = `${ymAdd(ym, 1)}-01`;
  /** 앱 판매의 「판 날」 — 리포트와 같은 기준 */
  const D = sql`COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)`;

  // ① 여신협회 일별 승인 (순차)
  const assoc = await db.execute<{ d: string; total: number; cnt: number; cancelled: number }>(sql`
    SELECT to_char(day, 'YYYY-MM-DD') d, total_amount total, total_cnt cnt, cancelled_amount cancelled
    FROM card_day WHERE is_active AND day >= ${start}::date AND day < ${nextStart}::date
    ORDER BY day LIMIT 40
  `);

  // ② 앱의 카드 매출 — 카드 단일 + 혼합의 카드 몫 + 외상 카드 수금 (셋을 날짜별로 합친다)
  const appDan = await db.execute<{ d: string; amt: string }>(sql`
    SELECT to_char(${D}, 'YYYY-MM-DD') d, SUM(q.total_amount)::bigint amt
    FROM quote q WHERE q.status = '성사' AND q.payment_method = '카드'
      AND ${D} >= ${start}::date AND ${D} < ${nextStart}::date
    GROUP BY 1 LIMIT 40
  `);
  const appSplit = await db.execute<{ d: string; amt: string }>(sql`
    SELECT to_char(${D}, 'YYYY-MM-DD') d, SUM(pm.amount)::bigint amt
    FROM quote_payment pm JOIN quote q ON q.id = pm.quote_id
    WHERE q.status = '성사' AND pm.method = '카드'
      AND ${D} >= ${start}::date AND ${D} < ${nextStart}::date
    GROUP BY 1 LIMIT 40
  `);
  const appColl = await db.execute<{ d: string; amt: string }>(sql`
    SELECT to_char(rp.paid_on, 'YYYY-MM-DD') d, SUM(rp.amount)::bigint amt
    FROM receivable_payment rp
    WHERE rp.method = '카드' AND rp.paid_on >= ${start}::date AND rp.paid_on < ${nextStart}::date
    GROUP BY 1 LIMIT 40
  `);

  /* ⭐ 차이 난 날 펼쳐보기 (사장님 승인 2026-08-25) — 그날 카드·혼합 판매와
   *    「차이와 같은 금액」의 다른 수단 판매(수단 착오 후보)를 바로 보여준다 */
  const monthQuotes = await db.execute<{ d: string; quote_no: string; total: number; pm: string | null; who: string | null }>(sql`
    SELECT to_char(${D}, 'YYYY-MM-DD') d, q.quote_no, q.total_amount total, q.payment_method pm,
           COALESCE(q.supplier_name, c.name) who
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id
    WHERE q.status = '성사' AND ${D} >= ${start}::date AND ${D} < ${nextStart}::date
    ORDER BY ${D} ASC LIMIT 1200 -- 감사 M18: 금액순 600 컷이 가짜 ● 누락 표시를 만들었다
  `);

  // 건별 승인 (세부내역이 올라온 달) — 차이 난 날 펼침에 그날 승인 목록까지 (2026-08-25)
  const monthTxns = await db.execute<{
    d: string; t: string; card_co: string; approval_no: string; amount: number; is_cancel: boolean;
  }>(sql`
    SELECT to_char(approved_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') d,
           to_char(approved_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') t,
           card_co, approval_no, amount, is_cancel
    FROM card_txn WHERE is_active
      AND (approved_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
      AND (approved_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date
    ORDER BY approved_at LIMIT 800
  `);

  // ③ 카드사별 월 정산 (여신협회 입금내역)
  const deposits = await db.execute<{ card_co: string; sale_amount: number; vat_agency: number; deposit_amount: number; sale_cnt: number }>(sql`
    SELECT card_co, sale_amount, vat_agency, deposit_amount, sale_cnt
    FROM card_deposit WHERE is_active AND month = ${ym} ORDER BY sale_amount DESC LIMIT 20
  `);

  // ④ 통장에서 카드 정산으로 보이는 입금 (적요 어림 — FB자금·매출표)
  const bankCard = await db.execute<{ s: string; n: number }>(sql`
    SELECT COALESCE(SUM(in_amount), 0)::bigint s, count(*)::int n
    FROM cash_txn
    WHERE source = '통장' AND is_active AND in_amount > 0
      AND ${sql.raw(CARD_SETTLE_PATTERN_SQL)}
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date
  `);

  // 날짜별로 합친다
  const appMap = new Map<string, number>();
  for (const r of [...appDan, ...appSplit, ...appColl]) {
    appMap.set(r.d, (appMap.get(r.d) ?? 0) + Number(r.amt));
  }
  const days = new Map<string, { assoc: number; cnt: number; cancelled: number; app: number }>();
  for (const a of assoc) days.set(a.d, { assoc: Number(a.total), cnt: Number(a.cnt), cancelled: Number(a.cancelled), app: 0 });
  for (const [d, amt] of appMap) {
    const row = days.get(d) ?? { assoc: 0, cnt: 0, cancelled: 0, app: 0 };
    row.app = amt;
    days.set(d, row);
  }
  const dayRows = [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const sumAssoc = dayRows.reduce((s, [, r]) => s + r.assoc, 0);
  const sumApp = dayRows.reduce((s, [, r]) => s + r.app, 0);
  const diffDays = dayRows.filter(([, r]) => r.assoc !== r.app).length;
  const txnsByDay = new Map<string, { t: string; card_co: string; approval_no: string; amount: number; is_cancel: boolean }[]>();
  for (const x of monthTxns) {
    const arr = txnsByDay.get(x.d) ?? [];
    arr.push(x);
    txnsByDay.set(x.d, arr);
  }
  const quotesByDay = new Map<string, { quote_no: string; total: number; pm: string | null; who: string | null }[]>();
  for (const q of monthQuotes) {
    const arr = quotesByDay.get(q.d) ?? [];
    arr.push(q);
    quotesByDay.set(q.d, arr);
  }
  const sumDeposit = deposits.reduce((s, r) => s + Number(r.deposit_amount), 0);
  const sumSale = deposits.reduce((s, r) => s + Number(r.sale_amount), 0);

  return (
    <FinShell tab="card" monthNav={{ ym, basePath: "/finance/card" }}>

      {dayRows.length === 0 ? (
        <section className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          이 달 자료가 없습니다 — 여신금융협회 「일별 승인내역」 엑셀을{" "}
          <Link href="/finance/upload" className="underline">내역 올리기</Link>에서 올려 주세요.
        </section>
      ) : (
        <>
          {/* 요약 */}
          <section className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <p className="text-xs text-slate-500">여신협회 승인합</p>
              <p className="tabular mt-1 font-bold">{won(sumAssoc)}원</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <p className="text-xs text-slate-500">앱 카드 매출합</p>
              <p className="tabular mt-1 font-bold">{won(sumApp)}원</p>
            </div>
            <div className={`rounded-2xl border p-3 ${sumAssoc === sumApp ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
              <p className="text-xs text-slate-500">차이 난 날</p>
              <p className="tabular mt-1 font-bold">{diffDays}일</p>
            </div>
          </section>

          {/* 날짜별 대사 표 */}
          <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold">날짜별 — 여신협회 vs 앱</h2>
            <p className="mt-1 text-xs text-slate-400">
              차이 난 날은 그 날짜의 정비 내역에서 카드 판매를 펼쳐 보세요 — 앱에 안 적힌 카드
              매출(등록 누락)이거나, 앱에는 있는데 승인이 없는 건입니다
            </p>
            <TableWrap minWidth={430}>
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="py-1 text-left">날짜</th>
                  <th className="text-right">여신협회</th>
                  <th className="text-right">앱</th>
                  <th className="text-right">차이</th>
                </tr>
              </thead>
              <tbody>
                {dayRows.map(([d, r]) => {
                  const diff = r.assoc - r.app;
                  return (
                    <tr key={d} className={`border-t border-slate-100 ${diff !== 0 ? "bg-amber-50 font-medium" : ""}`}>
                      <td className="py-1">{d.slice(5)}</td>
                      <td className="text-right">{r.assoc !== 0 ? `${won(r.assoc)}` : <span className="text-slate-300">—</span>}</td>
                      <td className="text-right">{r.app !== 0 ? `${won(r.app)}` : <span className="text-slate-300">—</span>}</td>
                      <td className={`text-right ${diff === 0 ? "text-slate-300" : "text-amber-700"}`}>
                        {diff === 0 ? "✓" : `${diff > 0 ? "+" : ""}${won(diff)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-300 font-semibold">
                  <td className="py-1">합계</td>
                  <td className="text-right">{won(sumAssoc)}</td>
                  <td className="text-right">{won(sumApp)}</td>
                  <td className={`text-right ${sumAssoc === sumApp ? "text-emerald-700" : "text-amber-700"}`}>
                    {sumAssoc === sumApp ? "일치" : won(sumAssoc - sumApp)}
                  </td>
                </tr>
              </tfoot>
            </TableWrap>
          </section>

          {/* ⭐ 차이 난 날 펼쳐보기 — 하루 1분 확인 (사장님 승인 2026-08-25) */}
          {diffDays > 0 && (
            <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="font-semibold">차이 난 날 자세히 보기</h2>
              <p className="mt-1 text-xs text-slate-400">
                빨간 줄(차이와 같은 금액의 다른 수단 판매)이 있으면 그 판매의 결제수단이 잘못
                적혔을 가능성이 큽니다 — 정비 내역의 「날짜·결제 고치기」로 바로잡으세요
              </p>
              <div className="mt-2 space-y-1">
                {dayRows
                  .filter(([, r]) => r.assoc !== r.app)
                  .map(([d, r]) => {
                    const diff = r.assoc - r.app;
                    const dayQ = quotesByDay.get(d) ?? [];
                    const cardQ = dayQ.filter((q) => q.pm === "카드" || q.pm === "혼합");
                    /* 지역화폐(속초상품권)는 두 갈래다 (사장님 설명 2026-08-25):
                       카드 연동형 → 여신협회 승인에 잡힘 / 앱·QR형 → 승인 없이 「속초정산」 입금만.
                       그래서 차이 난 날엔 그날 지역화폐 판매를 같이 보여준다. */
                    const localQ = dayQ.filter((q) => q.pm === "지역화폐");
                    const dayTxns = txnsByDay.get(d) ?? [];
                    // 그날 앱 카드·혼합 판매 금액 집합 — 여신 승인 중 짝 없는 금액에 표시
                    const appAmts = new Set(dayQ.filter((q) => q.pm === "카드" || q.pm === "혼합").map((q) => Number(q.total)));
                    const suspects = dayQ.filter(
                      (q) => q.pm !== "카드" && q.pm !== "혼합" && Number(q.total) === Math.abs(diff),
                    );
                    return (
                      <details key={d} className="rounded-lg border border-slate-200 p-2">
                        <summary className="tabular cursor-pointer text-sm">
                          {d.slice(5)} — 여신 {won(r.assoc)} vs 앱 {won(r.app)}{" "}
                          <span className="font-semibold text-amber-700">
                            ({diff > 0 ? "+" : ""}
                            {won(diff)})
                          </span>
                          {suspects.length > 0 && (
                            <span className="ml-1 text-xs font-semibold text-red-600">수단 착오 후보 있음</span>
                          )}
                        </summary>
                        <div className="tabular mt-2 space-y-0.5 text-xs">
                          {suspects.map((q) => (
                            <p key={q.quote_no} className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">
                              {q.quote_no} · {won(Number(q.total))}원 · {q.pm}
                              {q.who ? ` · ${q.who}` : ""} ← 차이와 같은 금액 — 실제는 카드가 아니었는지
                            </p>
                          ))}
                          {cardQ.length > 0 ? (
                            cardQ.map((q) => (
                              <p key={q.quote_no} className="text-slate-600">
                                {q.quote_no} · {won(Number(q.total))}원 · {q.pm}
                                {q.who ? ` · ${q.who}` : ""}
                              </p>
                            ))
                          ) : (
                            <p className="text-slate-400">그날 앱에 카드 판매가 없습니다 — 통째 누락일 수 있습니다</p>
                          )}
                          {localQ.length > 0 && (
                            <div className="mt-1 border-t border-slate-100 pt-1">
                              <p className="text-sky-700">
                                그날 지역화폐 판매 {localQ.length}건 — 손님이 카드 연동형 상품권으로 냈다면
                                여신협회 승인에 잡혀 차이의 원인일 수 있습니다
                              </p>
                              {localQ.map((q) => (
                                <p key={q.quote_no} className="text-slate-500">
                                  {q.quote_no} · {won(Number(q.total))}원 · 지역화폐{q.who ? ` · ${q.who}` : ""}
                                </p>
                              ))}
                            </div>
                          )}
                          {dayTxns.length > 0 && (
                            <div className="mt-1 border-t border-slate-100 pt-1">
                              <p className="text-slate-400">
                                여신협회 건별 승인 {dayTxns.length}건 — ● 표시는 그날 앱 카드 판매에 같은
                                금액이 없는 승인(등록 누락·수단 착오 후보)
                              </p>
                              {dayTxns.slice(0, 25).map((x, i) => {
                                const orphan = !x.is_cancel && x.amount > 0 && !appAmts.has(x.amount);
                                return (
                                  <p key={i} className={orphan ? "font-medium text-red-700" : "text-slate-500"}>
                                    {orphan ? "● " : ""}
                                    {x.t} · {x.card_co} · {won(x.amount)}원{x.is_cancel ? " (취소)" : ""}
                                  </p>
                                );
                              })}
                              {dayTxns.length > 25 && <p className="text-slate-400">… 외 {dayTxns.length - 25}건</p>}
                            </div>
                          )}
                        </div>
                      </details>
                    );
                  })}
              </div>
            </section>
          )}
        </>
      )}

      {/* 카드사별 월 정산 */}
      {deposits.length > 0 && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">카드사별 정산 ({ym} 매출분)</h2>
          <TableWrap minWidth={430}>
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="py-1 text-left">카드사</th>
                <th className="text-right">매출</th>
                <th className="text-right">입금</th>
                <th className="text-right">수수료(율)</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((r) => {
                const fee = Number(r.sale_amount) - Number(r.vat_agency) - Number(r.deposit_amount);
                const rate = Number(r.sale_amount) > 0 ? ((fee / Number(r.sale_amount)) * 100).toFixed(2) : "0";
                return (
                  <tr key={r.card_co} className="border-t border-slate-100">
                    <td className="py-1">{r.card_co}</td>
                    <td className="text-right">{won(Number(r.sale_amount))}</td>
                    <td className="text-right">{won(Number(r.deposit_amount))}</td>
                    <td className="text-right text-slate-500">
                      {won(fee)} ({rate}%)
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-300 font-semibold">
                <td className="py-1">합계</td>
                <td className="text-right">{won(sumSale)}</td>
                <td className="text-right">{won(sumDeposit)}</td>
                <td className="text-right">{won(sumSale - deposits.reduce((s, r) => s + Number(r.vat_agency), 0) - sumDeposit)}</td>
              </tr>
            </tfoot>
          </TableWrap>
          <p className="tabular mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
            통장에서 카드 정산으로 보이는 입금(적요 FB자금·매출표): {won(Number(bankCard[0]?.s ?? 0))}원 ·{" "}
            {Number(bankCard[0]?.n ?? 0)}건 — 입금은 매출보다 며칠 늦게 들어와 월 경계에서 어긋날 수
            있습니다
          </p>
        </section>
      )}
    </FinShell>
  );
}
