/**
 * ⭐ 입금 정리 코어 (2026-08-26) — 화면(fin-deposits 서버 액션)과 연간 실행기가 같은 함수를 쓴다.
 * 🔴 "use server" 아님. 권한 검사 없음 — 부르는 쪽이 책임진다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { CARD_SETTLE_PATTERN_SQL, payerKeyOf } from "./expense-cats";
import { monthRange } from "./ym";
import { cashUsedSql, depositReconData, normName } from "./recon-data";
/* 🔴 deposit-tax 가 이 파일의 taxChainCoveredSql 을 import 한다(순환) — 그쪽은 함수 안에서만 쓰고
   여기도 함수 안에서만 부르므로 모듈 평가 순서에 안 걸린다 (2026-09-12) */
import { depositSurePicks, depositTaxCandidates } from "./deposit-tax";
import { logActivity } from "./fin-activity";
import { howOfMethod, type ActivityEntry, type UndoItem } from "./fin-activity-types";
import { activityItems, confirmBankToTaxesCore, confirmTaxToBankCore, type ActivityOpts } from "./recon-core";
import { autoReconLabel, W } from "./fin-words";

const won = (n: number) => n.toLocaleString("ko-KR");

/**
 * ⭐ 「계산서 경유로 돈 확인됨」 판정 정본 (사장님 제보 2026-09-04 — 신형호/신아건설)
 *
 *   돈이 회사 이름으로 와서 판매↔입금 직결은 없지만,
 *   판매 ↔ 매출계산서 ↔ 통장입금 사슬이 recon_match 에 확정으로 완성돼 있으면
 *   그 판매의 돈은 확인이 끝난 것이다.
 *
 * 🔴 쿼리에서 quote 별칭이 **q** 여야 한다.
 *    쓰는 곳: a1OpenTransfers(감사 A1·홈 인박스·돈 추적 목록) ·
 *    transferSalesMissing(입금 화면 「짝 못 찾은 판매」).
 *    money-trace 의 판매 카드는 같은 사슬을 자체 표기(tax_cashok)로 이미 본다 —
 *    거기는 「계산서 경로로 돈 확인됨」 글자에 count 가 필요해서 이 조각을 못 쓴다.
 */
export const taxChainCoveredSql = sql`EXISTS (SELECT 1 FROM recon_match mq
  JOIN recon_match mc ON mc.kind = '매출계산서' AND mc.src_table = 'tax_invoice'
    AND mc.src_id = mq.src_id AND mc.ref_table = 'cash_txn' AND mc.status = '확정'
  WHERE mq.kind = '매출계산서' AND mq.src_table = 'tax_invoice'
    AND mq.ref_table = 'quote' AND mq.ref_id = q.id AND mq.status = '확정')`;

/**
 * ⭐ 이름 별명 학습 정본 (사장님 요청 2026-08-24; 개편 4단계 2026-09-12 에 스위치·기록 추가)
 *
 *   한 번 이어준 입금자명은 다음부터 바로 알아본다. 전에는 **여섯 곳이 같은 INSERT 를 손으로
 *   복제**하고 있었고 전부 「조용히·무조건」이라, 사장님이 「이번만 맞추고 규칙은 안 배우기」를
 *   고를 길이 없었다(결정 7③ 「☑ 다음부터 자동으로」, 기본 켜짐).
 *
 *   · learn === false  → 아무것도 안 한다 (체크를 끈 것)
 *   · 값이 이미 같으면 → 아무것도 안 한다 (같은 상대를 열 번 맞춰도 규칙 줄은 한 줄)
 *   · 새로 배우거나 바뀌었을 때만 「최근 한 일」에 규칙 한 줄 — 되돌리기 = 그 규칙 끄기(ruleOff)
 *   · quiet           → 규칙 줄 생략 (일괄이 한 줄로 접거나, 부르는 쪽이 제 규칙 줄을 이미 남길 때)
 *   · keyOverride     → 계산서 상대(T:)는 열쇠가 「이름@사업자번호」다
 *
 * 🔴 **트랜잭션 밖**에서 부른다 (recon-core.ts:172 원칙) — 학습 실패가 본 일을 되돌리면 안 되고,
 *    잠금을 오래 붙들지도 않는다.
 */
export async function learnAlias(
  aliasRaw: string,
  partyKey: string,
  partyLabel: string,
  opts: { uid?: number | null; learn?: boolean; quiet?: boolean; keyOverride?: string } = {},
): Promise<void> {
  if (opts.learn === false) return;
  if (normName(aliasRaw).length < 2) return;
  const key = opts.keyOverride ?? normName(aliasRaw);
  try {
    /* 이미 같은 값이면 아무것도 안 한다 — updated_at 만 바뀌는 「배운 날」 되밀림도 막는다 */
    const [prev] = await db.execute<{ party_key: string; party_label: string }>(sql`
      SELECT party_key, party_label FROM party_alias WHERE alias_key = ${key}
    `);
    if (prev && prev.party_key === partyKey && prev.party_label === partyLabel) return;
    await db.execute(sql`
      INSERT INTO party_alias (alias_key, alias_raw, party_key, party_label)
      VALUES (${key}, ${aliasRaw}, ${partyKey}, ${partyLabel})
      ON CONFLICT (alias_key) DO UPDATE SET party_key = EXCLUDED.party_key,
        party_label = EXCLUDED.party_label, updated_at = now()
    `);
    if (!opts.quiet) {
      await logActivity({
        actor: opts.uid ?? null,
        how: "사람",
        verb: "규칙",
        label: `${W.ruleSaved}: 통장 이름 「${aliasRaw}」 = ${partyLabel}`,
        undo: { kind: "ruleOff", args: { ruleKind: "alias", key } },
      });
    }
  } catch {
    // 학습 실패는 본 동작을 막지 않는다
  }
}

/**
 * ⭐ 입금 성격 목록 정본 (2026-09-12 개편 4단계에 fin-deposits 에서 옮김)
 *
 *   전엔 fin-deposits.ts 안의 모듈 상수라 다른 곳이 못 읽었다 — 그 파일은 "use server" 여서
 *   상수를 내보낼 수 없다(서버 액션 파일은 async 함수만 내보낸다). deposit_rule 표의 CHECK 값과
 *   「자동 규칙」 화면의 검사가 같은 목록을 봐야 하므로 코어로 옮긴다.
 * 🔴 scripts/add-deposit-rule.ts 의 CHECK 와 같은 네 값이어야 한다.
 */
export const DEPOSIT_KINDS = ["판매입금", "이자·지원금", "환불", "기타입금"] as const;

/**
 * ⭐ 입금 성격 규칙 학습 정본 (개편 4단계, 2026-09-12 — 사장님 결정 7③)
 *
 *   지금까지 setDepositKind 는 **그 줄만** 고치고 입금자를 안 외웠다. 그래서 같은 상대가
 *   다음 달에 또 들어와도 사장님이 처음부터 성격을 고르셔야 했다(계획서 §1-1).
 *
 * 🔴 **과거분 일괄 적용은 안 한다.** 입금은 판매와 이어질 수 있어, 조용히 「판매입금」으로
 *    확정해 버리면 나중에 정비내역을 등록해도 후보에서 빠진다 — 다음 자료부터만 붙인다
 *    (소비는 expense-core.applyAutoCategories 의 ①′ 단계).
 * 🔴 learnAlias 와 같은 규칙: learn===false 면 안 배우고, 값이 같으면 아무것도 안 하고,
 *    새로 배우거나 바뀔 때만 규칙 한 줄(되돌리기 = 그 규칙 끄기).
 */
export async function learnDepositRule(
  payerKey: string,
  kind: string,
  opts: { uid?: number | null; learn?: boolean; quiet?: boolean } = {},
): Promise<void> {
  if (opts.learn === false) return;
  const key = (payerKey ?? "").trim();
  if (key.length < 2) return;
  if (!(DEPOSIT_KINDS as readonly string[]).includes(kind)) return;
  try {
    const [prev] = await db.execute<{ kind: string }>(sql`
      SELECT kind FROM deposit_rule WHERE key = ${key}
    `);
    if (prev?.kind === kind) return;
    await db.execute(sql`
      INSERT INTO deposit_rule (key, kind) VALUES (${key}, ${kind})
      ON CONFLICT (key) DO UPDATE SET kind = EXCLUDED.kind, updated_at = now()
    `);
    if (!opts.quiet) {
      await logActivity({
        actor: opts.uid ?? null,
        how: "사람",
        verb: "규칙",
        label: `${W.ruleSaved}: 입금자 「${key}」 = ${kind}`,
        undo: { kind: "ruleOff", args: { ruleKind: "deposit", key } },
      });
    }
  } catch {
    // 학습 실패는 본 동작(성격 고르기)을 막지 않는다 — learnAlias 와 같은 정신
  }
}

/* 🔴 2026 감사 G1: 입금 줄은 **남은 금액**(소진량 정본 cashUsedSql 을 뺀 값)으로 다룬다 */
export async function getDeposit(id: number) {
  const [d] = await db.execute<{
    id: number; in_amount: number; remain: number; recon_status: string; category: string | null; date: string; l: string; description: string;
  }>(sql`
    SELECT c.id, c.in_amount, (c.in_amount - ${cashUsedSql("c")})::bigint remain, c.recon_status, c.category,
           to_char(c.occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') date,
           c.account_label l, c.description
    FROM cash_txn c WHERE c.id = ${id} AND c.source = '통장' AND c.is_active AND c.in_amount > 0
  `);
  return d ? { ...d, in_amount: Number(d.in_amount), remain: Number(d.remain) } : null;
}

/** 이 달의 카드 정산 패턴 입금(FB자금·매출표·카드사 코드)을 한꺼번에 「카드 정산」으로 */
export async function markCardSettlementsCore(ym: string, uid: number | null = null): Promise<number> {
  const { start, nextStart } = monthRange(ym);
  const rows = await db.execute<{ id: number; in_amount: number; d: string }>(sql`
    UPDATE cash_txn SET recon_status = '확정', category = '카드정산'
    WHERE source = '통장' AND is_active AND in_amount > 0 AND recon_status = '미대조' AND category IS NULL
      AND ${sql.raw(CARD_SETTLE_PATTERN_SQL)}
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date >= ${start}::date
      AND (occurred_at AT TIME ZONE 'Asia/Seoul')::date < ${nextStart}::date
    RETURNING id, in_amount, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'MM-DD') d
  `);
  /* ⭐ 최근 한 일 — 패턴 일괄은 「자동」(결정 g). 건별 되돌리기 = unmarkCardSettlement(cashTxnId) */
  if (rows.length > 0) {
    const items: UndoItem[] = rows.map((r) => ({
      kind: "cardSettle",
      args: { cashTxnId: Number(r.id) },
      label: `${r.d} 입금 ${won(Number(r.in_amount))} → 카드정산`,
      amount: Number(r.in_amount),
    }));
    await logActivity({
      ym,
      actor: uid,
      how: "자동",
      verb: "분류",
      n: rows.length,
      amount: rows.reduce((s, r) => s + Number(r.in_amount), 0),
      label: `분류 → 카드정산 (입금 ${rows.length}건, ${ym})`,
      undo: { kind: "bulk", args: { items } },
    });
  }
  return rows.length;
}

/** 입금 한 건 ↔ 판매 한 건 (부분 연결 가능 — 나눠 받은 판매). 잇는 순간 입금자명을 배운다 */
export async function linkDepositToQuoteCore(
  cashTxnId: number,
  quoteId: number,
  uid: number | null,
  method: "수동" | "자동" = "수동",
  opts: ActivityOpts = {},
): Promise<{ ok: true; activity?: ActivityEntry } | { ok: false; error: string }> {
  const dep = await getDeposit(cashTxnId);
  if (!dep) return { ok: false, error: "입금 줄을 찾을 수 없습니다" };
  if (dep.remain <= 0) return { ok: false, error: `이 입금은 남은 금액이 없습니다 — ${W.reconTax}가 이미 썼습니다` };
  /* 🔴 「판매입금」(앱에 기록 없는 판매 대금)으로 분류해 두면 recon_status 가 '확정'이 된다.
        그런데 화면은 그 줄을 **일부러 후보에 넣는다** — 나중에 정비내역을 등록하면 잇게 하려고
        (deposit-tax.ts 의 「염대현 425,000·110,000」 주석이 바로 그 사례다).
        전에는 여기서 「이미 정리된 입금입니다」로 막혀 **버튼을 눌러도 아무 일도 안 났다**
        (사장님 제보 2026-08-29, /finance/deposits?ym=2026-07 · MARS-002944 염대현 535,000원).
        → 손으로 이을 때는 통과시키고, 아래 UPDATE 가 category 를 지워 손익에 두 번 안 잡히게 한다.
        🔴 자동(연간 실행기)은 그대로 막는다 — 사장님이 손수 분류해 둔 것을 기계가 뒤집으면 안 된다. */
  /* ⭐ 「기타입금」도 손으로는 이을 수 있다 (사장님 제보 2026-09-11 — 김승래 예약금 10만원이 8/19 먼저 들어와
        판매가 없던 때 「기타입금」으로 정리됐고, 8/21 판매를 등록하자 후보에서 빠져 「안 들어온 이체」로 남았다).
        판매입금과 같은 이치 — 잇는 순간 아래 UPDATE 가 분류를 지운다. */
  const RELINKABLE = ["판매입금", "기타입금"];
  if (dep.recon_status === "확정" && !(method === "수동" && dep.category && RELINKABLE.includes(dep.category))) {
    return {
      ok: false,
      error:
        dep.category && RELINKABLE.includes(dep.category)
          ? `「${dep.category}」으로 분류해 둔 줄입니다 — 화면에서 손으로 ${W.recon}해 주세요`
          : `이미 정리된 입금입니다${dep.category ? ` (${dep.category})` : ""} — 먼저 되돌려 주세요`,
    };
  }
  const [q] = await db.execute<{ id: number; total: number; linked: string }>(sql`
    SELECT q.id, q.total_amount total,
           COALESCE((SELECT SUM(m.amount) FROM recon_match m WHERE m.kind = '이체입금' AND m.ref_table = 'quote' AND m.ref_id = q.id AND m.status = '확정'), 0)::bigint linked
    FROM quote q WHERE q.id = ${quoteId} AND q.status = '성사'
  `);
  if (!q) return { ok: false, error: "판매를 찾을 수 없습니다" };
  const remainQ = Number(q.total) - Number(q.linked);
  if (remainQ <= 0) return { ok: false, error: `그 판매는 이미 금액이 다 ${W.recon}돼 있습니다` };
  const linkAmt = Math.min(dep.remain, remainQ);
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO recon_match (kind, src_table, src_id, ref_table, ref_id, amount, status, method, confirmed_by, confirmed_at)
      VALUES ('이체입금', 'cash_txn', ${cashTxnId}, 'quote', ${quoteId}, ${linkAmt}, '확정', ${method}, ${uid}, now())
    `);
    await tx.execute(sql`
      UPDATE cash_txn SET recon_status = ${linkAmt === dep.remain ? "확정" : "제안"},
             category = CASE WHEN category IN ('판매입금', '기타입금') THEN NULL ELSE category END
      WHERE id = ${cashTxnId}
    `);
  });
  const [qp] = await db.execute<{ supplier_name: string | null; customer_id: number | null; cname: string | null; quote_no: string }>(sql`
    SELECT q.supplier_name, q.customer_id, c.name cname, q.quote_no
    FROM quote q LEFT JOIN customer c ON c.id = q.customer_id WHERE q.id = ${quoteId}
  `);
  const payer = payerKeyOf("통장", dep.description);
  /* ⭐ 「다음부터 자동으로」 (개편 4단계, 2026-09-12) — 체크를 끄면 learn:false 로 와서 안 배운다.
     🔴 트랜잭션 밖이다(위 커밋 뒤). 일괄(quiet)이면 규칙 줄도 접는다 */
  const learnOpts = { uid, learn: opts.learn, quiet: opts.quiet };
  if (qp?.supplier_name) await learnAlias(payer, `S:${qp.supplier_name}`, `거래처 ${qp.supplier_name}`, learnOpts);
  else if (qp?.customer_id) await learnAlias(payer, `C:${qp.customer_id}`, qp.cname ?? `고객 ${qp.customer_id}`, learnOpts);
  /* ⭐ 최근 한 일 — 커밋 뒤. 되돌리기 = undoDepositLink(cashTxnId) (그 입금의 판매 연결 전부를 푼다) */
  const activity: ActivityEntry = {
    ym: dep.date.slice(0, 7),
    actor: uid,
    how: howOfMethod(method),
    verb: "대사",
    target: { table: "cash_txn", id: cashTxnId },
    amount: linkAmt,
    label: `입금 ${won(linkAmt)} ${payer} ↔ ${qp?.quote_no ?? `#${quoteId}`} ${qp?.supplier_name ?? qp?.cname ?? ""} 판매`.replace(/\s+/g, " ").trim(),
    undo: { kind: "deposit", args: { cashTxnId } },
  };
  if (!opts.quiet) await logActivity(activity);
  return { ok: true, activity };
}

/**
 * ⭐ 짝이 확실한 입금 모두 잇기 — 코어 (사장님 요청 2026-08-26, 3단계 2026-09-12 에 fin-deposits 에서 옮김)
 *
 *   정확 일치 + 아는 상대 하나뿐인 계산서 / 묶음 / 이름 맞는 판매 하나뿐인 것. 🔴 서버가 같은 규칙
 *   (depositSurePicks)으로 **다시 계산한다** — 화면 목록을 믿지 않는다.
 *   · ids 를 주면(「이번 주 정리」 흐름의 체크) 그중 **재계산 맵에 있는 것만** 잇고, 없는 것은 skipped
 *     (화면이 열려 있던 사이 짝이 바뀐 것 — 조용히 건너뛴다). ids 없이 부르면 전과 동작이 같다.
 *   · 낱장은 quiet, 끝에 bulk 한 줄(how 자동·verb 대사, 결정 g) — 되돌리기는 「최근 한 일」에서 건별.
 *   🔴 recon_match.method 는 전과 같이 기본값(수동).
 */
export async function confirmSureDepositsCore(
  ym: string,
  uid: number | null,
  ids?: number[],
  /** ⭐ learn 만 본다 — 낱장 기록은 어차피 quiet(아래 한 줄로 접는다). 기본은 배움(결정 7③) */
  opts: ActivityOpts = {},
): Promise<{ ok: true; tax: number; quote: number; failed: number; skipped: number }> {
  const data = await depositReconData(ym);
  const { cands, bundles } = await depositTaxCandidates(
    ym,
    data.open.map((s) => ({ id: s.dep.id, date: s.dep.date, amount: s.dep.amount, payerName: s.dep.payerName })),
  );
  const sure = depositSurePicks(data.open, cands, bundles);
  let picked = [...sure.entries()];
  let skipped = 0;
  if (ids) {
    const want = new Set(ids.filter((n) => Number.isInteger(n) && n > 0));
    picked = picked.filter(([cashId]) => want.has(cashId));
    skipped = want.size - picked.length;
  }
  let tax = 0;
  let quote = 0;
  let failed = 0;
  const items: UndoItem[] = [];
  for (const [cashId, pick] of picked) {
    /* 🔴 recon_match.method 는 전과 같이 기본값(수동) — 기록만 quiet 로 모아 아래서 한 줄 n건(how 자동, 결정 g) */
    const sub: ActivityOpts = { quiet: true, learn: opts.learn };
    const r =
      pick.kind === "tax"
        ? await confirmTaxToBankCore(pick.invId, cashId, uid, "수동", sub)
        : pick.kind === "bundle"
          ? await confirmBankToTaxesCore(cashId, pick.invoiceIds, uid, "수동", sub)
          : await linkDepositToQuoteCore(cashId, pick.quoteId, uid, "수동", sub);
    if (!r.ok) failed++;
    else {
      if (pick.kind === "quote") quote++;
      else tax++;
      items.push(...activityItems(r.activity));
    }
  }
  if (items.length > 0) {
    await logActivity({
      ym,
      actor: uid,
      how: "자동",
      verb: "대사",
      n: items.length,
      amount: items.reduce((s, i) => s + (i.amount ?? 0), 0),
      label: `${autoReconLabel(items.length)} · 입금 ${ym} (계산서 ${tax}·판매 ${quote}${failed > 0 ? `·실패 ${failed}` : ""})`,
      undo: { kind: "bulk", args: { items } },
    });
  }
  return { ok: true, tax, quote, failed, skipped };
}

export async function linkDepositsToQuoteCore(
  quoteId: number,
  cashTxnIds: number[],
  uid: number | null,
  method: "수동" | "자동" = "수동",
  opts: ActivityOpts = {},
): Promise<{ ok: true; applied: number; activity?: ActivityEntry } | { ok: false; error: string }> {
  const ids = [...new Set((cashTxnIds ?? []).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 8);
  if (ids.length === 0) return { ok: false, error: `${W.recon}할 입금을 골라 주세요` };
  let applied = 0;
  const items: UndoItem[] = [];
  let ym: string | null = null;
  for (const id of ids) {
    const r = await linkDepositToQuoteCore(id, quoteId, uid, method, { quiet: true, learn: opts.learn });
    if (!r.ok) return applied === 0 ? r : { ok: false, error: `${applied}줄까지 ${W.recon}했고 그다음에서 멈췄습니다 — ${r.error}` };
    applied++;
    items.push(...activityItems(r.activity));
    ym ??= r.activity?.ym ?? null;
  }
  /* ⭐ 최근 한 일 — 입금 줄마다 되돌리기(items), 한 줄 n건 */
  const activity: ActivityEntry =
    items.length === 1
      ? { ym, actor: uid, how: howOfMethod(method), verb: "대사", target: { table: "quote", id: quoteId }, amount: items[0].amount ?? null, label: items[0].label, undo: { kind: items[0].kind, args: items[0].args } }
      : {
          ym,
          actor: uid,
          how: howOfMethod(method),
          verb: "대사",
          target: { table: "quote", id: quoteId },
          n: items.length,
          amount: items.reduce((s, i) => s + (i.amount ?? 0), 0),
          label: `입금 ${items.length}줄 ↔ 판매 한 건 ${W.recon} (나눠 받음)`,
          undo: { kind: "bulk", args: { items } },
        };
  if (!opts.quiet) await logActivity(activity);
  return { ok: true, applied, activity };
}
