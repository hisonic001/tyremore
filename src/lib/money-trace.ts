/**
 * ⭐ 돈 추적 정본 — "이 돈 어디 갔어?"를 앱이 대답한다 (돈관리 근본책 1단계-A, 2026-08-31)
 *
 *   사장님이 이름 한 조각(「미광」·「정미선」)이나 금액(「280000」)만 넣으면,
 *   세 장부(판매/수금 · 세금계산서 · 통장/카드)에서 걸리는 조각을 전부 찾아
 *   시간순으로 늘어놓고, 조각마다 **연결 상태와 「왜」**를 붙인다.
 *
 *   이름은 별명 사전(party_alias)으로 넓혀 찾는다 — 「미광」을 치면 별명으로 배운
 *   「정미선」 입금까지 같이 나온다 (2026-08-31 미광전력 사건이 이 화면의 존재 이유).
 *
 * 🔴 "use server" 아님 — 조회 전용. 질의 순차 · LIMIT 각 30.
 *    상태 판정은 각 화면 정본과 같은 자료(recon_match·recon_status·사유)를 읽는다 —
 *    새 판정을 만들지 않는다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

export interface TraceRow {
  key: string;
  /** YYYY-MM-DD */
  d: string;
  kind: "판매" | "매출계산서" | "매입계산서" | "입금" | "출금" | "카드";
  title: string;
  amount: number;
  status: { tone: "ok" | "warn" | "info"; text: string };
  notes: string[];
  /** 그 자리에서 이을 수 있는 것 (판매 ↔ 입금, 후보가 하나뿐일 때만) */
  action?: { cashTxnId: number; quoteId: number; label: string };
}

const won = (n: number) => Number(n).toLocaleString("ko-KR");

export async function traceMoney(qRaw: string): Promise<{ rows: TraceRow[]; hint: string | null }> {
  const q = qRaw.trim();
  if (q.length < 2) return { rows: [], hint: "이름 두 글자나 금액을 넣어 주세요" };
  const amt = /^[\d,]+$/.test(q) ? Number(q.replace(/,/g, "")) : null;
  const like = "%" + q.replace(/\s/g, "%") + "%";

  /* ── 별명으로 이름 넓히기 — 「미광」 → 정미선, 「정미선」 → 미광전력 ── */
  const aliases = await db.execute<{ alias_raw: string; party_key: string; party_label: string }>(sql`
    SELECT alias_raw, party_key, party_label FROM party_alias
    WHERE alias_raw ILIKE ${like} OR party_label ILIKE ${like} LIMIT 20
  `);
  const nameLikes = [...new Set([like, ...aliases.map((a) => "%" + a.alias_raw + "%"), ...aliases.map((a) => "%" + a.party_label.replace(/^(거래처|고객) /, "") + "%")])].slice(0, 8);
  const custIds = aliases.filter((a) => a.party_key.startsWith("C:")).map((a) => Number(a.party_key.slice(2)));
  const supNames = aliases.filter((a) => a.party_key.startsWith("S:")).map((a) => a.party_key.slice(2));
  const nameCond = (col: ReturnType<typeof sql.raw>) =>
    sql.join(nameLikes.map((n) => sql`${col} ILIKE ${n}`), sql` OR `);

  const rows: TraceRow[] = [];

  /* ── ① 판매 (성사) ── */
  const quotes = await db.execute<{
    id: number; quote_no: string; d: string; total: number; who: string; method: string | null;
    dep_linked: string; dep_who: string | null; tax_ids: string | null; tax_cashok: number;
  }>(sql`
    SELECT q.id, q.quote_no,
           to_char(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date), 'YYYY-MM-DD') d,
           q.total_amount total, COALESCE(q.supplier_name, c.name, '?') who, q.payment_method method,
           COALESCE((SELECT SUM(m.amount) FROM recon_match m
             WHERE m.kind = '이체입금' AND m.ref_table = 'quote' AND m.ref_id = q.id AND m.status = '확정'), 0)::bigint dep_linked,
           (SELECT string_agg(x.description, ' · ') FROM recon_match m JOIN cash_txn x ON x.id = m.src_id
             WHERE m.kind = '이체입금' AND m.src_table = 'cash_txn' AND m.ref_table = 'quote' AND m.ref_id = q.id) dep_who,
           (SELECT string_agg(m.src_id::text, ',') FROM recon_match m
             WHERE m.kind IN ('매출계산서','매입계산서') AND m.src_table = 'tax_invoice' AND m.ref_table = 'quote' AND m.ref_id = q.id) tax_ids,
           (SELECT count(*)::int FROM recon_match m JOIN recon_match m2
              ON m2.src_table = 'tax_invoice' AND m2.src_id = m.src_id AND m2.ref_table = 'cash_txn' AND m2.status = '확정'
             WHERE m.kind IN ('매출계산서','매입계산서') AND m.src_table = 'tax_invoice' AND m.ref_table = 'quote' AND m.ref_id = q.id) tax_cashok
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id
    WHERE q.status = '성사' AND (
      (${nameCond(sql.raw("COALESCE(q.supplier_name, c.name, '')"))})
      ${custIds.length > 0 ? sql`OR q.customer_id IN (${sql.join(custIds.map((i) => sql`${i}`), sql`, `)})` : sql``}
      ${supNames.length > 0 ? sql`OR q.supplier_name IN (${sql.join(supNames.map((n) => sql`${n}`), sql`, `)})` : sql``}
      ${amt !== null ? sql`OR q.total_amount = ${amt}` : sql``}
    )
    ORDER BY 3 DESC LIMIT 30
  `);
  for (const r of quotes) {
    const total = Number(r.total);
    const depLinked = Number(r.dep_linked);
    const notes: string[] = [];
    let status: TraceRow["status"];
    let action: TraceRow["action"];
    if (r.dep_who) notes.push(`통장 입금과 이어짐 — ${r.dep_who}`);
    if (r.tax_ids) notes.push(`세금계산서와 이어짐 (#${r.tax_ids})${Number(r.tax_cashok) > 0 ? " — 그 계산서는 통장으로 확인됨" : ""}`);
    if (depLinked >= total && total > 0) status = { tone: "ok", text: "입금 확인 끝" };
    else if (r.method === "계좌이체" || r.method === "혼합") {
      if (Number(r.tax_cashok) > 0) status = { tone: "ok", text: "계산서 경로로 돈 확인됨" };
      else {
        status = { tone: "warn", text: depLinked > 0 ? `입금 일부만 확인 (${won(depLinked)}/${won(total)})` : "통장 입금과 안 이어짐" };
        // 후보 입금 — 금액 정확·미사용·±3/+5일
        const cand = await db.execute<{ id: number; d: string; description: string }>(sql`
          SELECT x.id, to_char(x.occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') d, x.description
          FROM cash_txn x
          WHERE x.source = '통장' AND x.is_active AND x.in_amount = ${total}
            AND x.recon_status IN ('미대조', '제안') AND x.category IS NULL
            AND (x.occurred_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN ${r.d}::date - 3 AND ${r.d}::date + 5
          LIMIT 2
        `);
        if (cand.length === 1) {
          notes.push(`이을 만한 입금: ${cand[0].d} 「${cand[0].description}」 ${won(total)}원`);
          action = { cashTxnId: Number(cand[0].id), quoteId: Number(r.id), label: `${cand[0].d} 입금과 잇기` };
        } else if (cand.length > 1) notes.push(`같은 금액의 미확인 입금이 ${cand.length}건 — 입금 정리에서 골라 주세요`);
        else notes.push("같은 금액의 미확인 입금 없음 — 미수금이거나 다른 금액·현금으로 받았을 수 있습니다");
      }
    } else status = { tone: "info", text: `${r.method ?? "?"} 판매 — 통장 확인 대상 아님` };
    rows.push({ key: `q${r.id}`, d: r.d, kind: "판매", title: `${r.who} (${r.quote_no})`, amount: total, status, notes, action });
  }

  /* ── ② 세금계산서 ── */
  const taxes = await db.execute<{
    id: number; d: string; direction: string; name: string; total: number; st: string; reason: string;
    cash_who: string | null; quote_no: string | null;
  }>(sql`
    SELECT t.id, to_char(t.write_date, 'YYYY-MM-DD') d, t.direction, t.counterparty_name name, t.total,
           t.recon_status st, COALESCE(t.recon_reason, '') reason,
           (SELECT string_agg(x.description, ' · ') FROM recon_match m JOIN cash_txn x ON x.id = m.ref_id
             WHERE m.src_table = 'tax_invoice' AND m.src_id = t.id AND m.ref_table = 'cash_txn' AND m.status = '확정') cash_who,
           (SELECT string_agg(qq.quote_no, ' · ') FROM recon_match m JOIN quote qq ON qq.id = m.ref_id
             WHERE m.src_table = 'tax_invoice' AND m.src_id = t.id AND m.ref_table = 'quote') quote_no
    FROM tax_invoice t
    WHERE t.is_active AND ((${nameCond(sql.raw("t.counterparty_name"))}) ${amt !== null ? sql`OR t.total = ${amt}` : sql``})
    ORDER BY t.write_date DESC LIMIT 30
  `);
  for (const t of taxes) {
    const notes: string[] = [];
    if (t.cash_who) notes.push(`통장과 이어짐 — ${t.cash_who}`);
    if (t.quote_no) notes.push(`판매와 이어짐 — ${t.quote_no}`);
    const status: TraceRow["status"] =
      t.st === "확정"
        ? { tone: "ok", text: `확정${t.reason ? ` — ${t.reason}` : t.cash_who ? " — 통장 확인" : t.quote_no ? " — 판매와 연결" : ""}` }
        : t.st === "무시" || t.st === "대기"
          ? { tone: "info", text: t.st === "대기" ? "아직 안 들어온 돈으로 미룸" : "무시(없던 일)" }
          : { tone: "warn", text: "돈 확인 안 됨" };
    rows.push({
      key: `t${t.id}`, d: t.d, kind: t.direction === "매출" ? "매출계산서" : "매입계산서",
      title: t.name, amount: Number(t.total), status, notes,
    });
  }

  /* ── ③ 통장·카드 줄 ── */
  const cash = await db.execute<{
    id: number; d: string; source: string; description: string; in_a: number; out_a: number;
    cat: string | null; st: string; linked: string | null;
  }>(sql`
    SELECT c.id, to_char(c.occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') d, c.source, c.description,
           c.in_amount in_a, c.out_amount out_a, c.category cat, c.recon_status st,
           (SELECT string_agg(DISTINCT
              CASE m.kind WHEN '이체입금' THEN '판매 ' || (SELECT quote_no FROM quote WHERE id = m.ref_id)
                          WHEN '매입지급' THEN '매입 ' || (SELECT invoice_no FROM purchase_invoice WHERE id = m.ref_id)
                          ELSE m.kind END, ' · ')
            FROM recon_match m
            WHERE m.status = '확정' AND ((m.src_table = 'cash_txn' AND m.src_id = c.id) OR (m.ref_table = 'cash_txn' AND m.ref_id = c.id))) linked
    FROM cash_txn c
    WHERE c.is_active AND ((${nameCond(sql.raw("c.description"))})
      ${amt !== null ? sql`OR c.in_amount = ${amt} OR c.out_amount = ${amt}` : sql``})
    ORDER BY c.occurred_at DESC LIMIT 30
  `);
  for (const cr of cash) {
    const isIn = Number(cr.in_a) > 0;
    const notes: string[] = [];
    if (cr.linked) notes.push(`이어짐 — ${cr.linked}`);
    if (cr.cat) notes.push(`분류: ${cr.cat}`);
    const status: TraceRow["status"] =
      cr.st === "확정" || cr.linked
        ? { tone: "ok", text: cr.linked ? "확인 끝" : `확인 끝 (${cr.cat ?? "분류"})` }
        : cr.st === "무시"
          ? { tone: "info", text: "접어둠(무시)" }
          : { tone: "warn", text: isIn ? "미확인 입금 — 입금 정리에서" : "미분류 지출 — 지출 분류에서" };
    rows.push({
      key: `c${cr.id}`, d: cr.d, kind: cr.source === "법인카드" ? "카드" : isIn ? "입금" : "출금",
      title: cr.description, amount: isIn ? Number(cr.in_a) : Number(cr.out_a), status, notes,
    });
  }

  rows.sort((a, b) => (a.d < b.d ? 1 : -1));
  return {
    rows: rows.slice(0, 60),
    hint: rows.length === 0 ? "걸리는 것이 없습니다 — 이름 일부(두 글자 이상)나 정확한 금액으로 다시 찾아보세요" : null,
  };
}
