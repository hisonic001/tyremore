/**
 * ⭐ 계산서 화면 개편 — 정본 `taxBook(ym)` (2026-09-11, 사장님 요청 "세금계산서 정리하는 부분도 굉장히 불편")
 *
 *   화면(/finance/tax)은 이것 하나만 부른다. 계약(타입)은 tax-book-types.ts.
 *
 *   사장님 결정 (설계서 「계산서 화면 개편」 §사장님 결정, 3라운드 — 재질문 금지):
 *     1  한 장 = 한 카드, 두 칸(누구 → 돈). 뷰 둘을 하나로.
 *     2  월정산 거래처는 거래처 한 줄 — 계산서 합 vs 준 돈 vs 남은 돈. 장 단위로 안 봄.
 *     3  매입·매출 한 화면, 색으로만 구분.
 *     4  사람이 누르는 건 [맞추기][경비][나중에][안 봄] 넷. 묶음·콤보·수수료·수정 상쇄·월정산은 앱이 판단해 보여 줌.
 *     5  대행사(카랑·오픈링크·레드캡) 매출 계산서는 장 단위 그대로 앱이 자동 — 카드에
 *        「카랑 → 쏘카 대신 끊음 · 쏘카 8월 청구 2,132,898 ✅ 원단위 일치 · 돈: 아직 안 들어옴(보통 다음 달 말)」 사슬.
 *     6  월정산 「끝」 = 단추 없음. 남은 돈 0이면 앱이 그 달 계산서를 끝 처리, 있으면 「남은 N만」.
 *     7  기준일 2026-08-25, 시작 잔액 = 세무사 원장(~08-24) 잔액. 그 전 계산서·출금은 남은 돈 셈에서 뺀다.
 *     8  앱 매입 장부는 월정산 줄에 「이 달 앱 입고 합」 한 칸 비교. 장별 잇기 없음.
 *     9  배치 B — 전부 상대별 한 줄(거래처도 개인도), 펼치면 그 상대의 계산서 카드.
 *     10 다른 달 발행·다른 달 지급 → 누적이라 흡수됨.
 *
 * 🔴 **새 판정을 만들지 않는다** — 장 단위 판정은 전부 기존 정본을 재사용한다:
 *     taxCashData(방향, ym)   통장 후보(autoBank)·조합(bankCombo)·묶음(bankBundle)·수정(isFix/fixFirst)·cov
 *     taxReconV2(ym)          앱 후보·수정 짝(fixPairs)·거래처 매칭(supplierId)
 *     sureTaxPicksFrom        확실 4종(one/combo/fee/fix) — 체크 기본 ON
 *     monthlyRemain           월정산 기준일 이후 누적 (현황 taxOpenCounts 와 같은 함수)
 *     agencyChainOf           대행사 사슬 (settleTaxCandidates 를 거꾸로)
 *     confirmMonthlyPartyCore 월정산 자동 끝 (결정 6 — 읽기 함수의 유일한 부작용, 되돌리기는 undoMonthlyParty)
 *   여기 인라인 SQL 은 상대 묶기·이 달 계산서 목록·연결 줄·앱 입고 합·기준일 전 집계뿐이다.
 *
 * 🔴 질의는 **순차** (풀 max 3). 정본 함수 안의 질의까지 합치면 한 화면에 수십 번이지만 전부 차례로 간다.
 * 🔴 "use server" 아님 — 화면(page)이 권한 확인 후 부른다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { BankPick, InvoiceCard, Mark, MoneyCell, MonthlySummary, PartyKind, PartyRow, TaxBook, WhoCell } from "./tax-book-types";
import {
  BASELINE_DEFAULT,
  CASH_LAT,
  hasBaselineCols,
  monthlyRemain,
  nearTolerance,
  partyRules,
  taxCashData,
  taxReconV2,
  type MonthlyRemain,
  type PartyRule,
  type TaxCashRow,
  type TaxSuggestion,
} from "./tax-recon";
import { confirmMonthlyPartyCore, sureTaxPicksFrom, type SureTaxPick } from "./recon-core";
import { normName } from "./recon-data";
import { agencyChainOf } from "./settle-tax";
import { kstToday, monthRange } from "./ym";

/* ------------------------------------------------------------------ */
/* 쉬운 말 헬퍼                                                         */

const won = (n: number) => n.toLocaleString("ko-KR");

/** 만원 단위 한 마디 — 42,450,000 → 「4,245만」, 39,000 → 「3.9만」, 220,000 → 「22만」, 7,000 → 「7,000원」 */
export function manWon(n: number): string {
  const a = Math.abs(Math.round(n));
  const sign = n < 0 ? "−" : "";
  if (a < 10000) return `${sign}${won(a)}원`;
  const v = a / 10000;
  const s = v >= 100 ? won(Math.round(v)) : Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, "");
  return `${sign}${s}만`;
}

/** 나쁜 쪽이 이긴다 — ✖ 손 > 🟡 확인 > ⚪ 때 아님 > ✅ 끝 */
const RANK: Record<Mark, number> = { hand: 3, confirm: 2, wait: 1, done: 0 };
const worse = (a: Mark, b: Mark): Mark => (RANK[a] >= RANK[b] ? a : b);

const mmdd = (d: string) => d.slice(5);
/** 「08-31」 → 「8/31」 */
const slash = (d: string) => {
  const [m, dd] = d.slice(-5).split("-");
  return `${Number(m)}/${Number(dd)}`;
};

/* ------------------------------------------------------------------ */
/* 이 달 계산서 원자료                                                   */

interface InvRow {
  id: number;
  direction: "매입" | "매출";
  d: string;
  biz: string;
  name: string;
  total: number;
  itemSummary: string | null;
  reconStatus: string;
  reconReason: string | null;
  /** 직접 확인 합(통장 연결 + 차액 조정) — CASH_LAT.cov */
  cov: number;
  /** 간접 확인(앱 기록 ↔ 지급 잡기·외상 수금) — CASH_LAT.ind */
  ind: boolean;
}

interface LinkRow {
  invId: number;
  refTable: string;
  refId: number;
  amount: number;
  method: string;
  d: string | null;
}

interface CashInfo {
  d: string;
  description: string;
}

/** 상대 열쇠 — 사업자번호 우선, 없으면 정규화 이름 (사장님 결정 9: 전부 상대별 한 줄) */
const partyKeyOf = (biz: string, name: string): string => {
  const b = String(biz ?? "").replace(/\D/g, "");
  return b.length >= 5 ? `B:${b}` : `N:${normName(name)}`;
};

/* ------------------------------------------------------------------ */

export async function taxBook(ym: string): Promise<TaxBook> {
  const { start, nextStart } = monthRange(ym);
  const today = kstToday();

  /* ① 장 단위 판정 정본 — 매입·매출 한 번씩. 확실 후보는 같은 자료로 (재조회 없음) */
  const buy = await taxCashData("매입", ym);
  const sell = await taxCashData("매출", ym);
  const v2 = await taxReconV2(ym);
  const sure: SureTaxPick[] = [...(await sureTaxPicksFrom(buy, "매입")), ...(await sureTaxPicksFrom(sell, "매출"))];

  const rowById = new Map<number, TaxCashRow>();
  for (const r of [...buy.rows, ...sell.rows]) rowById.set(r.id, r);
  const sugById = new Map<number, TaxSuggestion>();
  for (const g of v2.groups) for (const s of g.items) sugById.set(s.inv.id, s);
  const sureByInv = new Map<number, SureTaxPick[]>();
  for (const p of sure) {
    const id = p.kind === "fix" ? p.minusId : p.invId;
    sureByInv.set(id, [...(sureByInv.get(id) ?? []), p]);
  }

  /* ② 사전 — 상대 유형(+기준일·시작 잔액)·대행 짝·앱 거래처·별명 */
  const rules = await partyRules();
  const agency = await db.execute<{ counterparty_name: string; keyword: string | null; supplier_name: string }>(sql`
    SELECT counterparty_name, keyword, supplier_name FROM agency_map ORDER BY id LIMIT 200
  `);
  const suppliers = await db.execute<{ id: number; name: string; biz_no: string | null }>(sql`
    SELECT id, name, biz_no FROM supplier WHERE is_active ORDER BY id LIMIT 500
  `);
  const supByBiz = new Map<string, { id: number; name: string }>();
  const supByName = new Map<string, { id: number; name: string }>();
  for (const s of suppliers) {
    const v = { id: Number(s.id), name: s.name };
    if (s.biz_no) supByBiz.set(s.biz_no.replace(/\D/g, ""), v);
    supByName.set(s.name, v);
  }
  const aliases = await db.execute<{ alias_key: string; party_key: string }>(sql`
    SELECT alias_key, party_key FROM party_alias
    -- 🔴 LIMIT 없음 (2026-08-28 원칙): 별명은 이을 때마다 한 줄씩 느는 표 — 잘리면 ★만 조용히 꺼진다
  `);
  const aliasS = new Map<string, string>(); // 정규화 이름 → 앱 거래처 이름
  const rememberedBiz = new Set<string>(); // T:사업자번호 로 기억된 상대 (지급·정산 별명 학습됨)
  for (const a of aliases) {
    if (a.party_key.startsWith("S:")) aliasS.set(a.alias_key, a.party_key.slice(2));
    else if (a.party_key.startsWith("T:")) rememberedBiz.add(a.party_key.slice(2));
  }

  /* 이 상호가 대신 끊는 거래처들 — agency_map (settle-tax 의 EXISTS 조각과 같은 ILIKE 규칙) */
  const agencyFor = (name: string): string[] => {
    const n = String(name ?? "").toLowerCase();
    return [...new Set(agency.filter((a) => n.includes(a.counterparty_name.toLowerCase())).map((a) => a.supplier_name))];
  };
  /* 앱 거래처와 이어졌나 — supplier.biz_no → 별명 'S:' → (열린 매입은 v2 의 이름 짐작) */
  const supplierOf = (biz: string, name: string): { id: number; name: string; how: "번호" | "별명" } | null => {
    const byBiz = supByBiz.get(biz);
    if (byBiz) return { ...byBiz, how: "번호" };
    const an = aliasS.get(normName(name));
    const byAlias = an ? supByName.get(an) : undefined;
    if (byAlias) return { ...byAlias, how: "별명" };
    return null;
  };

  /* ③ 월정산 거래처 — 기준일 이후 누적 잔액. 남은 돈 0이면 그 달 열린 계산서를 앱이 끝낸다 (결정 6)
        🔴 이 달 계산서를 읽기 **전에** 한다 — 끝낸 결과가 카드 상태에 바로 반영되게 */
  const monthlyByKey = new Map<string, MonthlyRemain>();
  const monthlyDirs = [
    ...buy.monthly.map((m) => ({ bizNo: m.bizNo, direction: "매입" as const })),
    ...sell.monthly.map((m) => ({ bizNo: m.bizNo, direction: "매출" as const })),
  ];
  for (const m of monthlyDirs) {
    const key = `B:${m.bizNo}`;
    if (monthlyByKey.has(key)) continue; // 매입·매출 둘 다면 매입(채무 장부)이 줄의 기준 — 매출은 카드로만
    let mr = await monthlyRemain(m.bizNo, ym, m.direction, rules.get(m.bizNo) ?? null);
    if (mr.remain <= 0 && mr.openN > 0) {
      const r = await confirmMonthlyPartyCore(m.bizNo, ym, m.direction);
      if (r.ok && r.applied > 0) mr = { ...mr, openN: 0, invoices: mr.invoices.map((i) => (i.d >= start && (i.reconStatus === "미대조" || i.reconStatus === "제안") ? { ...i, reconStatus: "확정", reconReason: "월정산" } : i)) };
    }
    monthlyByKey.set(key, mr);
  }

  /* ④ 이 달 계산서 전부 (상태 무관 — 자동·규칙으로 끝난 것도 「앱이 알아서 맞춘 것」에 들어간다) */
  const invRows = await db.execute<{
    id: number; direction: "매입" | "매출"; d: string; biz: string; name: string; total: number;
    item_summary: string | null; recon_status: string; recon_reason: string | null; cov: string; ind: boolean;
  }>(sql`
    SELECT t.id, t.direction, to_char(t.write_date, 'YYYY-MM-DD') d, t.counterparty_biz_no biz,
           t.counterparty_name name, t.total, t.item_summary, t.recon_status, t.recon_reason, x.cov, x.ind
    FROM tax_invoice t ${CASH_LAT}
    WHERE t.is_active AND t.write_date >= ${start}::date AND t.write_date < ${nextStart}::date
    ORDER BY t.write_date DESC, t.id DESC LIMIT 400
  `);
  const invs: InvRow[] = invRows.map((r) => ({
    id: Number(r.id),
    direction: r.direction,
    d: r.d,
    biz: String(r.biz ?? "").replace(/\D/g, ""),
    name: r.name,
    total: Number(r.total),
    itemSummary: r.item_summary,
    reconStatus: r.recon_status,
    reconReason: r.recon_reason,
    cov: Number(r.cov),
    ind: r.ind === true,
  }));

  /* ⑤ 연결된 줄(되돌리기 재료·자동 여부) + 후보 통장 줄의 날짜·적요 */
  const linksByInv = new Map<number, LinkRow[]>();
  if (invs.length > 0) {
    const links = await db.execute<{ inv_id: number; ref_table: string; ref_id: number; amount: number; method: string; d: string | null }>(sql`
      SELECT m.src_id inv_id, m.ref_table, m.ref_id, m.amount, m.method,
             to_char(c.occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') d
      FROM recon_match m
      LEFT JOIN cash_txn c ON m.ref_table = 'cash_txn' AND c.id = m.ref_id
      WHERE m.src_table = 'tax_invoice' AND m.status = '확정' AND m.kind IN ('매입계산서', '매출계산서')
        AND m.src_id IN (${sql.join(invs.map((i) => sql`${i.id}`), sql`, `)})
      LIMIT 3000
    `);
    for (const l of links) {
      const id = Number(l.inv_id);
      linksByInv.set(id, [
        ...(linksByInv.get(id) ?? []),
        { invId: id, refTable: l.ref_table, refId: Number(l.ref_id), amount: Number(l.amount), method: l.method, d: l.d },
      ]);
    }
  }
  const cashIds = new Set<number>();
  for (const r of rowById.values()) {
    for (const b of r.autoBank) cashIds.add(b.id);
    for (const id of r.bankCombo?.ids ?? []) cashIds.add(id);
    if (r.bankBundle) cashIds.add(r.bankBundle.cashId);
  }
  const cashInfo = new Map<number, CashInfo>();
  if (cashIds.size > 0) {
    const cs = await db.execute<{ id: number; d: string; description: string }>(sql`
      SELECT id, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') d, description
      FROM cash_txn WHERE id IN (${sql.join([...cashIds].map((i) => sql`${i}`), sql`, `)})
    `);
    for (const c of cs) cashInfo.set(Number(c.id), { d: c.d, description: c.description });
  }

  /* ⑥ 앱 입고 합(이 달, 거래처별) — 월정산 줄의 「앱 입고」 한 칸 (결정 8) */
  const appRecv = await db.execute<{ supplier: string; s: string }>(sql`
    SELECT supplier, COALESCE(SUM(total), 0)::bigint s
    FROM purchase_invoice
    WHERE status <> '취소' AND total > 0
      AND COALESCE(issued_at, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) >= ${start}
      AND COALESCE(issued_at, to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) < ${nextStart}
    GROUP BY 1 LIMIT 300
  `);
  const appRecvBySup = new Map(appRecv.map((r) => [r.supplier, Number(r.s)]));

  /* ⑦ 상대별 묶기 */
  interface Party {
    key: string;
    bizNo: string | null;
    name: string;
    rule: PartyRule | null;
    invs: InvRow[];
  }
  const parties = new Map<string, Party>();
  for (const i of invs) {
    const key = partyKeyOf(i.biz, i.name);
    let p = parties.get(key);
    if (!p) {
      p = { key, bizNo: key.startsWith("B:") ? i.biz : null, name: i.name, rule: (i.biz && rules.get(i.biz)) || null, invs: [] };
      parties.set(key, p);
    }
    p.invs.push(i);
  }

  const kindOf = (p: Party): { kind: PartyKind; agencyFor: string | null; supplier: ReturnType<typeof supplierOf> } => {
    const supplier = supplierOf(p.bizNo ?? "", p.name);
    const rk = p.rule?.kind;
    if (rk === "월정산" || rk === "경비" || rk === "무시") return { kind: rk, agencyFor: null, supplier };
    const af = agencyFor(p.name);
    if (rk === "대행정산" || af.length > 0) return { kind: "대행", agencyFor: af.length > 0 ? af.join("·") : null, supplier };
    if (supplier) return { kind: "거래처", agencyFor: null, supplier };
    return { kind: "개인", agencyFor: null, supplier: null };
  };

  /* ⑧ 카드 조립 — 판정은 정본 값(row/sug/sure/links)을 읽기만 한다 */
  const buildCard = (
    i: InvRow,
    p: Party,
    kind: PartyKind,
    agencyNames: string | null,
    supplier: ReturnType<typeof supplierOf>,
    monthly: MonthlyRemain | null,
  ): InvoiceCard => {
    const row = rowById.get(i.id) ?? null;
    const sug = sugById.get(i.id) ?? null;
    const sures = sureByInv.get(i.id) ?? [];
    const links = linksByInv.get(i.id) ?? [];
    const linked = links
      .filter((l) => l.refTable === "cash_txn")
      .map((l) => ({ cashTxnId: l.refId, d: l.d ?? "", amount: l.amount }));
    const appLinked = links.some((l) => l.refTable === "purchase_invoice" || l.refTable === "quote");
    const isMonthlyDone = i.reconReason === "월정산";
    const done = i.total > 0 && (i.cov >= i.total || i.ind || isMonthlyDone);

    /* 상태 — 규칙(경비·무시)·수정 상쇄·나중에 */
    const reason = i.reconReason ?? "";
    const status: InvoiceCard["status"] =
      i.reconStatus === "무시"
        ? reason.startsWith("수정상쇄")
          ? "fixed"
          : reason === "경비" || kind === "경비"
            ? "expense"
            : "ignored"
        : i.reconStatus === "대기"
          ? "waiting"
          : "normal";

    /* 누구 칸 */
    let who: WhoCell;
    const supText = supplier ? `거래처 ${supplier.name}(${supplier.how === "번호" ? "사업자번호" : "별명"})` : null;
    if (kind === "월정산") who = { mark: "done", text: `월정산 거래처${supText ? " · " + supText : ""}`, supplierId: supplier?.id ?? null };
    else if (kind === "대행")
      who = {
        mark: "done",
        text: agencyNames ? `${p.name} → ${agencyNames} 대신 끊음` : `${p.name} · 대행 정산사`,
        chain: null,
        supplierId: supplier?.id ?? null,
      };
    else if (kind === "경비") who = { mark: "done", text: "경비 (규칙 — 계속 자동)", supplierId: supplier?.id ?? null };
    else if (kind === "무시") who = { mark: "done", text: "안 봄 (규칙 — 계속 자동)", supplierId: supplier?.id ?? null };
    else if (supplier) who = { mark: "done", text: supText!, supplierId: supplier.id };
    else if (sug?.supplierId)
      who = { mark: "confirm", text: `거래처 ${sug.supplierName ?? ""}(이름 짐작)`, supplierId: sug.supplierId };
    else if (i.biz && rememberedBiz.has(i.biz)) who = { mark: "done", text: "기억된 상대 (통장 이름 배움)", supplierId: null };
    else if (done || status !== "normal") who = { mark: "done", text: "상대 확인됨", supplierId: null };
    else who = { mark: "hand", text: "? — 처음 보는 상대", supplierId: null };

    /* 돈 칸 */
    const remain0 = Math.max(0, i.total - i.cov);
    const money: MoneyCell = {
      mark: "done",
      text: "",
      linked,
      remain: done || status !== "normal" ? 0 : remain0,
      picks: [],
      combo: null,
      bundle: null,
      fix: null,
      fixFirst: null,
    };

    if (status === "fixed") {
      money.text = "✅ 수정 계산서와 서로 지움";
    } else if (status === "expense") {
      money.text = "✅ 경비 — 돈 대조 안 함";
    } else if (status === "ignored") {
      money.text = `✅ 안 봄${reason && reason !== "직접" ? ` (${reason})` : ""}`;
    } else if (status === "waiting") {
      money.mark = "wait";
      money.text = "⚪ 아직 안 들어옴(보통 다음 달 말)";
    } else if (done) {
      money.text = isMonthlyDone
        ? "✅ 월정산 — 거래처 잔액으로 확인"
        : linked.length > 0
          ? `✅ ${linked.map((l) => `${slash(l.d)} ${i.direction === "매입" ? "출금" : "입금"} ${won(l.amount)}`).join(" + ")}`
          : appLinked || i.ind
            ? "✅ 앱 기록(지급·수금)으로 확인"
            : "✅ 확인 끝";
    } else if (kind === "월정산") {
      /* 결정 2·6: 장 단위 판정 없음 — 거래처 줄의 남은 돈이 답이다 */
      if (monthly && monthly.remain > 0) {
        money.mark = "confirm";
        money.text = `🟡 거래처 잔액으로 봅니다 — 남은 ${manWon(monthly.remain)}`;
      } else {
        money.mark = "confirm";
        money.text = "🟡 거래처 잔액으로 봅니다";
      }
    } else if (row?.fixFirst) {
      const minus = v2.groups.flatMap((g) => g.items).find((s) => s.inv.total < 0 && s.fixPairs.some((f) => f.id === i.id));
      money.mark = "confirm";
      money.fixFirst = minus
        ? { minusId: minus.inv.id, label: `${mmdd(minus.inv.writeDate)} ${won(minus.inv.total)}원` }
        : { minusId: 0, label: "수정(마이너스) 계산서" };
      money.text = "🟡 수정 계산서와 서로 지움 먼저 — 통장보다 상쇄가 먼저";
    } else if (row?.isFix || i.total < 0) {
      const pairs = sug?.fixPairs ?? [];
      const sureFix = sures.find((s): s is Extract<SureTaxPick, { kind: "fix" }> => s.kind === "fix");
      if (sureFix) {
        money.mark = "confirm";
        money.fix = { originId: sureFix.originId, label: pairs.find((f) => f.id === sureFix.originId)?.label ?? `원본 #${sureFix.originId}`, auto: true };
        money.text = `🟡 원본 ${money.fix.label} → 서로 지움`;
      } else if (pairs.length > 1) {
        money.mark = "hand";
        money.fix = { originId: pairs[0].id, label: pairs.map((f) => f.label).join(" / "), auto: false };
        money.text = `✖ 원본 후보 ${pairs.length}장 — 골라 주세요`;
      } else if (pairs.length === 1) {
        money.mark = "confirm";
        money.fix = { originId: pairs[0].id, label: pairs[0].label, auto: false };
        money.text = `🟡 원본 ${pairs[0].label} → 서로 지움`;
      } else {
        money.mark = "hand";
        money.text = "✖ 마이너스 계산서 — 상쇄할 원본을 못 찾음";
      }
    } else if (row) {
      /* 통장 후보 — taxCashData 의 autoBank(★/≈)·bankCombo·bankBundle 그대로, 말만 쉬운 말로 */
      const sureOne = sures.find((s): s is Extract<SureTaxPick, { kind: "one" | "fee" }> => s.kind === "one" || s.kind === "fee");
      const sureCombo = sures.find((s): s is Extract<SureTaxPick, { kind: "combo" }> => s.kind === "combo");
      const tol = nearTolerance(remain0);
      money.picks = row.autoBank.map((b): BankPick => {
        const info = cashInfo.get(b.id);
        const diff = b.amount - remain0;
        const similar = b.label.startsWith("≈");
        const why =
          diff === 0
            ? b.known
              ? "정확 일치"
              : "금액 같음 — 이름 다름, 확인"
            : Math.abs(diff) <= tol
              ? `수수료 차이 ${won(Math.abs(diff))}`
              : b.known
                ? `이름 기억됨 · 차이 ${won(Math.abs(diff))}`
                : similar
                  ? "이름 비슷"
                  : "이름 다름 — 확인";
        return {
          cashTxnId: b.id,
          d: info?.d ?? "",
          description: info?.description ?? b.label,
          amount: b.amount,
          diff,
          why,
          sure: !!sureOne && sureOne.cashId === b.id,
        };
      });
      if (row.bankCombo) {
        money.combo = {
          cashTxnIds: row.bankCombo.ids,
          label: `${row.bankCombo.ids.length}줄 합 ${won(row.bankCombo.total)}${row.bankCombo.diff === 0 ? " · 정확" : ` · 차이 ${won(Math.abs(row.bankCombo.diff))}`}`,
          diff: row.bankCombo.diff,
        };
      }
      if (row.bankBundle) {
        money.bundle = {
          cashTxnId: row.bankBundle.cashId,
          invoiceIds: row.bankBundle.invoiceIds,
          label: `통장 ${won(row.bankBundle.total)} = ${row.bankBundle.parts.join(" + ")}`,
        };
      }
      const partial = row.bankCovered > 0 ? `일부 확인 ${won(row.bankCovered)} · 남은 ${won(remain0)} · ` : "";
      const knownOnly = money.picks.filter((x) => x.why === "정확 일치" || x.why.startsWith("수수료") || x.why.startsWith("이름 기억됨"));
      if (sureOne || sureCombo) {
        money.mark = "confirm";
        const pk = sureOne ? money.picks.find((x) => x.cashTxnId === sureOne.cashId) : null;
        money.text = pk
          ? `🟡 ${partial}후보 1 — ${slash(pk.d)} ${i.direction === "매입" ? "출금" : "입금"} ${won(pk.amount)}${pk.diff !== 0 ? ` (${pk.diff > 0 ? "+" : "−"}${won(Math.abs(pk.diff))} 수수료)` : ""}`
          : `🟡 ${partial}${money.combo?.label ?? "여러 줄 합이 맞음"}`;
      } else if (money.bundle) {
        money.mark = "confirm";
        money.text = `🟡 ${partial}${money.bundle.label} — 한 번에`;
      } else if (money.combo && money.combo.diff === 0) {
        money.mark = "confirm";
        money.text = `🟡 ${partial}${money.combo.label}`;
      } else if (money.picks.length === 1 && knownOnly.length === 1) {
        money.mark = "confirm";
        const pk = money.picks[0];
        money.text = `🟡 ${partial}후보 1 — ${slash(pk.d)} ${won(pk.amount)} (${pk.why})`;
      } else if (money.picks.length > 0 || money.combo) {
        money.mark = "hand";
        money.text = `✖ ${partial}후보 ${money.picks.length}${money.combo ? " · 조합 1" : ""} — 골라 주세요`;
      } else if (kind === "대행") {
        /* 결정 5: 대행사는 다음 달 말쯤 들어온다 — 두 달 안이면 기다림, 넘으면 손 */
        const age = (Date.parse(today) - Date.parse(i.d)) / 86400000;
        if (age <= 60) {
          money.mark = "wait";
          money.text = "⚪ 아직 안 들어옴(보통 다음 달 말)";
        } else {
          money.mark = "hand";
          money.text = "✖ 두 달 넘게 안 들어옴 — 통장에서 찾아 주세요";
        }
      } else {
        money.mark = "hand";
        money.text = `✖ ${partial}통장에서 못 찾음`;
      }
    } else {
      /* taxCashData 목록(50장 컷) 밖의 열린 계산서 — 후보 없음으로 손 */
      money.mark = "hand";
      money.text = "✖ 통장에서 못 찾음 (후보 없음)";
    }

    /* 자동 여부 — 이 달 recon_match 가 전부 '자동'/'조정' 이거나 규칙(경비·무시·수정상쇄(자동)·과거분·월정산) */
    const auto =
      (done && links.length > 0 && links.every((l) => l.method === "자동" || l.method === "조정")) ||
      (done && isMonthlyDone) ||
      (status === "expense" && (kind === "경비" || reason === "경비")) ||
      (status === "ignored" && (kind === "무시" || reason === "무시" || reason === "과거분")) ||
      (status === "fixed" && reason === "수정상쇄(자동)");

    return {
      id: i.id,
      direction: i.direction,
      d: i.d,
      total: i.total,
      itemSummary: i.itemSummary,
      status,
      who,
      money,
      mark: worse(who.mark, money.mark),
      auto,
    };
  };

  /* ⑨ 상대 줄 */
  const rows: PartyRow[] = [];
  const chainCalls = { n: 0 };
  for (const p of parties.values()) {
    const { kind, agencyFor: af, supplier } = kindOf(p);
    const monthly = kind === "월정산" ? (monthlyByKey.get(p.key) ?? null) : null;
    const cards = p.invs.map((i) => buildCard(i, p, kind, af, supplier, monthly));

    /* 대행사 사슬 (결정 5) — 매출 양수 카드마다 settleTaxCandidates 를 거꾸로. 상한 20장 */
    if (kind === "대행") {
      for (const c of cards) {
        if (c.direction !== "매출" || c.total <= 0 || chainCalls.n >= 20) continue;
        chainCalls.n++;
        const ch = await agencyChainOf(c.id);
        c.who.chain = ch
          ? {
              text: `${ch.supplier} ${Number(ch.ym.slice(5))}월 청구 ${won(ch.monthTotal)} (외상 ${ch.n}건) · ${ch.diff === 0 ? "원단위 일치" : `차이 ${won(Math.abs(ch.diff))}`}`,
              exact: ch.diff === 0,
              href: ch.href,
            }
          : null;
      }
    }

    cards.sort((a, b) => RANK[b.mark] - RANK[a.mark] || Math.abs(b.total) - Math.abs(a.total));
    const count = cards.length;
    const total = cards.reduce((s, c) => s + c.total, 0);
    const handN = cards.filter((c) => c.mark === "hand").length;
    const confirmN = cards.filter((c) => c.mark === "confirm").length;
    const dirWord = cards.every((c) => c.direction === "매출") ? "매출 " : cards.every((c) => c.direction === "매입") ? "" : "매입·매출 ";

    let mark: Mark;
    let summary: string;
    let monthlySummary: MonthlySummary | null = null;
    if (kind === "월정산" && monthly) {
      /* 결정 2·6·7·8 — 거래처 한 줄: 계산서 합 vs 준 돈 vs 남은 돈, 앱 입고 비교 */
      mark = monthly.remain > 0 ? "confirm" : "done";
      const gave = monthly.direction === "매출" ? "받은 돈" : "준 돈";
      const appReceived = supplier && monthly.direction === "매입" ? (appRecvBySup.get(supplier.name) ?? null) : null;
      summary =
        `계산서 ${count}장 ${manWon(monthly.monthInvoiced)} · ${gave} ${manWon(monthly.monthPaid)} · ` +
        (monthly.remain > 0 ? `남은 ${manWon(monthly.remain)}` : "맞음") +
        (monthly.paidPast > 0 ? ` · 그 전 것 ${manWon(monthly.paidPast)} 갚음` : "");
      monthlySummary = {
        baselineDate: monthly.baselineDate,
        baselineAmount: monthly.baselineAmount,
        baselineNote: monthly.baselineNote,
        invoiced: monthly.invoiced,
        paid: monthly.paid,
        remain: monthly.remain,
        paidPast: monthly.paidPast,
        monthInvoiced: monthly.monthInvoiced,
        monthPaid: monthly.monthPaid,
        appReceived,
        appGap: appReceived === null ? null : monthly.monthInvoiced - appReceived,
        invoices: monthly.invoices.map((iv) => ({
          id: iv.id,
          d: iv.d,
          total: iv.total,
          status: cards.find((c) => c.id === iv.id)?.status ?? (iv.reconStatus === "무시" ? "ignored" : iv.reconStatus === "대기" ? "waiting" : "normal"),
        })),
        payments: monthly.payments,
      };
    } else {
      mark = cards.reduce<Mark>((m, c) => worse(m, c.mark), "done");
      const head = `${dirWord}${count}장 ${manWon(total)}`;
      if (kind === "경비") summary = `${head} · 경비`;
      else if (kind === "무시") summary = `${head} · 안 봄`;
      else if (kind === "대행" && cards.some((c) => c.money.mark === "wait")) summary = `${head} · 입금 기다림(보통 다음 달 말)`;
      else if (handN > 0 && cards.some((c) => c.who.mark === "hand")) summary = `${head} · 누구?`;
      else if (handN > 0) summary = `${head} · 통장에서 못 찾음 ${handN}장`;
      else if (confirmN > 0) summary = `${head} · 후보 있음 ${confirmN}장 — 한 번 눌러 끝`;
      else if (mark === "wait") summary = `${head} · 기다리는 중`;
      else summary = `${head} · 끝`;
    }

    rows.push({
      key: p.key,
      bizNo: p.bizNo,
      name: p.name,
      kind,
      agencyFor: af,
      mark,
      summary, // 아이콘(✅🟡✖⚪)은 화면이 mark 로 그린다 — 글에는 안 넣는다
      count,
      total,
      handN,
      confirmN,
      cards,
      monthly: monthlySummary,
      supplierId: supplier?.id ?? null,
    });
  }
  // ✖ 손 → 🟡 확인 → ⚪ 기다림 → ✅ 끝, 같은 층 안은 금액 큰 순 (설계서 「정렬」)
  rows.sort((a, b) => RANK[b.mark] - RANK[a.mark] || Math.abs(b.total) - Math.abs(a.total));

  /* ⑩ 층 — 자동(접힘)·확인(체크 일괄)·기준일 전 */
  const allCards = rows.flatMap((r) => r.cards);
  const autoCards = allCards.filter((c) => c.auto);
  const confirmIds = allCards
    .filter((c) => c.money.picks.some((x) => x.sure) || (c.money.fix?.auto ?? false) || sureByInv.get(c.id)?.some((s) => s.kind === "combo"))
    .map((c) => c.id);

  const hasBase = await hasBaselineCols();
  const [past] = await db.execute<{ n: number; s: string }>(
    hasBase
      ? sql`
        SELECT count(*)::int n, COALESCE(SUM(t.total), 0)::bigint s
        FROM tax_invoice t
        LEFT JOIN tax_party_rule r ON r.biz_no = t.counterparty_biz_no AND r.kind = '월정산'
        WHERE t.is_active AND t.recon_status IN ('미대조', '제안')
          AND t.write_date < COALESCE(r.baseline_date, ${BASELINE_DEFAULT}::date)
      `
      : sql`
        SELECT count(*)::int n, COALESCE(SUM(t.total), 0)::bigint s
        FROM tax_invoice t
        WHERE t.is_active AND t.recon_status IN ('미대조', '제안') AND t.write_date < ${BASELINE_DEFAULT}::date
      `,
  );

  /* 수: 월정산 거래처는 1건(결정 2), 나머지는 장 단위 — taxOpenCounts 와 같은 정신 */
  const counts = { hand: 0, confirm: 0, done: 0, partiesOpen: 0 };
  for (const r of rows) {
    if (r.kind === "월정산") {
      if (r.mark === "confirm") counts.confirm++;
      else counts.done++;
    } else {
      for (const c of r.cards) {
        if (c.mark === "hand") counts.hand++;
        else if (c.mark === "confirm") counts.confirm++;
        else if (c.mark === "done") counts.done++;
      }
    }
    if (r.mark === "hand" || r.mark === "confirm") counts.partiesOpen++;
  }

  return {
    ym,
    parties: rows,
    autoDone: { cards: autoCards, expenseN: autoCards.filter((c) => c.status === "expense").length },
    confirmIds,
    past: { n: Number(past?.n ?? 0), amount: Number(past?.s ?? 0), href: "/finance/party" },
    counts,
  };
}
