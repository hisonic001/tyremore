/**
 * ⭐ 세금계산서 대조 — 후보 계산 (ERP 2단계, 2026-08-24)
 *
 *   미대조 세금계산서마다 「어느 매입/판매와 같은 건인가」 후보를 만든다.
 *   원칙(계획서): 자동확정 = ①상대 식별 확실 ②금액 정확 일치 ③후보 유일 — 셋 다일 때만.
 *   그 외는 전부 '제안'으로 사람이 확정한다 (MARS 에서 배운 「확실하지 않으면 사람에게」).
 *
 * 🔴 "use server" 아님 — 화면(페이지)이 권한 확인 후 부르고, 확정은 recon.ts 가 한다.
 * 🔴 질의 순차 · LIMIT — 자료가 작아(월 수십 건) JS 에서 맞춘다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { CARD_SETTLE_PATTERN_SQL, PAYER_KEY_SQL, payerKeyOf } from "./expense-cats";
import { monthRange } from "./ym";

const norm = (s: string | null | undefined): string =>
  String(s ?? "")
    .replace(/㈜|\(주\)|주식회사|\s/g, "")
    .toLowerCase();

/** ⭐ 별명 사전이 쓰는 이름 정규화 — 학습(recon·fin-deposits)과 조회가 같은 규칙 */
export const normName = norm;

/* ================================================================== */
/* ⭐ 상대 이름 맞추기 정본 (사장님 지적 2026-08-25 — "(주)트랜스코스·맥스런이     */
/*    검색이 안 됨"). 은행 적요는 12자쯤에서 잘리고(「(주)트랜스코스」),           */
/*    ㈜·(주)·주식회사·공백 표기도 제각각이라 상호 그대로는 절대 안 맞는다.        */
/*    돈 관리의 모든 이름 매칭이 이 두 개를 쓴다 — 한 곳만 고치면 전부 고쳐진다.   */

/** 앞에서부터 몇 자가 같으면 같은 상대로 볼 것인가 (잘림 대비) */
const HEAD = 5;

/**
 * 🔴 2025 감사 F16(2026-08-26): 상호가 「타이어」 한 단어인 상대(타이어365 양양점의 다른 표기)가
 *    모든 타이어 거래처의 포함 검사에 걸렸다. 업종·지역 같은 일반어는 이름 근거가 못 된다.
 */
const GENERIC_WORDS = new Set(["타이어", "주식회사", "양양점", "속초점", "속초", "양양", "코리아", "타이어365", "카센타", "카센터"]);
const isGeneric = (x: string) => GENERIC_WORDS.has(x);

/**
 * 두 이름이 같은 상대인가 (★ 등급) — 같거나 한쪽이 다른 쪽을 품는다. 표기 차이·잘림을 견딘다.
 * 🔴 2026 감사 G8(2026-08-26): ①정규화 2글자 「(주)제로」가 자기 자신과도 false 였다 → 같으면 무조건 true
 *    ②앞5자 규칙은 「타이어프로 판교점」↔「타이어프로속초」를 ★로 오인 → 약한 등급(similarPartyName)으로 강등
 */
export function samePartyName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x.length < 2 || y.length < 2) return false;
  if (x === y) return true;
  if (isGeneric(x) || isGeneric(y)) return false;
  const short = x.length <= y.length ? x : y;
  return short.length >= 3 && (x.includes(y) || y.includes(x));
}

/**
 * 비슷한 상대인가 (≈ 등급 — 후보엔 올리되 ★·자동은 아니다):
 *   앞5자가 같거나(지점 차이·잘림), 적요를 괄호·공백으로 나눈 조각(3자 이상)이 상호의 앞부분이다
 *   — 「송명숙(대건종」 ↔ 대건종합상사, 「김재준(진양윤」 ↔ 진양윤활유 (2026 감사 R9)
 */
export function similarPartyName(payer: string | null | undefined, name: string | null | undefined): boolean {
  const x = norm(payer);
  const y = norm(name);
  if (x.length < 2 || y.length < 2) return false;
  if (samePartyName(payer, name)) return true;
  if (isGeneric(x) || isGeneric(y)) return false;
  const n = Math.min(x.length, y.length, HEAD);
  if (n >= 4 && x.slice(0, n) === y.slice(0, n)) return true;
  const parts = String(payer ?? "")
    .split(/[\s()\[\]A_/·,\-]+/)
    .map((p) => norm(p))
    .filter((p) => p.length >= 3 && !isGeneric(p));
  return parts.some((p) => y.startsWith(p) || (p.length >= 4 && y.includes(p)));
}

/** 정규화한 적요 컬럼 — SQL 쪽 규칙(normName 과 같은 것을 지운다) */
export const normDescSql = (col = "description") =>
  sql.raw(`regexp_replace(lower(${col}), '㈜|\\(주\\)|주식회사|[[:space:]]', '', 'g')`);

/**
 * SQL 조건 — 적요가 이 이름들 중 하나와 맞나 (정규화 + 앞 ${HEAD}자 잘림 대비).
 * 이름이 없으면 false 를 돌려 질의가 전부를 긁는 사고를 막는다.
 */
export function partyMatchSql(names: (string | null | undefined)[], col = "description") {
  const pats = new Set<string>();
  for (const n of names) {
    const x = norm(n);
    if (isGeneric(x)) continue; // 「타이어」 같은 일반어 하나로는 통장을 긁지 않는다 (F16)
    if (x.length >= 2) pats.add(x);
    if (x.length >= HEAD) pats.add(x.slice(0, HEAD));
  }
  if (pats.size === 0) return sql`false`;
  const nd = normDescSql(col);
  return sql.join(
    [...pats].map((p) => sql`${nd} LIKE ${"%" + p + "%"}`),
    sql` OR `,
  );
}

/**
 * 상대의 「돈 계산용」 이름들 — 최근 상호 + 배운 지급·정산 별명(T:) 원문.
 * 🔴 짧은 거래처 약칭('미쉐린')은 일부러 안 넣는다 — '미쉐린로열'(경비)까지 긁어
 *    월정산 카드와 원장의 잔액이 어긋나던 근원 (감사 B5, 2026-08-25).
 */
export async function partyStrictNames(bizNo: string): Promise<string[]> {
  const [t] = await db.execute<{ name: string }>(sql`
    SELECT counterparty_name name FROM tax_invoice
    WHERE is_active AND counterparty_biz_no = ${bizNo} ORDER BY id DESC LIMIT 1
  `);
  const aliases = await db.execute<{ raw: string }>(sql`
    SELECT alias_raw raw FROM party_alias WHERE party_key = ${"T:" + bizNo} LIMIT 12
  `);
  return [...new Set([t?.name, ...aliases.map((a) => a.raw)].filter((x): x is string => !!x))];
}

/** 상대의 달별 통장 합(출금·입금·건수) — 월정산 카드와 거래처 원장이 같은 식을 쓴다 */
export async function partyMonthlyCash(
  names: string[],
): Promise<Map<string, { outS: number; inS: number; n: number }>> {
  if (names.length === 0) return new Map();
  const cond = partyMatchSql(names);
  const rows = await db.execute<{ ym: string; out_s: string; in_s: string; n: number }>(sql`
    SELECT to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') ym,
           COALESCE(SUM(out_amount), 0)::bigint out_s,
           COALESCE(SUM(in_amount), 0)::bigint in_s,
           count(*)::int n
    FROM cash_txn
    WHERE source = '통장' AND is_active AND (${cond})
    GROUP BY 1 ORDER BY 1 LIMIT 40
  `);
  return new Map(rows.map((r) => [r.ym, { outS: Number(r.out_s), inS: Number(r.in_s), n: Number(r.n) }]));
}

/* 🔴 감사 M2(2026-08-25): v1 taxReconData 170줄(죽은 코드) 삭제 — 정본은 tax-recon.ts */

/* ================================================================== */
/* ERP 4단계 — 통장 입금 대조 (2026-08-24)                              */

export interface DepositRow {
  id: number;
  /** YYYY-MM-DD */
  date: string;
  at: string;
  amount: number;
  description: string;
  /** 「[적요] 내용」에서 뽑은 입금자명 어림 */
  payerName: string;
  label: string;
}

export interface DepositQuoteRef {
  quoteId: number;
  label: string;
  amount: number;
  date: string;
  /** 앱에 적힌 결제수단 — 이체가 아닌 것으로 적혀 있어도 실제 이체였으면 잇는다 (2026-08-26) */
  pm: string | null;
  /** 입금자명과 판매 상대 이름이 같다 (★) */
  nameOk: boolean;
}

export interface DepositPartyRef {
  /** receivable-book 의 대상 열쇠 — 'S:금호' · 'C:123' */
  key: string;
  label: string;
  remain: number;
  count: number;
}

export interface DepositSuggestion {
  dep: DepositRow;
  /** 같은 금액·±3일의 계좌이체 판매 — 항상 제안(자동확정 없음, 동명 금액 위험) */
  quotes: DepositQuoteRef[];
  /** 입금자명과 이름이 닮은 외상 대상 — [수금 등록]으로 바로 턴다 */
  parties: DepositPartyRef[];
  /** 기억된 정산 입금자(세금계산서 상대) — 「이관우 = 한국타이어 정산」 안내 */
  taxHint: string | null;
}

export interface DepositReconData {
  open: DepositSuggestion[];
  /** 정리할 입금 총 건수 — 목록(60건)과 무관한 실제 수. 현황·마감 체크리스트와 같은 정의 (2026 감사 N2) */
  openTotal: number;
  /** 이 달 통장 입금 줄 수 — 0이면 「자료가 안 올라왔다」와 「다 정리됐다」를 가른다 (2026 감사 R5) */
  monthInCount: number;
  /** 카드정산으로 표시된 입금(이 달) — 잘못 표시했으면 되돌린다 (감사 H10). 목록은 40건까지 */
  settledCard: { id: number; at: string; amount: number; payer: string }[];
  /** 카드정산 표시 총 건수 (목록 절단과 무관한 실제 수 — 2026 감사 N4) */
  settledCardTotal: number;
  /** 이 달 판매·외상 수금과 이어진 입금 — 잘못 이었으면 되돌린다 (2026 감사 G3) */
  linked: { id: number; at: string; amount: number; payer: string; used: number; n: number }[];
  /** 「판매와 무관」으로 분류한 입금(이자·지원금·환불·기타) — 되돌리기 목록 (2026-08-26) */
  kinds: { id: number; at: string; amount: number; payer: string; category: string }[];
  /** 적요 패턴(FB자금·매출표)으로 카드 정산으로 보이는 미대조 입금 */
  cardPatternCount: number;
  cardPatternSum: number;
  doneCount: number;
  ignoredCount: number;
}

/**
 * ⭐ 정리할 입금 수 정본 (2026 감사 N2) — 현황 카드·마감 체크리스트·입금 화면이 이 하나를 쓴다.
 *   전엔 세 곳이 세 정의('미대조'만 / 미대조+제안·잔액>0 / LIMIT 60 의 length)였다.
 */
export async function depositOpenCount(ym: string): Promise<number> {
  const { start, nextStart } = monthRange(ym);
  const [r] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM cash_txn
    WHERE source = '통장' AND is_active AND in_amount > 0
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date
      AND recon_status IN ('미대조', '제안') AND category IS NULL AND NOT ${sql.raw(CARD_SETTLE_PATTERN_SQL)}
      AND in_amount > ${cashUsedSql("cash_txn")}
  `);
  return Number(r?.n ?? 0);
}

/** ⭐ 분류 안 된 지출 정본 (2026 감사 N3) — 건수와 합을 현황·체크리스트·지출 화면이 같이 쓴다 */
export async function expenseOpen(ym: string): Promise<{ n: number; sum: number }> {
  const { start, nextStart } = monthRange(ym);
  const [r] = await db.execute<{ n: number; s: string }>(sql`
    SELECT count(*)::int n, COALESCE(SUM(out_amount), 0)::bigint s FROM cash_txn
    WHERE is_active AND out_amount > 0 AND category IS NULL
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date
  `);
  return { n: Number(r?.n ?? 0), sum: Number(r?.s ?? 0) };
}

export async function depositReconData(ym: string): Promise<DepositReconData> {
  const { start, nextStart } = monthRange(ym); // 감사 L3: 월 경계 정본(lib/ym)
  const inMonth = sql`source = '통장' AND is_active AND in_amount > 0
    AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
    AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date`;
  // 카드 정산 패턴 — 정본은 expense-cats.CARD_SETTLE_PATTERN_SQL (감사 L1)
  const CARD_PAT = sql.raw(CARD_SETTLE_PATTERN_SQL);

  // ① 이 달 미대조 입금 (카드 정산 패턴은 따로 묶는다)
  const deps = await db.execute<{
    id: number; date: string; at: string; in_amount: number; description: string; l: string;
  }>(sql`
    SELECT id, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') date,
           to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at,
           (in_amount - ${cashUsedSql("cash_txn")})::int in_amount, description, account_label l
    FROM cash_txn
    WHERE ${inMonth} AND recon_status IN ('미대조', '제안') AND category IS NULL AND NOT ${CARD_PAT}
      -- 🔴 감사 B6(2026-08-25): 계산서에 일부 연결된 입금도 남은 금액으로 정리할 수 있게
      AND in_amount > ${cashUsedSql("cash_txn")}
    ORDER BY occurred_at DESC, id DESC LIMIT 60
  `);

  const pat = await db.execute<{ n: number; s: string }>(sql`
    SELECT count(*)::int n, COALESCE(SUM(in_amount), 0)::bigint s FROM cash_txn
    WHERE ${inMonth} AND recon_status = '미대조' AND category IS NULL AND ${CARD_PAT}
    -- 🔴 2025 감사 F5(2026-08-26): 이미 '카드정산'으로 분류된 줄까지 세어 2025-12에 147건 거짓 할 일
  `);

  // 🔴 사장님 지적(2026-08-26): 자동 분류(카드정산 백필)된 줄은 recon_status 가 미대조라 "정리됨 1건"으로 셌다
  const counts = await db.execute<{ st: string; n: number }>(sql`
    SELECT CASE WHEN recon_status = '무시' THEN '무시'
                WHEN recon_status = '확정' OR category IS NOT NULL THEN '확정'
                ELSE '열림' END st, count(*)::int n
    FROM cash_txn WHERE ${inMonth} GROUP BY 1 LIMIT 5
  `);

  /* ② 이을 만한 판매 (±3일 여유) — 🔴 사장님 요청(2026-08-26): 계좌이체로 적힌 판매만 보면
     MARS 이관분(1~7월, 수단이 카드·현금으로 적힘)은 후보가 안 떠 "무시하세요"로 몰렸다.
     같은 금액이면 수단 무관 후보로 올리고 수단을 라벨에 적는다 */
  const startPad = new Date(new Date(start + "T00:00:00Z").getTime() - 3 * 86400000).toISOString().slice(0, 10);
  const endPad = new Date(new Date(nextStart + "T00:00:00Z").getTime() + 3 * 86400000).toISOString().slice(0, 10);
  const transfers = await db.execute<{
    id: number; quote_no: string; total: number; d: string; who: string; plate_no: string | null; pm: string | null;
  }>(sql`
    SELECT q.id, q.quote_no, q.total_amount total,
           to_char(COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date), 'YYYY-MM-DD') d,
           COALESCE(q.supplier_name, c.name, '손님') who, v.plate_no, q.payment_method pm
    FROM quote q
    LEFT JOIN customer c ON c.id = q.customer_id
    LEFT JOIN vehicle  v ON v.id = q.vehicle_id
    WHERE q.status = '성사' AND q.total_amount > 0
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) >= ${startPad}::date
      AND COALESCE(q.work_date, (q.created_at AT TIME ZONE 'Asia/Seoul')::date) < ${endPad}::date
    ORDER BY q.id DESC LIMIT 800
  `);

  // ③ 이미 이은 판매는 후보에서 뺀다
  const linked = await db.execute<{ ref_id: number }>(sql`
    SELECT ref_id FROM recon_match WHERE kind = '이체입금' AND ref_table = 'quote' LIMIT 10000
  `);
  const linkedQ = new Set(linked.map((l) => Number(l.ref_id)));
  const freeTransfers = transfers.filter((q) => !linkedQ.has(Number(q.id)));

  // ④ 외상 대상 (잔액 있는 것만) — receivable-book 과 같은 정의를 그 모듈로 얻는다
  const { receivableBook } = await import("./receivable-book");
  const book = await receivableBook();

  // ⭐ 별명 사전 — 입금자명을 한 번 이어주면 다음부터 바로 알아본다
  const aliases2 = await db.execute<{ alias_key: string; party_key: string; party_label: string }>(sql`
    SELECT alias_key, party_key, party_label FROM party_alias LIMIT 10000
  `);
  const aliasMap = new Map(aliases2.map((a) => [a.alias_key, a.party_key]));
  const aliasLabel = new Map(aliases2.map((a) => [a.alias_key, a.party_label]));

  const dayDiff3 = (a: string, b: string) => Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000) <= 3;

  const open: DepositSuggestion[] = deps.map((r) => {
    // 「[적요] 내용」 → 내용 부분이 대개 입금자명이다
    const payerName = payerKeyOf("통장", r.description); // 감사 L2: 추출 규칙 정본
    const pn = norm(payerName);
    const quotes = freeTransfers
      .filter((q) => Number(q.total) === Number(r.in_amount) && dayDiff3(q.d, r.date))
      .map((q) => ({ q, nameOk: samePartyName(payerName, q.who) }))
      .sort((a, b) => Number(b.nameOk) - Number(a.nameOk))
      .slice(0, 5)
      .map(({ q, nameOk }) => ({
        quoteId: Number(q.id),
        label:
          `${nameOk ? "★ " : ""}${q.quote_no} · ${q.who}${q.plate_no ? ` ${q.plate_no}` : ""} · ${Number(q.total).toLocaleString()}원 (${q.d.slice(5)})` +
          (q.pm && q.pm !== "계좌이체" ? ` · 앱엔 ${q.pm}로 적힘` : ""),
        amount: Number(q.total),
        date: q.d,
        pm: q.pm,
        nameOk,
      }));
    const aliasParty = aliasMap.get(pn) ?? null;
    // 한 입금자가 여러 계산서 상대로 기억될 수 있다 (카랑 → 현대캐피탈·쏘카)
    const tLabels = [
      ...new Set(
        aliases2
          .filter((a) => a.party_key.startsWith("T:") && (a.alias_key === pn || a.alias_key.startsWith(pn + "@")))
          .map((a) => a.party_label),
      ),
    ];
    const taxHint = tLabels.length > 0 ? tLabels.join(" · ") : null;
    const aliasTarget =
      aliasParty && !aliasParty.startsWith("T:") ? (book.targets.find((tg) => tg.key === aliasParty) ?? null) : null;
    const parties = [
      ...(aliasTarget ? [aliasTarget] : []),
      ...book.targets.filter((tg) => {
        if (tg.kind === "walkin") return false; // 🔴 감사 L13: 비회원은 수금 등록이 안 되는 대상 — 후보에서 뺀다
        if (aliasTarget && tg.key === aliasTarget.key) return false;
        // 정본 매칭 — 적요 잘림·㈜ 표기 차이 견딤 (감사 C10, 2026-08-25)
        return samePartyName(tg.label.replace(/^거래처\s*/, ""), payerName);
      }),
    ]
      .slice(0, 3)
      .map((tg) => ({ key: tg.key, label: tg.label, remain: tg.remain, count: tg.count }));
    return {
      dep: {
        id: Number(r.id),
        date: r.date,
        at: r.at,
        amount: Number(r.in_amount),
        description: r.description,
        payerName,
        label: r.l,
      },
      quotes,
      parties,
      taxHint,
    };
  });

  const settledCardRows = await db.execute<{ id: number; at: string; in_amount: number; description: string }>(sql`
    SELECT id, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at, in_amount, description
    FROM cash_txn WHERE ${inMonth} AND category = '카드정산'
    ORDER BY occurred_at DESC LIMIT 40
  `);
  const [settledCnt] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM cash_txn WHERE ${inMonth} AND category = '카드정산'
  `);
  // 이 달 입금 중 판매·수금과 이어진 것 (recon_match 이체입금) — 되돌리기 목록
  const linkedRows = await db.execute<{ id: number; at: string; in_amount: number; description: string; used: string; n: number }>(sql`
    SELECT c.id, to_char(c.occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at, c.in_amount, c.description,
           SUM(m.amount)::bigint used, count(*)::int n
    FROM cash_txn c JOIN recon_match m ON m.src_table = 'cash_txn' AND m.src_id = c.id AND m.kind = '이체입금' AND m.status = '확정'
    WHERE c.source = '통장' AND c.is_active AND c.in_amount > 0
      AND (c.occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
      AND (c.occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date
    GROUP BY c.id ORDER BY c.occurred_at DESC LIMIT 40
  `);

  const openTotal = await depositOpenCount(ym);
  const [inCnt] = await db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM cash_txn WHERE ${inMonth}`);
  const kindRows = await db.execute<{ id: number; at: string; in_amount: number; description: string; category: string }>(sql`
    SELECT id, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at, in_amount, description, category
    FROM cash_txn WHERE ${inMonth} AND category IN ('판매입금', '이자·지원금', '환불', '기타입금')
    ORDER BY occurred_at DESC LIMIT 40
  `);

  return {
    open,
    openTotal,
    kinds: kindRows.map((r) => ({
      id: Number(r.id),
      at: r.at,
      amount: Number(r.in_amount),
      payer: payerKeyOf("통장", r.description),
      category: r.category,
    })),
    monthInCount: Number(inCnt?.n ?? 0),
    settledCardTotal: Number(settledCnt?.n ?? 0),
    linked: linkedRows.map((r) => ({
      id: Number(r.id),
      at: r.at,
      amount: Number(r.in_amount),
      payer: payerKeyOf("통장", r.description),
      used: Number(r.used),
      n: Number(r.n),
    })),
    settledCard: settledCardRows.map((r) => ({
      id: Number(r.id),
      at: r.at,
      amount: Number(r.in_amount),
      payer: payerKeyOf("통장", r.description),
    })),
    cardPatternCount: Number(pat[0]?.n ?? 0),
    cardPatternSum: Number(pat[0]?.s ?? 0),
    doneCount: counts.find((c) => c.st === "확정")?.n ?? 0,
    ignoredCount: counts.find((c) => c.st === "무시")?.n ?? 0,
  };
}

/* ================================================================== */
/* ERP ⑥ 경비 분류 (사장님 지시 2026-08-25)                             */

// 🔴 분류 상수는 expense-cats.ts (순수 모듈) — 클라이언트 화면이 값으로 쓰기 때문
//    (여기서 내보내면 DB 모듈이 브라우저 번들에 끌려가 빌드가 깨진다, 2026-08-25 실사고)

export interface ExpenseRow {
  id: number;
  source: string;
  label: string;
  at: string;
  amount: number;
  payer: string;
  description: string;
  category: string | null;
  /** 규칙 사전이 제안하는 분류 */
  suggest: string | null;
}

export interface ExpenseData {
  /** 분류 안 된 지출 (통장 출금 + 법인카드) — 금액 큰 것부터 */
  unclassified: ExpenseRow[];
  /** 🔴 감사 M5: 같은 상대끼리 묶음 — 한 번에 분류(한 건 분류=같은 상대 전파를 그대로 씀) */
  byPayer: { payer: string; n: number; sum: number; anyId: number; suggest: string | null }[];
  /** 분류된 지출(이 달) — 잘못 붙였으면 해제 (감사 H10 계열) */
  classified: ExpenseRow[];
  /** 화면에 보이는(금액 큰 80건) 합 */
  unclassifiedSum: number;
  /** 분류 안 된 지출 전체 합·건수 — 현황·체크리스트(expenseOpen)와 같은 값 */
  unclassifiedTotal: number;
  unclassifiedCount: number;
  /** 이 달 지출 줄 수(통장+카드) — 0이면 자료가 안 올라온 것 (2026 감사 R5) */
  monthOutCount: number;
  /** 이 달 분류별 지출 합 */
  sums: { category: string; amount: number; n: number }[];
}

export async function expenseData(ym: string): Promise<ExpenseData> {
  const { start, nextStart } = monthRange(ym); // 감사 L3: 월 경계 정본(lib/ym)
  const inMonth = sql`is_active AND out_amount > 0
    AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
    AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date`;

  const rules = await db.execute<{ key: string; category: string }>(sql`
    SELECT key, category FROM expense_rule LIMIT 5000
  `);
  const ruleMap = new Map(rules.map((r) => [r.key, r.category]));

  const rows = await db.execute<{
    id: number; source: string; l: string; at: string; out_amount: number; description: string;
  }>(sql`
    SELECT id, source, account_label l,
           to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at,
           out_amount, description
    FROM cash_txn
    WHERE ${inMonth} AND category IS NULL
    ORDER BY out_amount DESC, id DESC LIMIT 80
  `);
  const totalRow = await db.execute<{ s: string; n: number }>(sql`
    SELECT COALESCE(SUM(out_amount), 0)::bigint s, count(*)::int n FROM cash_txn
    WHERE ${inMonth} AND category IS NULL
  `);
  const sums = await db.execute<{ category: string; s: string; n: number }>(sql`
    SELECT category, COALESCE(SUM(out_amount), 0)::bigint s, count(*)::int n
    FROM cash_txn WHERE ${inMonth} AND category IS NOT NULL
    GROUP BY 1 ORDER BY 2 DESC LIMIT 20
  `);

  const unclassified = rows.map((r) => {
    const payer = payerKeyOf(r.source, r.description);
    return {
      id: Number(r.id),
      source: r.source,
      label: r.l,
      at: r.at,
      amount: Number(r.out_amount),
      payer,
      description: r.description,
      category: null,
      suggest: ruleMap.get(payer) ?? null,
    };
  });

  // 감사 M5 — 상대별 묶음 (전체 미분류 대상, LIMIT 없는 집계)
  const byPayerRows = await db.execute<{ p: string; n: number; s: string; any_id: number }>(sql`
    SELECT ${sql.raw(PAYER_KEY_SQL)} p, -- 정본 (감사 B2 → 2026 감사 G6 정본화)
           count(*)::int n, COALESCE(SUM(out_amount), 0)::bigint s, min(id)::int any_id
    FROM cash_txn WHERE ${inMonth} AND category IS NULL
    GROUP BY 1 ORDER BY 3 DESC LIMIT 60
  `);
  const byPayer = byPayerRows.map((r) => ({
    payer: r.p,
    n: Number(r.n),
    sum: Number(r.s),
    anyId: Number(r.any_id),
    suggest: ruleMap.get(r.p) ?? null,
  }));

  const [outCnt] = await db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM cash_txn WHERE ${inMonth}`);
  const classifiedRows = await db.execute<{
    id: number; source: string; l: string; at: string; out_amount: number; description: string; category: string;
  }>(sql`
    SELECT id, source, account_label l,
           to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI') at,
           out_amount, description, category
    FROM cash_txn
    WHERE ${inMonth} AND category IS NOT NULL
    ORDER BY occurred_at DESC LIMIT 40
  `);
  const classified = classifiedRows.map((r) => ({
    id: Number(r.id),
    source: r.source,
    label: r.l,
    at: r.at,
    amount: Number(r.out_amount),
    payer: payerKeyOf(r.source, r.description),
    description: r.description,
    category: r.category,
    suggest: null,
  }));

  return {
    unclassified,
    byPayer,
    classified,
    unclassifiedSum: unclassified.reduce((s, r) => s + r.amount, 0),
    unclassifiedTotal: Number(totalRow[0]?.s ?? 0),
    unclassifiedCount: Number(totalRow[0]?.n ?? 0),
    monthOutCount: Number(outCnt?.n ?? 0),
    sums: sums.map((r) => ({ category: r.category, amount: Number(r.s), n: Number(r.n) })),
  };
}

/* ================================================================== */
/* ERP ⑦ 미지급금 (사장님 지시 2026-08-25)                              */

export interface PayableInvoice {
  invoiceId: number;
  invoiceNo: string;
  d: string | null;
  total: number;
  paid: number;
  remain: number;
}

export interface PayableSupplier {
  supplier: string;
  count: number;
  total: number;
  paid: number;
  remain: number;
  oldestD: string | null;
  invoices: PayableInvoice[];
}

export interface PayablesData {
  suppliers: PayableSupplier[];
  totalRemain: number;
  /** 최근 지급 — 잘못 넣었으면 지운다 */
  recent: { id: number; supplier: string; invoiceNo: string; amount: number; method: string; paidOn: string }[];
}

/** 거래처별 미지급 장부 — 외상 장부(receivable-book)의 거울상 */
export async function payablesData(): Promise<PayablesData> {
  const rows = await db.execute<{
    id: number; supplier: string; invoice_no: string; d: string | null; total: number; paid: string;
  }>(sql`
    SELECT pi.id, pi.supplier, pi.invoice_no,
           COALESCE(pi.issued_at, to_char(pi.created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')) d,
           pi.total,
           COALESCE((SELECT SUM(pp.amount)::int FROM purchase_payment pp WHERE pp.invoice_id = pi.id), 0) paid
    FROM purchase_invoice pi
    WHERE pi.status <> '취소' AND pi.total IS NOT NULL AND pi.total > 0
    ORDER BY d ASC, pi.id ASC LIMIT 400
  `);

  const bySup = new Map<string, PayableSupplier>();
  for (const r of rows) {
    const total = Number(r.total);
    const paid = Number(r.paid);
    const remain = total - paid;
    let s = bySup.get(r.supplier);
    if (!s) {
      s = { supplier: r.supplier, count: 0, total: 0, paid: 0, remain: 0, oldestD: null, invoices: [] };
      bySup.set(r.supplier, s);
    }
    s.count++;
    s.total += total;
    s.paid += paid;
    s.remain += remain;
    if (remain > 0) {
      if (!s.oldestD) s.oldestD = r.d;
      if (s.invoices.length < 30) {
        s.invoices.push({
          invoiceId: Number(r.id),
          invoiceNo: r.invoice_no,
          d: r.d,
          total,
          paid,
          remain,
        });
      }
    }
  }
  const suppliers = [...bySup.values()].filter((s) => s.remain > 0).sort((a, b) => b.remain - a.remain);

  const recent = await db.execute<{
    id: number; supplier: string; invoice_no: string; amount: number; method: string; paid_on: string;
  }>(sql`
    SELECT pp.id, pi.supplier, pi.invoice_no, pp.amount, pp.method, to_char(pp.paid_on, 'YYYY-MM-DD') paid_on
    FROM purchase_payment pp JOIN purchase_invoice pi ON pi.id = pp.invoice_id
    ORDER BY pp.id DESC LIMIT 15
  `);

  // 🔴 감사 M8: 총액은 목록(400건)이 아니라 SQL 전체 집계로 — 첫 화면 「줄 돈」과 일치
  const [totalRow] = await db.execute<{ s: string }>(sql`
    SELECT COALESCE(SUM(pi.total - COALESCE(pp.paid, 0)), 0)::bigint s
    FROM purchase_invoice pi
    LEFT JOIN LATERAL (SELECT SUM(amount)::int paid FROM purchase_payment x WHERE x.invoice_id = pi.id) pp ON true
    WHERE pi.status <> '취소' AND pi.total IS NOT NULL AND pi.total > COALESCE(pp.paid, 0)
  `);

  return {
    suppliers,
    totalRemain: Number(totalRow.s),
    recent: recent.map((r) => ({
      id: Number(r.id),
      supplier: r.supplier,
      invoiceNo: r.invoice_no,
      amount: Number(r.amount),
      method: r.method,
      paidOn: r.paid_on,
    })),
  };
}

/* ================================================================== */
/* 감사 P2 — 「출금에서 지급 잡기」 후보 (2026-08-25)                     */

export interface PayLinkRow {
  id: number;
  at: string;
  payer: string;
  amount: number;
  /** 별명·이름으로 짐작한 거래처 (미지급 잔액 있는 것만) */
  suggest: { supplier: string; remain: number } | null;
}

export interface PayLinkedRow {
  id: number;
  at: string;
  payer: string;
  amount: number;
  /** 지급으로 배분된 합 */
  used: number;
  n: number;
}

export async function payLinkData(
  ym: string,
): Promise<{ rows: PayLinkRow[]; supplierNames: string[]; linked: PayLinkedRow[] }> {
  // '매입대금' 출금 중 지급 기록과 안 이어진 것 — 보는 달 (2025 감사 F18: '2026-08-01' 하드코딩 폐지)
  const { start: pStart, nextStart: pNext } = monthRange(ym);
  const outs = await db.execute<{ id: number; at: string; description: string; out_amount: number }>(sql`
    SELECT c.id, to_char(c.occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') at, c.description,
           (c.out_amount - ${cashUsedSql("c")})::int out_amount
    FROM cash_txn c
    WHERE c.source = '통장' AND c.is_active AND c.category = '매입대금'
      AND (c.occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${pStart}::date
      AND (c.occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${pNext}::date
      -- 🔴 감사 B4(2026-08-25): 계산서 확인·지급이 이미 쓴 몫을 뺀 잔액만 — 이중 소진 차단
      AND c.out_amount > ${cashUsedSql("c")}
    ORDER BY c.occurred_at DESC LIMIT 60
  `);
  // 거래처별 미지급 잔액
  const remains = await db.execute<{ supplier: string; remain: string }>(sql`
    SELECT pi.supplier, SUM(pi.total - COALESCE(pp.paid, 0))::bigint remain
    FROM purchase_invoice pi
    LEFT JOIN LATERAL (SELECT SUM(amount)::int paid FROM purchase_payment x WHERE x.invoice_id = pi.id) pp ON true
    WHERE pi.status <> '취소' AND pi.total IS NOT NULL AND pi.total > COALESCE(pp.paid, 0)
    GROUP BY 1 LIMIT 100
  `);
  const remainMap = new Map(remains.map((r) => [r.supplier, Number(r.remain)]));
  const aliases3 = await db.execute<{ alias_key: string; party_key: string }>(sql`
    SELECT alias_key, party_key FROM party_alias WHERE party_key LIKE 'S:%' LIMIT 10000
  `);
  const aliasMap3 = new Map(aliases3.map((a) => [a.alias_key, a.party_key.slice(2)]));
  // 🔴 C10(2026-08-25): 지급출금 별명(T:) → 사업자번호 → 거래처 — 「콘티_(주)싸이」 제안의 열쇠
  const tAliases = await db.execute<{ alias_key: string; party_key: string }>(sql`
    SELECT alias_key, party_key FROM party_alias WHERE party_key LIKE 'T:%' LIMIT 10000
  `);
  const supByBiz = await db.execute<{ name: string; biz_no: string }>(sql`
    SELECT name, biz_no FROM supplier WHERE biz_no IS NOT NULL AND is_active LIMIT 500
  `);
  const bizToSup = new Map(supByBiz.map((s2) => [s2.biz_no.replace(/\D/g, ""), s2.name]));
  const tMap = new Map<string, string>();
  for (const a of tAliases) {
    const nm = a.alias_key.split("@")[0];
    const sup2 = bizToSup.get(a.party_key.slice(2));
    if (nm && sup2) tMap.set(nm, sup2);
  }

  const rows: PayLinkRow[] = outs.map((o) => {
    const payer = payerKeyOf("통장", o.description);
    const pn = normName(payer);
    let sup = aliasMap3.get(pn) ?? tMap.get(pn) ?? null;
    if (!sup || !remainMap.has(sup)) {
      // 정본 매칭 — 적요 잘림(「(주)맥스런」)·표기 차이를 견딘다
      sup = [...remainMap.keys()].find((name) => samePartyName(name, payer)) ?? null;
    }
    return {
      id: Number(o.id),
      at: o.at,
      payer,
      amount: Number(o.out_amount),
      suggest: sup && remainMap.has(sup) ? { supplier: sup, remain: remainMap.get(sup)! } : null,
    };
  });
  // ⭐ 재설계(2026-08-25): 지급 잡기 datalist용 거래처 이름 — taxPayableData 대체 준비
  const names = await db.execute<{ s: string }>(sql`
    SELECT DISTINCT supplier s FROM purchase_invoice WHERE status <> '취소' ORDER BY 1 LIMIT 100
  `);
  // 이 달 「지급 잡기」로 이은 출금 — 되돌리기 목록 (2026 감사 G2)
  const linkedRows = await db.execute<{ id: number; at: string; out_amount: number; description: string; used: string; n: number }>(sql`
    SELECT c.id, to_char(c.occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') at, c.out_amount, c.description,
           SUM(m.amount)::bigint used, count(*)::int n
    FROM cash_txn c JOIN recon_match m ON m.src_table = 'cash_txn' AND m.src_id = c.id AND m.kind = '매입지급' AND m.status = '확정'
    WHERE c.source = '통장' AND c.is_active AND c.out_amount > 0
      AND (c.occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${pStart}::date
      AND (c.occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${pNext}::date
    GROUP BY c.id ORDER BY c.occurred_at DESC LIMIT 40
  `);
  return {
    rows,
    supplierNames: names.map((r) => r.s),
    linked: linkedRows.map((r) => ({
      id: Number(r.id),
      at: r.at,
      payer: payerKeyOf("통장", r.description),
      amount: Number(r.out_amount),
      used: Number(r.used),
      n: Number(r.n),
    })),
  };
}

/* ================================================================== */
/* ⭐ 통장 줄 소진량 정본 (tax 재설계 2026-08-25) — 이중계상 차단
 *
 *   recon_match 에서 cash_txn 의 방향이 kind 마다 다르다:
 *     매입계산서·매출계산서 = ref (계산서가 src)
 *     매입지급·이체입금     = src (지급 잡기·외상 수금이 쓴 몫)
 *   양방향을 다 세야 지급 잡기로 이미 쓴 출금이 계산서 후보에
 *   전액 남은 것처럼 되살아나지 않는다 (리뷰 C1). 전부 status='확정'만. */

export async function cashUsedMap(ids?: number[]): Promise<Map<number, number>> {
  const f1 = ids && ids.length > 0 ? sql`AND ref_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})` : sql``;
  const f2 = ids && ids.length > 0 ? sql`AND src_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})` : sql``;
  const rows = await db.execute<{ cash_id: number; used: string }>(sql`
    SELECT cash_id, SUM(amount)::bigint used FROM (
      SELECT ref_id cash_id, amount FROM recon_match
       WHERE ref_table = 'cash_txn' AND kind IN ('매입계산서', '매출계산서') AND status = '확정' ${f1}
      UNION ALL
      SELECT src_id, amount FROM recon_match
       WHERE src_table = 'cash_txn' AND kind IN ('매입지급', '이체입금') AND status = '확정' ${f2}
    ) x GROUP BY 1 LIMIT 20000
  `);
  return new Map(rows.map((r) => [Number(r.cash_id), Number(r.used)]));
}

/** 위와 같은 식의 SQL 조각 — 상관 서브쿼리용 (searchBankLines 등) */
export const cashUsedSql = (alias: string) => sql`
  COALESCE((SELECT SUM(m.amount)::bigint FROM recon_match m
    WHERE m.status = '확정' AND (
      (m.ref_table = 'cash_txn' AND m.ref_id = ${sql.raw(alias)}.id AND m.kind IN ('매출계산서', '매입계산서'))
      OR (m.src_table = 'cash_txn' AND m.src_id = ${sql.raw(alias)}.id AND m.kind IN ('매입지급', '이체입금'))
    )), 0)`;
