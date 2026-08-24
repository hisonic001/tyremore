import Link from "@/lib/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession } from "@/lib/auth";
import { cancelFinUpload } from "@/lib/fin-upload";

export const dynamic = "force-dynamic";

/**
 * ⭐ 돈 관리 — 자금 흐름 (ERP 1단계, 사장님 승인 2026-08-24)
 *
 *   통장·법인카드에서 올린 내역으로 「이번 달 들어온 돈·나간 돈」을 보여준다.
 *   손익(매출·매입과 합친 큰 그림)은 5단계에서 이 화면 위에 올라간다.
 *
 * 🔴 사장님 전용 (reports 와 같은 가드). 질의는 순차 — Promise.all 금지.
 */

const won = (n: number) => n.toLocaleString("ko-KR");

/** 폼에서 부르는 배치 취소 — 폼 액션은 반환값이 없어야 해서 얇게 감싼다 */
async function cancelBatch(id: number, _fd: FormData): Promise<void> {
  "use server";
  await cancelFinUpload(id);
}
const kstToday = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

function ymAdd(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/");

  const thisYm = kstToday().slice(0, 7);
  const sp = await searchParams;
  const ym = typeof sp.ym === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.ym) && sp.ym <= thisYm ? sp.ym : thisYm;
  const start = `${ym}-01`;
  const nextStart = `${ymAdd(ym, 1)}-01`;
  /** 이번 달 조건 — 모든 질의가 글자 그대로 같은 조건을 쓴다 */
  const inMonth = sql`is_active
    AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
    AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date`;

  /* ⭐ 5단계 — 월 손익 재료 (전부 순차). 이중 계산 방지 원칙:
   *    「쓴 돈」= 상품 매입 + 법인카드 + 카드 수수료.
   *    통장 출금은 매입 대금·카드값이 대부분이라 다시 넣지 않는다 — 참고로만 보여준다. */
  const D = sql`COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date)`;
  const earned = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(q.total_amount), 0)::bigint s FROM quote q
    WHERE q.status = '성사' AND ${D} >= ${start}::date AND ${D} < ${nextStart}::date
  `);
  const bought = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(total), 0)::bigint s FROM purchase_invoice
    WHERE status <> '취소' AND total IS NOT NULL
      AND COALESCE(issued_at, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) >= ${start}
      AND COALESCE(issued_at, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) < ${nextStart}
  `);
  const cardFeeRows = await db.execute<{ fee: string }>(sql`
    SELECT COALESCE(SUM(sale_amount - vat_agency - deposit_amount), 0)::bigint fee
    FROM card_deposit WHERE is_active AND month = ${ym}
  `);
  const recvRows = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(q.total_amount - COALESCE(rp.paid, 0)), 0)::bigint s
    FROM quote q
    LEFT JOIN LATERAL (SELECT SUM(amount)::int paid FROM receivable_payment x WHERE x.quote_id = q.id) rp ON true
    WHERE q.status = '성사' AND q.payment_method = '외상' AND q.total_amount > COALESCE(rp.paid, 0)
  `);
  const taxBuyOpenRows = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(total), 0)::bigint s FROM tax_invoice
    WHERE is_active AND direction = '매입' AND recon_status IN ('미대조', '제안')
      AND write_date >= ${start}::date AND write_date < ${nextStart}::date
  `);
  // 계좌끼리 옮긴 돈(내부이체) — 우리 상호가 적힌 입출금은 수입도 지출도 아니다
  const internal = await db.execute<{ o: string }>(sql`
    SELECT COALESCE(SUM(out_amount), 0)::bigint o FROM cash_txn
    WHERE ${inMonth} AND source = '통장' AND description LIKE '%싸이오토모%'
  `);

  // ① 월 요약 — 통장 들어옴/나감, 카드로 쓴 돈 (순차)
  const sums = await db.execute<{ source: string; in_sum: string; out_sum: string }>(sql`
    SELECT source, COALESCE(SUM(in_amount), 0)::bigint in_sum, COALESCE(SUM(out_amount), 0)::bigint out_sum
    FROM cash_txn WHERE ${inMonth} GROUP BY source LIMIT 5
  `);
  const bank = sums.find((s) => s.source === "통장");
  const card = sums.find((s) => s.source === "법인카드");

  // ② 계좌·카드별 이번 달 + 통장 마지막 잔액
  const accounts = await db.execute<{ source: string; l: string; in_sum: string; out_sum: string; n: number }>(sql`
    SELECT source, account_label l, COALESCE(SUM(in_amount),0)::bigint in_sum,
           COALESCE(SUM(out_amount),0)::bigint out_sum, count(*)::int n
    FROM cash_txn WHERE ${inMonth} GROUP BY 1, 2 ORDER BY 1, 2 LIMIT 20
  `);
  const balances = await db.execute<{ l: string; balance: string; at: string }>(sql`
    SELECT DISTINCT ON (account_label) account_label l, balance::bigint,
           to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') at
    FROM cash_txn
    WHERE source = '통장' AND is_active AND balance IS NOT NULL
    ORDER BY account_label, occurred_at DESC, id DESC LIMIT 10
  `);

  // ⭐ 2단계 — 확인 기다리는 세금계산서 (미대조·제안)
  const taxOpenRows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM tax_invoice WHERE is_active AND recon_status IN ('미대조', '제안')
  `);
  const taxOpen = Number(taxOpenRows[0]?.n ?? 0);

  // ③ 최근 올린 파일 (배치)
  const uploads = await db.execute<{
    id: number; source: string; l: string | null; file_name: string;
    row_count: number; new_count: number; dup_count: number; status: string; at: string;
  }>(sql`
    SELECT id, source, account_label l, file_name, row_count, new_count, dup_count, status,
           to_char(created_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at
    FROM fin_upload ORDER BY id DESC LIMIT 10
  `);

  // ④ 이번 달 거래 (최근 60줄)
  const txns = await db.execute<{
    id: number; source: string; l: string; at: string; description: string;
    in_amount: number; out_amount: number;
  }>(sql`
    SELECT id, source, account_label l, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at,
           description, in_amount, out_amount
    FROM cash_txn WHERE ${inMonth}
    ORDER BY occurred_at DESC, id DESC LIMIT 60
  `);

  const gEarned = Number(earned[0].s);
  const gBought = Number(bought[0].s);
  const gCardOut = Number(card?.out_sum ?? 0);
  const gFee = Number(cardFeeRows[0].fee);
  const gSpent = gBought + gCardOut + gFee;
  const gRecv = Number(recvRows[0].s);
  const gTaxBuyOpen = Number(taxBuyOpenRows[0].s);
  const bankOutExt = Math.max(0, Number(bank?.out_sum ?? 0) - Number(internal[0].o));

  const noData = sums.length === 0 && uploads.length === 0;

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-5 pb-24">
      <header className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-bold">돈 관리</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/finance/upload"
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
          >
            내역 올리기
          </Link>
          <Link href="/settings" className="text-sm text-slate-500 underline underline-offset-4">
            설정으로
          </Link>
        </div>
      </header>

      {/* 달 넘기기 — 리포트와 같은 방식 */}
      <nav className="tabular mt-2 flex items-center justify-center gap-4 text-sm">
        <Link href={`/finance?ym=${ymAdd(ym, -1)}`} className="rounded-lg px-3 py-1.5 active:bg-slate-200">
          ◀ {ymAdd(ym, -1)}
        </Link>
        <span className="font-bold">{ym}</span>
        {ym < thisYm ? (
          <Link href={`/finance?ym=${ymAdd(ym, 1)}`} className="rounded-lg px-3 py-1.5 active:bg-slate-200">
            {ymAdd(ym, 1)} ▶
          </Link>
        ) : (
          <span className="px-3 py-1.5 text-slate-300">다음 달</span>
        )}
      </nav>

      {/* ── 월 손익 (5단계) — 회계어 없이, 이중 계산 없이 ── */}
      <section className="mt-4 rounded-2xl border-2 border-slate-800 bg-white p-4">
        <h2 className="font-bold">{ym} 손익</h2>
        <div className="tabular mt-2 space-y-1 text-sm">
          <p className="flex justify-between">
            <span>번 돈 (판매)</span>
            <strong className="text-emerald-700">{won(gEarned)}원</strong>
          </p>
          <p className="flex justify-between">
            <span>쓴 돈</span>
            <strong className="text-red-600">{won(gSpent)}원</strong>
          </p>
          <p className="flex justify-between pl-3 text-xs text-slate-500">
            <span>· 상품 매입</span>
            <span>{won(gBought)}원</span>
          </p>
          <p className="flex justify-between pl-3 text-xs text-slate-500">
            <span>· 법인카드로 쓴 돈</span>
            <span>{won(gCardOut)}원</span>
          </p>
          <p className="flex justify-between pl-3 text-xs text-slate-500">
            <span>· 카드 수수료</span>
            <span>{won(gFee)}원</span>
          </p>
          <p className="flex justify-between border-t border-slate-200 pt-1 text-base font-bold">
            <span>남은 돈</span>
            <span className={gEarned - gSpent >= 0 ? "text-emerald-700" : "text-red-600"}>
              {won(gEarned - gSpent)}원
            </span>
          </p>
        </div>
        <div className="tabular mt-3 space-y-0.5 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
          <p>받을 돈 (외상 잔액 전체): {won(gRecv)}원</p>
          {gTaxBuyOpen > 0 && (
            <p>
              이 달 매입 세금계산서 중 대조 안 됨: {won(gTaxBuyOpen)}원 —{" "}
              <Link href="/finance/tax" className="underline">세금계산서 대조</Link>에서 확인
            </p>
          )}
          {bankOutExt > 0 && (
            <p>
              통장 출금(계좌끼리 옮긴 돈 제외): {won(bankOutExt)}원 — 매입 대금·카드값이 대부분이라
              「쓴 돈」에 다시 넣지 않습니다 (이중 계산 방지)
            </p>
          )}
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          임차료·인건비처럼 통장으로만 나가는 지출은 아직 「쓴 돈」에 없습니다 — 다음 단계(경비
          분류)를 붙이면 정확해집니다
        </p>
      </section>

      {noData && (
        <section className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          아직 올린 내역이 없습니다 — <Link href="/finance/upload" className="underline">내역 올리기</Link>에서
          통장·법인카드 엑셀을 올려 주세요.
        </section>
      )}

      {/* ── 이번 달 요약 ── */}
      {!noData && (
        <section className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center">
            <p className="text-xs text-slate-500">통장에 들어온 돈</p>
            <p className="tabular mt-1 font-bold text-emerald-700">{won(Number(bank?.in_sum ?? 0))}원</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center">
            <p className="text-xs text-slate-500">통장에서 나간 돈</p>
            <p className="tabular mt-1 font-bold text-red-600">{won(Number(bank?.out_sum ?? 0))}원</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center">
            <p className="text-xs text-slate-500">카드로 쓴 돈</p>
            <p className="tabular mt-1 font-bold text-red-600">{won(Number(card?.out_sum ?? 0))}원</p>
          </div>
        </section>
      )}

      {/* ── 세금계산서 대조 바로가기 (2단계) ── */}
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
        <Link href="/finance/tax" className="flex items-center justify-between">
          <span className="font-semibold">세금계산서 대조</span>
          <span className={`text-sm ${taxOpen > 0 ? "font-semibold text-amber-700" : "text-slate-500"}`}>
            {taxOpen > 0 ? `확인할 것 ${taxOpen}건 →` : "열어 보기 →"}
          </span>
        </Link>
      </section>

      {/* ── 카드 매출 대사 바로가기 (3단계) ── */}
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
        <Link href="/finance/card" className="flex items-center justify-between">
          <span className="font-semibold">카드 매출 대사</span>
          <span className="text-sm text-slate-500">여신협회 승인 vs 앱 · 수수료 →</span>
        </Link>
      </section>

      {/* ── 통장 입금 대조 바로가기 (4단계) ── */}
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
        <Link href="/finance/deposits" className="flex items-center justify-between">
          <span className="font-semibold">통장 입금 대조</span>
          <span className="text-sm text-slate-500">카드 정산·이체 판매·외상 수금 정리 →</span>
        </Link>
      </section>

      {/* ── 계좌·카드별 ── */}
      {accounts.length > 0 && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">계좌·카드별 ({ym})</h2>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {accounts.map((a) => {
              const bal = a.source === "통장" ? balances.find((b) => b.l === a.l) : null;
              return (
                <li key={`${a.source}|${a.l}`} className="flex items-baseline justify-between py-1.5">
                  <span>
                    <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{a.source}</span>
                    {a.l} <span className="text-xs text-slate-400">{a.n}건</span>
                  </span>
                  <span className="tabular text-right">
                    {Number(a.in_sum) !== 0 && <span className="text-emerald-700">+{won(Number(a.in_sum))} </span>}
                    {Number(a.out_sum) !== 0 && <span className="text-red-600">−{won(Number(a.out_sum))}</span>}
                    {bal && (
                      <span className="ml-2 text-xs text-slate-500">
                        잔액 {won(Number(bal.balance))}원 ({bal.at})
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── 올린 파일 ── */}
      {uploads.length > 0 && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">올린 파일</h2>
          <p className="mt-1 text-xs text-slate-400">
            취소하면 그 파일이 새로 넣은 줄만 잠재웁니다 — 같은 파일을 다시 올리면 되살아납니다
          </p>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {uploads.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0">
                  <span className="tabular text-xs text-slate-400">{u.at}</span>{" "}
                  <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{u.source}</span>
                  <span className="break-all text-xs">{u.l ? `${u.l} · ` : ""}{u.file_name}</span>
                  <span className="tabular ml-1 text-xs text-slate-500">
                    새 {u.new_count} · 중복 {u.dup_count}
                  </span>
                </span>
                {u.status === "취소" ? (
                  <span className="shrink-0 text-xs text-slate-400">취소됨</span>
                ) : (
                  <form action={cancelBatch.bind(null, Number(u.id))}>
                    <button type="submit" className="shrink-0 text-xs text-slate-400 underline">
                      취소
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── 이번 달 거래 ── */}
      {txns.length > 0 && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">
            {ym} 거래 <span className="text-sm font-normal text-slate-400">최근 {txns.length}줄</span>
          </h2>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {txns.map((t) => (
              <li key={t.id} className="flex items-baseline justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate">
                  <span className="tabular text-xs text-slate-400">{t.at}</span>{" "}
                  <span className="text-xs text-slate-400">{t.source === "법인카드" ? "💳" : "🏦"}</span>{" "}
                  {t.description}
                </span>
                <span className="tabular shrink-0">
                  {t.in_amount !== 0 && <span className="text-emerald-700">+{won(t.in_amount)}원</span>}
                  {t.out_amount !== 0 && <span className="text-red-600">−{won(t.out_amount)}원</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
