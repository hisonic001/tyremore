/**
 * 지출 전 기간 학습 — 규칙 사전 채우기 + 적요 규칙표 적용 (사장님 지시 2026-08-27)
 *
 *   npx tsx -r dotenv/config scripts/learn-expenses-20260827.ts [--apply]
 *
 *   "다른 달들의 지출들을 전부 학습해보고 지출 종류와 제안을 업데이트해줘."
 *
 * ── 조사로 밝혀진 것 (2025-01~2026-08 지출 1,647건 28.4억) ──────────────
 * 미분류 564건 4.16억의 원인은 **분류 종류가 모자라서가 아니었다.**
 *   ① 사장님이 이미 분류한 상대가 규칙 사전(expense_rule)에 안 들어가 있었다.
 *      40상대가 그랬고, **같은 상대가 두 분류로 갈린 적은 0건**이라 그대로 배워도 안전하다.
 *   ② 통장 적요 머리표가 이미 분류를 알려주는데 아무도 안 읽고 있었다
 *      (`[유동CC]` 313건 전부 내부이체 · `[BZ수수]` 43건 전부 500원 이체수수료 …).
 *   ③ 같은 상대가 여러 이름으로 흩어져 있었다 (한화생명NNNN 15건 · 조판용/조판용급여/조판용 월급).
 *
 * ── 이 스크립트가 하는 일 ────────────────────────────────────────
 *   1단계  이미 분류된 상대를 규칙 사전에 넣는다 (사장님이 정한 것 = 정답)
 *   2단계  전 기간에 자동 분류를 다시 돌린다 (규칙 사전 + 적요 규칙표)
 *   3단계  남은 것을 보고한다
 *
 * 🔴 **이미 붙어 있는 분류는 절대 안 건드린다** (`category IS NULL` 조건).
 *    사장님이 손으로 정한 것이 언제나 이긴다.
 * 🔴 자동으로 붙은 것은 화면에서 언제든 해제된다 (분류된 지출 → 해제).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { DESC_RULES, PAYER_KEY_SQL } from "@/lib/expense-cats";
import { applyAutoCategories } from "@/lib/expense-core";
import { readPayer } from "@/lib/payer-name";

const APPLY = process.argv.includes("--apply");
const K = sql.raw(PAYER_KEY_SQL);

/** 2025-01 부터 이번 달까지 */
function months(): string[] {
  const out: string[] = [];
  for (let y = 2025; y <= 2026; y++)
    for (let m = 1; m <= 12; m++) {
      const ym = `${y}-${String(m).padStart(2, "0")}`;
      if (ym <= "2026-08") out.push(ym);
    }
  return out;
}

async function snapshot(tag: string) {
  const [r] = await db.execute<{ n: number; s: string; un: number; us: string }>(sql`
    SELECT count(*)::int n, SUM(out_amount)::bigint s,
           count(*) FILTER (WHERE category IS NULL)::int un,
           COALESCE(SUM(out_amount) FILTER (WHERE category IS NULL),0)::bigint us
    FROM cash_txn WHERE is_active AND out_amount > 0`);
  console.log(`${tag}: 지출 ${r.n}건 중 미분류 ${r.un}건 ${Number(r.us).toLocaleString()}원`);
  return { un: Number(r.un), us: Number(r.us) };
}

async function main() {
  console.log(APPLY ? "■ 실제 반영\n" : "■ 미리보기 (--apply 를 붙여야 실제로 바뀝니다)\n");
  const before = await snapshot("시작");

  /* ────────────────────────────────────────────────────────────
   * 1단계 — 이미 분류된 상대를 규칙 사전에 넣는다
   * ────────────────────────────────────────────────────────── */
  console.log("\n── 1단계 · 사장님이 이미 정한 분류를 규칙으로 배운다 ──");
  const learn = await db.execute<{ p: string; c: string; n: number; s: string }>(sql`
    SELECT ${K} p, category c, count(*)::int n, SUM(out_amount)::bigint s
    FROM cash_txn t WHERE t.is_active AND t.out_amount > 0 AND t.category IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM expense_rule r WHERE r.key = ${K})
    GROUP BY 1, 2 ORDER BY 4 DESC`);

  /* 🔴 한 상대가 두 분류로 갈렸으면 배우면 안 된다 — 조사에선 0건이었지만 매번 확인한다 */
  const seen = new Map<string, string>();
  const conflict: string[] = [];
  for (const l of learn) {
    const had = seen.get(l.p);
    if (had && had !== l.c) conflict.push(`${l.p}: ${had} / ${l.c}`);
    else seen.set(l.p, l.c);
  }
  if (conflict.length > 0) {
    console.log(`  ✖ 두 분류로 갈린 상대 ${conflict.length}개 — 배우지 않고 건너뜁니다`);
    conflict.forEach((c) => console.log(`     ${c}`));
  }

  const ok = learn.filter((l) => !conflict.some((c) => c.startsWith(l.p + ":")));
  console.log(`  규칙으로 배울 상대 ${ok.length}개`);
  for (const l of ok.slice(0, 25))
    console.log(`     ${String(Number(l.s)).padStart(11)}원 ${String(l.n).padStart(3)}건 ${l.c.padEnd(10)} ${l.p}`);
  if (ok.length > 25) console.log(`     … 그 밖 ${ok.length - 25}개`);

  /* 1건뿐인데 이름만 보면 그 분류가 이상한 것은 짚어 드린다 (지우지는 않는다) */
  const odd = ok.filter((l) => {
    if (Number(l.n) > 1) return false;
    const hint = readPayer("통장", l.p).hint;
    return hint !== null && hint !== l.c;
  });
  if (odd.length > 0) {
    console.log(`\n  ⚠️ 1건뿐인데 이름과 분류가 어긋나 보이는 것 ${odd.length}개 — 그대로 배웁니다만 확인해 주세요`);
    for (const o of odd)
      console.log(`     「${o.p}」 → ${o.c} (${Number(o.s).toLocaleString()}원) · 이름만 보면 ${readPayer("통장", o.p).hint} 같습니다`);
  }

  if (APPLY) {
    for (const l of ok) {
      await db.execute(sql`
        INSERT INTO expense_rule (key, category) VALUES (${l.p}, ${l.c})
        ON CONFLICT (key) DO UPDATE SET category = EXCLUDED.category, updated_at = now()`);
    }
    const [rt] = await db.execute<{ n: number }>(sql`SELECT count(*)::int n FROM expense_rule`);
    console.log(`  ✔ 규칙 사전 ${rt.n}개가 됐습니다`);
  }

  /* ────────────────────────────────────────────────────────────
   * 2단계 — 전 기간 자동 분류 다시 돌리기
   * ────────────────────────────────────────────────────────── */
  console.log("\n── 2단계 · 적요 규칙표 ──");
  for (const r of DESC_RULES) {
    const [c] = await db.execute<{ n: number; s: string }>(sql`
      SELECT count(*)::int n, COALESCE(SUM(out_amount),0)::bigint s FROM cash_txn c
      WHERE c.is_active AND c.category IS NULL AND c.out_amount > 0
        ${r.source ? sql`AND c.source = ${r.source}` : sql``}
        AND (${sql.raw(r.cond.split("description").join("c.description").split("out_amount").join("c.out_amount"))})`);
    console.log(`  ${String(c.n).padStart(4)}건 ${String(Number(c.s).toLocaleString()).padStart(14)}원  ${r.name.padEnd(18)} → ${r.category}`);
    console.log(`        근거: ${r.why}`);
  }

  if (!APPLY) {
    console.log("\n(미리보기라 여기서 멈춥니다. --apply 를 붙이면 실제로 붙습니다)");
    process.exit(0);
  }

  console.log("\n── 3단계 · 전 기간 자동 분류 다시 돌리기 ──");
  const tot = { rule: 0, desc: 0, other: 0 };
  for (const ym of months()) {
    const r = await applyAutoCategories({ ym });
    const other = r.internal + r.cardSettle + r.localPay + r.shareholder + r.interest + r.refund;
    tot.rule += r.rule;
    tot.desc += r.byDescTotal;
    tot.other += other;
    if (r.rule + r.byDescTotal + other > 0)
      console.log(`  ${ym}  규칙사전 ${r.rule} · 적요규칙 ${r.byDescTotal} · 그 밖 ${other}`
        + (r.byDesc.length ? `   [${r.byDesc.map((d) => `${d.name} ${d.n}`).join(" · ")}]` : ""));
  }
  console.log(`  합계 — 규칙사전 ${tot.rule} · 적요규칙 ${tot.desc} · 그 밖 ${tot.other}`);

  /* ────────────────────────────────────────────────────────────
   * 마무리 — 남은 것
   * ────────────────────────────────────────────────────────── */
  const after = await snapshot("\n끝");
  console.log(`  줄어든 것: ${before.un - after.un}건 ${(before.us - after.us).toLocaleString()}원`);

  console.log("\n── 아직 남은 미분류 — 금액 큰 것부터 25 ──");
  const rest = await db.execute<{ p: string; n: number; s: string; src: string }>(sql`
    SELECT ${K} p, count(*)::int n, SUM(out_amount)::bigint s, string_agg(DISTINCT source,'/') src
    FROM cash_txn WHERE is_active AND out_amount > 0 AND category IS NULL
    GROUP BY 1 ORDER BY 3 DESC LIMIT 25`);
  for (const r of rest) {
    const p = readPayer(r.src.includes("통장") ? "통장" : "법인카드", r.p);
    console.log(`  ${String(Number(r.s)).padStart(11)}원 ${String(r.n).padStart(3)}건 ${String(r.p).padEnd(18)}`
      + (p.what ? ` ※ ${p.what}` : "") + (p.hint ? ` ⇒ ${p.hint}` : ""));
  }

  console.log("\n── 분류별 지출 (전 기간) ──");
  const sums = await db.execute<{ c: string; n: number; s: string }>(sql`
    SELECT COALESCE(category,'(미분류)') c, count(*)::int n, SUM(out_amount)::bigint s
    FROM cash_txn WHERE is_active AND out_amount > 0 GROUP BY 1 ORDER BY 3 DESC`);
  for (const r of sums)
    console.log(`  ${r.c.padEnd(12)} ${String(r.n).padStart(4)}건 ${String(Number(r.s).toLocaleString()).padStart(16)}원`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
