/**
 * ⭐ 할 일 인박스 정본 — 모든 미확인을 상대별로 묶는다 (돈관리 근본책 2단계, 2026-08-31)
 *
 *   지금까지 홈은 종류별 건수(입금 N·지출 N…)만 보여줘서 "누구 건인지"는 화면 여섯 개를
 *   돌아야 알았다. 사장님의 일은 상대별로 일어난다(미광전력 사건) — 여기서 네 원천의
 *   **항목**을 상대로 묶는다:
 *
 *     · 미확인 입금            ← depositReconData(ym).open   (정본 재사용)
 *     · 계좌이체 판매 미연결    ← self-audit A1 과 같은 질의 + money-trace 의 후보 규칙
 *     · 매입대금 출금 미연결    ← payLinkData(ym).rows        (정본 재사용)
 *     · 계산서 돈 확인 대기     ← taxCashData(방향, ym).rows  (정본 재사용, 상대별 요약)
 *
 *   미분류 지출은 상대 카드가 아니라 「상대를 모르는 조각」 요약으로 —
 *   쿠팡·식당 같은 경비 상대는 원장 상대가 아니다.
 *
 *   그 자리 처리는 **확실한 것만** (1단계 원칙): 후보 유일한 판매↔입금 잇기,
 *   제안이 있는 지급 잡기. 판단이 필요한 것은 전문 화면 딥링크.
 *
 * 🔴 "use server" 아님 — 조회 전용. 판정 재작성 금지(정본 함수 조립만). 질의 순차 · LIMIT.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { monthRange } from "./ym";
import { depositReconData, payLinkData, normName } from "./recon-data";
import { taxCashData } from "./tax-recon";
import { payerKeyOf } from "./expense-cats";

export interface InboxEntry {
  text: string;
  tone: "warn" | "info";
  /** 전문 화면 딥링크 */
  href: string | null;
  /** ⚡ 판매 ↔ 입금 잇기 (후보 유일) — trace-actions.traceLinkDeposit */
  linkDeposit?: { cashTxnId: number; quoteId: number; label: string };
  /** 지급 잡기 — purchase-pay.payFromWithdrawal */
  payFrom?: { cashTxnId: number; supplier: string; label: string };
}

export interface InboxGroup {
  key: string;
  label: string;
  /** 원장 링크 (별명으로 상대를 알 때만) */
  partyHref: string | null;
  entries: InboxEntry[];
}

export interface FinInbox {
  groups: InboxGroup[];
  /** 20 그룹 넘어 못 보여준 것 */
  moreGroups: number;
  /** 상대를 모르는 조각 요약 */
  expenseNote: string | null;
}

const won = (n: number) => Number(n).toLocaleString("ko-KR");

export async function finInbox(ym: string): Promise<FinInbox> {
  const { start, nextStart } = monthRange(ym);

  /* ── 상대 귀속 재료 — 별명 사전 (payables-view 의 resolve 와 같은 꼴) ── */
  const aliases = await db.execute<{ alias_key: string; party_key: string; party_label: string }>(sql`
    SELECT alias_key, party_key, party_label FROM party_alias
  `);
  const aliasMap = new Map(aliases.map((a) => [a.alias_key, { key: a.party_key, label: a.party_label }]));

  const groups = new Map<string, InboxGroup>();
  const put = (rawName: string, entry: InboxEntry) => {
    const hit = aliasMap.get(normName(rawName));
    const key = hit ? hit.key : `N:${normName(rawName)}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        label: hit ? hit.label.replace(/^(거래처|고객) /, "") : rawName === "?" ? "상대 미상" : rawName,
        partyHref: hit && (hit.key.startsWith("S:") || hit.key.startsWith("C:"))
          ? `/finance/party/${encodeURIComponent(hit.key)}`
          : null,
        entries: [],
      };
      groups.set(key, g);
    }
    g.entries.push(entry);
  };

  /* ── ① 미확인 입금 (정본) ── */
  const dep = await depositReconData(ym);
  for (const s of dep.open) {
    const one = s.quotes.length === 1 ? s.quotes[0] : null;
    put(s.dep.payerName, {
      text: `입금 ${won(s.dep.amount)}원 (${s.dep.date.slice(5)}) 미확인${s.taxHint ? ` — ${s.taxHint}` : ""}`,
      tone: "warn",
      href: `/finance/deposits?ym=${ym}`,
      linkDeposit: one ? { cashTxnId: s.dep.id, quoteId: one.quoteId, label: `판매 「${one.label}」와 잇기` } : undefined,
    });
  }

  /* ── ② 계좌이체 판매 미연결 (self-audit A1 과 같은 질의) ── */
  const a1 = await db.execute<{ id: number; quote_no: string; d: string; total: number; who: string }>(sql`
    SELECT q.id, q.quote_no, to_char(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date), 'YYYY-MM-DD') d,
           q.total_amount total, COALESCE(q.supplier_name, c.name, '?') who
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id
    WHERE q.status = '성사' AND q.payment_method IN ('계좌이체', '혼합') AND q.total_amount > 0
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${start}::date
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${nextStart}::date
      AND NOT EXISTS (SELECT 1 FROM recon_match m
        WHERE m.kind = '이체입금' AND m.ref_table = 'quote' AND m.ref_id = q.id)
    ORDER BY 3 DESC LIMIT 60
  `);
  for (const r of a1) {
    // 후보 입금 — money-trace 와 같은 규칙 (금액 정확·미사용·−3~+5일)
    const cand = await db.execute<{ id: number; d: string; description: string }>(sql`
      SELECT x.id, to_char(x.occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') d, x.description
      FROM cash_txn x
      WHERE x.source = '통장' AND x.is_active AND x.in_amount = ${Number(r.total)}
        AND x.recon_status IN ('미대조', '제안') AND x.category IS NULL
        AND (x.occurred_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN ${r.d}::date - 3 AND ${r.d}::date + 5
      LIMIT 2
    `);
    put(r.who, {
      text: `계좌이체 판매 ${won(Number(r.total))}원 (${r.d.slice(5)} ${r.quote_no}) — 입금과 안 이어짐${cand.length === 0 ? " · 동액 입금 없음(미수·현금?)" : ""}`,
      tone: "warn",
      href: `/finance/trace?q=${encodeURIComponent(r.who)}`,
      linkDeposit:
        cand.length === 1
          ? { cashTxnId: Number(cand[0].id), quoteId: Number(r.id), label: `${cand[0].d} 입금 「${payerKeyOf("통장", cand[0].description)}」와 잇기` }
          : undefined,
    });
  }

  /* ── ③ 매입대금 출금 미연결 (정본) ── */
  const pay = await payLinkData(ym);
  for (const r of pay.rows) {
    put(r.payer, {
      text: `매입대금 출금 ${won(r.amount)}원 (${r.at}) 안 이어짐`,
      tone: "warn",
      href: `/finance/payables?ym=${ym}`,
      payFrom: r.suggest
        ? { cashTxnId: r.id, supplier: r.suggest.supplier, label: `${r.suggest.supplier} 지급으로 잇기` }
        : undefined,
    });
  }

  /* ── ④ 계산서 돈 확인 대기 (정본, 상대별 요약) ── */
  for (const dir of ["매입", "매출"] as const) {
    const t = await taxCashData(dir, ym);
    const byName = new Map<string, { n: number; sum: number }>();
    for (const row of t.rows) {
      if (row.isFix || row.fixFirst) continue; // 수정 계산서는 「계산서 정리」 몫
      const cur = byName.get(row.name) ?? { n: 0, sum: 0 };
      cur.n++;
      cur.sum += Number(row.total) - Number(row.bankCovered);
      byName.set(row.name, cur);
    }
    for (const [name, v] of byName) {
      put(name, {
        text: `${dir} 계산서 ${v.n}장 · ${won(v.sum)}원 돈 확인 대기`,
        tone: "info",
        href: `/finance/tax?view=money&ym=${ym}&direction=${dir}`,
      });
    }
  }

  /* ── 미분류 지출 — 상대 카드가 아니라 요약 한 줄 ── */
  const exp = await db.execute<{ payer: string; n: number }>(sql`
    SELECT ${sql.raw("CASE WHEN source = '통장' THEN COALESCE(NULLIF(btrim(regexp_replace(description, '^\\[[^\\]]*\\]\\s*', '')), ''), description) ELSE description END")} payer,
           count(*)::int n
    FROM cash_txn
    WHERE is_active AND out_amount > 0 AND category IS NULL
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date
    GROUP BY 1 ORDER BY 2 DESC LIMIT 6
  `);
  const expTotal = exp.reduce((s, r) => s + Number(r.n), 0);
  const expenseNote =
    exp.length > 0
      ? `미분류 지출 — ${exp.slice(0, 4).map((r) => `${r.payer.trim()} ${r.n}건`).join(" · ")}${exp.length > 4 ? " 외" : ""}`
      : null;
  void expTotal;

  /* ── 정렬·상한 ── */
  const all = [...groups.values()].sort((a, b) => b.entries.length - a.entries.length);
  return {
    groups: all.slice(0, 20),
    moreGroups: Math.max(0, all.length - 20),
    expenseNote,
  };
}
