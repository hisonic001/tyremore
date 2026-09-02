import Link from "@/lib/link";
import { notFound, redirect } from "next/navigation";
import { getSession, hasPerm } from "@/lib/auth";
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

/**
 * ⭐ 원천별 소계 (2회차 수리 A1, 2026-08-28)
 *
 * 🔴 **왜 「합계」 한 줄을 없앴나** — 전에는 이 표 맨 아래에
 *    「{ym} 합계 (받음−줌)」 한 줄이 있었고 rows 전부를 그냥 더했다.
 *    그런데 이 표의 줄들은 **한 거래를 네 각도에서 본 기록**이다:
 *      세금계산서 한 장 · 그 물건의 앱 매입 한 건 · 그 돈이 나간 통장 출금 한 줄 ·
 *      그 출금으로 채운 지급 기록 한 줄 — 전부 같은 돈이다.
 *    그걸 더하면 한 번 나간 돈이 두세 번 빠진다.
 *
 *    실측(2026-08-28) 미쉐린 2026-08:
 *      계산서 −1,045,000 + 통장출금 −26,483,202 + 앱매입 −22,316,558 = 화면에 −49,844,760
 *      실제로 8월에 미쉐린으로 나간 돈은 통장 26,483,202원 **한 줄뿐**이다.
 *
 * 🔴 이 파일이 부르는 party-ledger.ts 머리에 이미
 *    "러닝 밸런스 열 없음 — 원천이 이질적이라 복식부기 흉내가 된다 (설계 결정)" 이라고
 *    적혀 있었다. 열만 없애고 **세로 합계는 남아 있어** 같은 실수를 하고 있었다.
 *
 * 그래서 **섞이지 않는 것끼리만** 더해 원천별로 나눠 보여준다.
 */
const SUBTOTALS: { label: string; kinds: LedgerRow["kind"][]; hint: string }[] = [
  { label: "세금계산서", kinds: ["계산서"], hint: "발행된 것" },
  { label: "통장", kinds: ["입금", "출금"], hint: "실제로 오간 돈" },
  { label: "앱 기록", kinds: ["매입", "판매", "지급", "수금"], hint: "앱에 적은 것" },
];

export default async function FinancePartyLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await hasPerm("finance"))) redirect("/"); // 권한 스위치 (2026-09-02)

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
      {/* 🔴 2회차 수리 A2(2026-08-28): 통장 줄을 찾는 이름이 계산서용 이름과 다를 때 밝힌다.
          짧은 상호(예: 「미쉐린」)는 일부러 뺀다 — 「미쉐린로열」 같은 남의 출금까지 끌려와
          위 목록과 아래 월별 지급이 매달 어긋났었다. */}
      {/* 🔴 2회차 수리 A3(2026-08-28): 이름이 짧으면 통장 줄을 적게 찾는다 — 조용히 비면 안 된다.
          전에는 「한국」이 한국전력공사 전기요금까지 끌어와 월별 잔액이 마이너스로 찍혔다. */}
      {data.shortNames.length > 0 && (
        <p className="mt-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs leading-relaxed text-amber-900">
          거래처 이름 「{data.shortNames.join(" · ")}」 이(가) 짧아서, 통장에서는{" "}
          <strong>상대 이름이 통째로 같은 줄만</strong> 찾았습니다 — 「한국」이 「한국전력공사」까지
          끌어오는 것을 막기 위해서입니다. 빠진 출금이 있으면 <strong>미지급 화면에서 한 번 이어
          주시거나</strong>, 거래처 이름을 정식 상호로 바꿔 주세요.
        </p>
      )}
      {data.cashNames.join("|") !== data.names.join("|") && (
        <p className="mt-0.5 text-xs text-slate-400">
          통장 줄은 이 이름으로만 찾았습니다: <strong>{data.cashNames.join(" · ")}</strong>
          <span className="ml-1">— 짧은 상호는 남의 출금이 섞여 일부러 뺐습니다</span>
        </p>
      )}

      {/* 잔액 요약 — 세 숫자는 축이 다르다 (2026 감사 N7): 앱 매입 장부 / 계산서 돈 확인 / 외상 */}
      <section className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Link href={`/finance/payables?ym=${ym}`} className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">앱 매입 장부 미지급</p>
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
        <Link href={`/finance/tax?view=money&ym=${ym}&direction=매입`} className="rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">돈 확인 안 된 계산서 (누적)</p>
          <p className={`tabular mt-1 font-bold ${data.taxOpenSum > 0 ? "text-amber-700" : "text-slate-400"}`}>
            {won(data.taxOpenSum)}원
          </p>
        </Link>
      </section>

      {/* ⭐ 달별 계산서 vs 지급 — 월합계 계산서 상대의 채무 장부 (2026-08-25) */}
      {data.months.length > 0 && (
        <section className="mt-4">
          <h2 className="text-[15px] font-semibold">달별 계산서 · 지급 · 잔액</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            계산서 한 장과 출금 한 건이 1:1로 안 맞는 거래처는 이 표의 <strong>잔액</strong>이 장부입니다.
          </p>
          <TableWrap minWidth={460}>
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="py-1.5 text-left">달</th>
                <th className="text-right">계산서</th>
                <th className="text-right">지급</th>
                <th className="text-right">이 달 차이</th>
                <th className="text-right">누적 잔액</th>
              </tr>
            </thead>
            <tbody>
              {data.months.slice(-14).map((m) => (
                <tr key={m.ym} className={`border-t border-slate-100 ${m.ym === ym ? "bg-brand-50" : ""}`}>
                  <td className="py-1.5 text-xs">{m.ym}</td>
                  <td className="text-right">{m.invSum ? <Money n={m.invSum} /> : <span className="text-slate-300">—</span>}</td>
                  <td className="text-right">{m.paySum ? <Money n={m.paySum} /> : <span className="text-slate-300">—</span>}</td>
                  <td className="text-right"><Money n={m.invSum - m.paySum} signed /></td>
                  <td className={`text-right font-semibold ${m.running > 0 ? "text-red-600" : ""}`}>
                    <Money n={m.running} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-300 text-xs text-slate-500">
                <td className="py-1.5" colSpan={5}>
                  누적 잔액 = 계산서 합 − 통장 지급 합 (＋는 아직 안 준 돈)
                </td>
              </tr>
            </tfoot>
          </TableWrap>
        </section>
      )}

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
            {/* 🔴 원천별로만 더한다 — 왜인지는 위 SUBTOTALS 주석 참고 (2회차 수리 A1) */}
            {SUBTOTALS.map((g) => {
              const mine = rows.filter((r) => g.kinds.includes(r.kind));
              if (mine.length === 0) return null;
              return (
                <tr key={g.label} className="border-t border-slate-200">
                  <td className="py-1.5 text-xs font-semibold" colSpan={3}>
                    {g.label} 소계 <span className="font-normal text-slate-400">· {g.hint} · {mine.length}줄</span>
                  </td>
                  <td className="text-right font-semibold">
                    <Money n={mine.reduce((s, r) => s + r.amount, 0)} signed />
                  </td>
                  <td></td>
                </tr>
              );
            })}
            <tr className="border-t border-slate-300">
              <td className="py-1.5 text-xs leading-relaxed text-slate-500" colSpan={5}>
                🔴 <strong>세 소계를 서로 더하지 마세요.</strong> 계산서 한 장 · 그 물건의 앱 매입 ·
                그 돈이 나간 통장 출금은 <strong>같은 거래를 세 번 적은 것</strong>입니다. 실제로 오간
                돈은 「통장」 소계입니다.
              </td>
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
