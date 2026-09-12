import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, hasPerm } from "@/lib/auth";
import { pickYm, ymAdd } from "@/lib/ym";
import { CARD_SETTLE_PATTERN_SQL } from "@/lib/expense-cats";
import { FinShell } from "@/components/fin/shell";
import { won } from "@/components/fin/money";
import { TableWrap } from "@/components/fin/table";
import { cardDaySums, cardDiff } from "@/lib/card-recon";
import { posDayData, WORK_DAY, PAID_DAY } from "@/lib/pos-close";
import { kstToday } from "@/lib/ym";
import { W } from "@/lib/fin-words";
import { PosCloseUi } from "./pos-close-ui";

export const dynamic = "force-dynamic";

/**
 * ⭐ 카드 매출 대조 (ERP 3단계, 2026-08-24) — 사장님 전용
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
  if (!(await hasPerm("finance"))) redirect("/"); // 권한 스위치 (2026-09-02)

  const sp = await searchParams;
  const ym = pickYm(sp.ym);
  // ⭐ 카드 일마감 날짜 — ?d=, 없으면 오늘(보는 달이 이번 달이면) / 그 달 말일
  const today = kstToday();
  const dRaw = typeof sp.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : null;
  const day = dRaw ?? (ym === today.slice(0, 7) ? today : `${ym}-${String(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`);
  const pos = await posDayData(day);
  const start = `${ym}-01`;
  const nextStart = `${ymAdd(ym, 1)}-01`;
  /** 앱 판매의 「판 날」 — 리포트와 같은 기준. 정본 조각은 pos-close.ts (2026-09-12) */
  const D = WORK_DAY;

  // ①② 여신협회 일별 승인 vs 앱 카드 매출 — 정본 함수 (현황·마감 체크리스트와 같은 식, 2026 감사 R4)
  const cd = await cardDaySums(ym);

  /* ⭐ 차이 난 날 펼쳐보기 (사장님 승인 2026-08-25) — 그날 카드·혼합 판매와
   *    「차이와 같은 금액」의 다른 수단 판매(수단 착오 후보)를 바로 보여준다
   * ⭐ 혼합(분할) 판매는 판매 한 줄이 아니라 **결제 줄마다 받은 날로** 싣는다 (2026-09-12).
   *    이틀에 걸친 카드(권미선 9/10 두 장 + 9/12 잔금)를 작업일 한 줄로 실으면 9/10 펼침 합이
   *    정본(cardDaySums, paid_on 기준)보다 20만원 크고 9/12 펼침엔 판매가 없다. 그래서 혼합은
   *    본 질의에서 빼고 결제 줄로 대신 넣는다 — 둘 다 넣으면 이중이다. */
  const monthQuotes = await db.execute<{ d: string; quote_no: string; total: number; pm: string | null; who: string | null; split: boolean }>(sql`
    SELECT to_char(${D}, 'YYYY-MM-DD') d, q.quote_no, q.total_amount total, q.payment_method pm,
           COALESCE(q.supplier_name, c.name) who, false split
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id
    WHERE q.status = '성사' AND q.payment_method <> '혼합'
      AND ${D} >= ${start}::date AND ${D} < ${nextStart}::date
    UNION ALL
    SELECT to_char(${PAID_DAY}, 'YYYY-MM-DD') d, q.quote_no, pm.amount total, pm.method pm,
           COALESCE(q.supplier_name, c.name) who, true split
    FROM quote_payment pm JOIN quote q ON q.id = pm.quote_id LEFT JOIN customer c ON c.id = q.customer_id
    WHERE q.status = '성사' AND q.payment_method = '혼합' AND pm.amount > 0
      AND ${PAID_DAY} >= ${start}::date AND ${PAID_DAY} < ${nextStart}::date
    ORDER BY d ASC LIMIT 1200 -- 감사 M18: 금액순 600 컷이 가짜 ● 누락 표시를 만들었다
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

  /* ⭐ 감사 D3(2026-08-25): 지역화폐 두 갈래 병기 — 카드 연동형은 여신 승인에 섞이고,
     앱·QR형은 「속초정산」 입금으로만 온다. 차이 해석의 힌트로 요약에 보여준다 */
  const localSale = await db.execute<{ s: string; n: number }>(sql`
    SELECT COALESCE(SUM(q.total_amount), 0)::bigint s, count(*)::int n FROM quote q
    WHERE q.status = '성사' AND q.payment_method = '지역화폐'
      AND ${D} >= ${start}::date AND ${D} < ${nextStart}::date
  `);
  const sokcho = await db.execute<{ s: string; n: number }>(sql`
    SELECT COALESCE(SUM(in_amount), 0)::bigint s, count(*)::int n FROM cash_txn
    WHERE source = '통장' AND is_active AND in_amount > 0 AND description LIKE '%속초정산%'
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date
  `);

  const { dayRows, sumAssoc, sumPos, sumApp, diffDays, assocLast, afterCutoffDays, afterCutoffApp, easyDays, easyApp, easyPos } = cd;
  /* 🔴 2026 감사 R4: 견줄 자료가 없는 날의 앱 매출은 「차이」가 아니라 「비교 불가」 —
        8/24~26 569만원이 빨간 차이로 보이던 것.
     🔴 2026-08-29: 판정은 card-recon 의 base 하나로 한다. 전엔 화면이 따로 재서
        POS 로만 채워진 날의 집계와 회색 처리가 어긋났다. */
  const txnsByDay = new Map<string, { t: string; card_co: string; approval_no: string; amount: number; is_cancel: boolean }[]>();
  for (const x of monthTxns) {
    const arr = txnsByDay.get(x.d) ?? [];
    arr.push(x);
    txnsByDay.set(x.d, arr);
  }
  const quotesByDay = new Map<string, { quote_no: string; total: number; pm: string | null; who: string | null; split: boolean }[]>();
  for (const q of monthQuotes) {
    const arr = quotesByDay.get(q.d) ?? [];
    arr.push(q);
    quotesByDay.set(q.d, arr);
  }
  const sumDeposit = deposits.reduce((s, r) => s + Number(r.deposit_amount), 0);
  const sumSale = deposits.reduce((s, r) => s + Number(r.sale_amount), 0);

  return (
    <FinShell tab="card" monthNav={{ ym, basePath: "/finance/card" }}>
      {/* ⭐ 카드 일마감 (사장님 요청 2026-08-26) — 토스 포스 매출리포트 ↔ 앱 판매 */}
      <PosCloseUi data={pos} />

      <h2 className="mt-6 text-lg font-bold">{W.reconCard} (달)</h2>
      <p className="mt-1 text-sm text-slate-500">
        세 자료를 <strong>날짜별로 나란히</strong> 봅니다 — 여신협회 승인(카드사가 승인한 금액) · 토스POS 결제(실제로
        긁힌 돈) · 앱에 적은 판매. 차이 난 날만 열어 보면 됩니다.
      </p>
      {easyDays > 0 && (
        <p className="tabular mt-2 rounded-lg bg-violet-50 p-2 text-xs text-violet-900">
          이 달 간편결제: POS {won(easyPos)}원 · 앱 {won(easyApp)}원 ({easyDays}일) —
          <strong> 간편결제(QR·네이버페이·카카오페이·토스페이)는 여신협회 승인에 안 잡힙니다.</strong>{" "}
          그만큼 여신 열이 POS·앱보다 작은 것이 정상입니다. 그래서 차이는 <strong>POS 기준</strong>으로 잽니다.
        </p>
      )}
      {afterCutoffDays > 0 && (
        <p className="tabular mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
          {assocLast ? `여신협회 자료가 ${assocLast.slice(5)}까지입니다 — ` : ""}
          {afterCutoffDays}일(앱 매출 {won(afterCutoffApp)}원)은 여신도 POS 자료도 없어 비교할 수 없습니다(회색).
          매출리포트나 여신 자료가 오면{" "}
          <Link href={`/finance/upload?ym=${ym}`} className="underline">올리기</Link>에서 올려 주세요.
        </p>
      )}
      {dayRows.length > 0 && deposits.length === 0 && (
        <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-500">
          이 달 카드사 정산(입금) 자료가 아직 없습니다 — 수수료는 평균 요율로 추정해 손익에 넣습니다.
        </p>
      )}

      {dayRows.length === 0 ? (
        <section className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          이 달 자료가 없습니다 — 여신금융협회 「일별 승인내역」 엑셀을{" "}
          <Link href="/finance/upload" className="underline">내역 올리기</Link>에서 올려 주세요.
        </section>
      ) : (
        <>
          {/* 요약 */}
          <section className="mt-4 grid grid-cols-2 gap-2 text-center lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <p className="text-xs text-slate-500">여신협회 승인합</p>
              <p className="tabular mt-1 font-bold">{won(sumAssoc)}원</p>
              <p className="text-[11px] text-slate-400">간편결제 빠짐</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <p className="text-xs text-slate-500">토스POS 결제합</p>
              <p className="tabular mt-1 font-bold">{won(sumPos)}원</p>
              <p className="text-[11px] text-slate-400">카드 + 간편결제</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <p className="text-xs text-slate-500">앱 매출합</p>
              <p className="tabular mt-1 font-bold">{won(sumApp)}원</p>
              <p className="text-[11px] text-slate-400">카드 + 간편결제</p>
            </div>
            <div className={`rounded-2xl border p-3 ${diffDays === 0 ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
              <p className="text-xs text-slate-500">차이 난 날</p>
              <p className="tabular mt-1 font-bold">{diffDays}일</p>
              <p className="text-[11px] text-slate-400">POS 기준</p>
            </div>
          </section>

          {/* 날짜별 대조 표 */}
          <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold">날짜별 — 여신협회 · 토스POS · 앱</h2>
            <p className="mt-1 text-xs text-slate-400">
              차이 난 날은 날짜를 눌러 그 날 일마감을 여세요 — 앱에 안 적힌 결제(등록 누락)이거나,
              앱에는 있는데 POS에 없는 건입니다
            </p>
            {(Number(localSale[0]?.n ?? 0) > 0 || Number(sokcho[0]?.n ?? 0) > 0) && (
              <p className="tabular mt-1 rounded-lg bg-sky-50 p-2 text-xs text-sky-900">
                이 달 지역화폐: 앱 판매 {won(Number(localSale[0]?.s ?? 0))}원 ({Number(localSale[0]?.n ?? 0)}건) ·
                속초정산 입금 {won(Number(sokcho[0]?.s ?? 0))}원 ({Number(sokcho[0]?.n ?? 0)}건) —
                카드 연동형은 여신 승인에 섞이고 앱·QR형은 정산 입금으로만 옵니다 (차이 해석의 힌트)
              </p>
            )}
            <TableWrap minWidth={520}>
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="py-1 text-left">날짜</th>
                  <th className="text-right">여신협회</th>
                  <th className="text-right">토스POS</th>
                  <th className="text-right">앱</th>
                  <th className="text-right">차이</th>
                </tr>
              </thead>
              <tbody>
                {dayRows.map(([d, r]) => {
                  const diff = cardDiff(r);
                  const cmp = diff !== null;
                  return (
                    <tr
                      key={d}
                      className={`border-t border-slate-100 ${!cmp ? "text-slate-400" : diff !== 0 ? "bg-amber-50 font-medium" : ""}`}
                    >
                      <td className="py-1">
                        <Link href={`/finance/card?ym=${ym}&d=${d}`} className="underline-offset-2 hover:underline">{d.slice(5)}</Link>
                        {r.base === "POS" && <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-800">POS 기준</span>}
                      </td>
                      <td className="text-right">{r.assoc !== null ? won(r.assoc) : <span className="text-slate-300">—</span>}</td>
                      <td className="text-right">
                        {r.pos !== null ? won(r.pos) : <span className="text-slate-300">—</span>}
                        {r.posEasy !== 0 && <span className="block text-[10px] text-violet-700">간편 {won(r.posEasy)}</span>}
                      </td>
                      <td className="text-right">
                        {r.app !== 0 ? won(r.app) : <span className="text-slate-300">—</span>}
                        {r.appEasy !== 0 && <span className="block text-[10px] text-violet-700">간편 {won(r.appEasy)}</span>}
                      </td>
                      <td className={`text-right ${!cmp ? "text-slate-300" : diff === 0 ? "text-slate-300" : "text-amber-700"}`}>
                        {!cmp ? "자료 없음" : diff === 0 ? "✓" : `${diff > 0 ? "+" : ""}${won(diff)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-300 font-semibold">
                  <td className="py-1">합계</td>
                  <td className="text-right">{won(sumAssoc)}</td>
                  <td className="text-right">{won(sumPos)}</td>
                  <td className="text-right">{won(sumApp)}</td>
                  <td className={`text-right ${sumPos === sumApp ? "text-emerald-700" : "text-amber-700"}`}>
                    {sumPos === sumApp ? "일치" : won(sumPos - sumApp)}
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
                  .filter(([, r]) => (cardDiff(r) ?? 0) !== 0)
                  .map(([d, r]) => {
                    const diff = cardDiff(r) ?? 0;
                    const dayQ = quotesByDay.get(d) ?? [];
                    const cardQ = dayQ.filter((q) => q.pm === "카드" || q.pm === "간편결제" || q.pm === "혼합");
                    /* 지역화폐(속초상품권)는 두 갈래다 (사장님 설명 2026-08-25):
                       카드 연동형 → 여신협회 승인에 잡힘 / 앱·QR형 → 승인 없이 「속초정산」 입금만.
                       그래서 차이 난 날엔 그날 지역화폐 판매를 같이 보여준다. */
                    const localQ = dayQ.filter((q) => q.pm === "지역화폐");
                    const dayTxns = txnsByDay.get(d) ?? [];
                    // 그날 앱 카드·간편·혼합 판매 금액 집합 — 여신 승인 중 짝 없는 금액에 표시
                    const appAmts = new Set(cardQ.map((q) => Number(q.total)));
                    const suspects = dayQ.filter(
                      (q) => q.pm !== "카드" && q.pm !== "간편결제" && q.pm !== "혼합" && Number(q.total) === Math.abs(diff),
                    );
                    return (
                      <details key={d} className="rounded-lg border border-slate-200 p-2">
                        <summary className="tabular cursor-pointer text-sm">
                          {d.slice(5)} — {r.base === "POS" ? "POS" : "여신"}{" "}
                          {won(r.base === "POS" ? (r.pos ?? 0) : (r.assoc ?? 0))} vs 앱 {won(r.app)}{" "}
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
                            cardQ.map((q, i) => (
                              <p key={`${q.quote_no}-${i}`} className="text-slate-600">
                                {q.quote_no} · {won(Number(q.total))}원 · {q.pm}
                                {q.split ? " (분할)" : ""}
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
