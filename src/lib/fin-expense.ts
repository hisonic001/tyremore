"use server";

/**
 * ⭐ 지출 분류 — 쓰기 액션 (ERP ⑥, 사장님 지시 2026-08-25)
 *
 *   통장 출금·법인카드 지출에 분류를 붙인다. 한 번 붙이면 같은 상대(expense_rule)의
 *   과거 미분류 지출에 일괄 적용되고, 새로 올리는 파일에도 자동으로 붙는다(fin-ingest).
 *
 * 🔴 사장님 전용. 분류 목록·상대명 규칙은 recon-data(EXPENSE_CATS·payerKeyOf) 한 곳.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession, hasPerm } from "@/lib/auth";
import { EXPENSE_CATS, PAYER_KEY_SQL, payerKeyOf } from "./expense-cats";
import { revalidateFinance } from "./fin-revalidate";
import { logActivity } from "./fin-activity";
import { W } from "./fin-words";

const won = (n: number) => n.toLocaleString("ko-KR");

/**
 * ⭐ 해제하면 몇 건이 풀리나 — 미리 세어 화면이 물어볼 수 있게 (2회차 수리 A5, 2026-08-28)
 *
 * 🔴 **왜 필요했나** — 붙일 때는 같은 상대의 **전 기간**에 한꺼번에 붙는데(아래 bulk),
 *    해제는 언제나 **그 한 줄만** 풀었다. 화면은 "규칙도 지워 앞으로 자동으로 붙지
 *    않습니다" 라고만 말하고, 이미 붙은 나머지가 남는다는 말은 안 했다.
 *    그 나머지는 손익의 「쓴 돈」·「분류별 지출」에 계속 들어간다.
 *    (2026-08-28 실측: 「(주)싸이오토모」+내부이체 375줄 13.7억, 「미쉐린코리아(」+매입대금 95줄 3.05억)
 *
 *    사장님 결정(2026-08-28): **"전부 풀지 한 줄만 풀지 그때그때 고른다."**
 *    그래서 누를 때마다 이 함수로 건수를 먼저 세어 보여준다.
 */
export async function previewUnset(
  cashTxnId: number,
): Promise<{ ok: true; payer: string; category: string; n: number; sum: number } | { ok: false; error: string }> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const [row] = await db.execute<{ source: string; description: string; category: string | null }>(sql`
    SELECT source, description, category FROM cash_txn WHERE id = ${cashTxnId} AND is_active
  `);
  if (!row) return { ok: false, error: "지출 줄을 찾을 수 없습니다" };
  if (!row.category) return { ok: false, error: "분류가 안 붙어 있는 줄입니다" };
  const key = payerKeyOf(row.source, row.description);
  const [c] = await db.execute<{ n: number; s: string }>(sql`
    SELECT count(*)::int n, COALESCE(SUM(out_amount), 0)::bigint s FROM cash_txn
    WHERE is_active AND out_amount > 0 AND category = ${row.category}
      AND (${sql.raw(PAYER_KEY_SQL)}) = ${key} -- 정본 (2026 감사 G6)
  `);
  return { ok: true, payer: key, category: row.category, n: Number(c.n), sum: Number(c.s) };
}

export async function setExpenseCategory(
  cashTxnId: number,
  category: string | null,
  /** 해제할 때만 본다 — 'one' 이 줄만 · 'all' 같은 상대·같은 분류 전부 (2회차 수리 A5) */
  opts?: { scope?: "one" | "all" },
): Promise<{ ok: true; applied: number; payer: string } | { ok: false; error: string }> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  if (category !== null && !(EXPENSE_CATS as readonly string[]).includes(category)) {
    return { ok: false, error: "분류가 올바르지 않습니다" };
  }
  const [row] = await db.execute<{
    id: number; source: string; description: string; out_amount: number; category: string | null; ym: string;
  }>(sql`
    SELECT id, source, description, out_amount, category, to_char(occurred_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') ym
    FROM cash_txn WHERE id = ${cashTxnId} AND is_active
  `);
  if (!row) return { ok: false, error: "지출 줄을 찾을 수 없습니다" };
  if (Number(row.out_amount) <= 0) return { ok: false, error: "지출(출금) 줄이 아닙니다" };

  const key = payerKeyOf(row.source, row.description);
  let applied = 1;
  const uid = (await getSession())?.uid ?? null;

  if (category === null) {
    /**
     * ── 해제 ──
     * 🔴 2회차 수리 A5(2026-08-28): 「이 줄만」과 「같은 상대 전부」 두 갈래.
     *    'all' 은 **붙일 때와 정확히 거울상**이다 — 같은 열쇠 + 지금 붙어 있는 그 분류.
     *    다른 분류가 붙은 줄은 건드리지 않는다 (사장님이 따로 정하신 것일 수 있다).
     * 🔴 되돌리기: 다시 그 분류를 붙이면 같은 규칙으로 전 기간에 한꺼번에 붙는다.
     * 🔴 여기만 트랜잭션으로 묶는다 — 줄 UPDATE 와 규칙 DELETE 가 따로 놀면
     *    「규칙은 지웠는데 줄은 그대로」가 남는다. (붙이는 쪽도 같은 문제가 있으나
     *    이번 회차 범위 밖 — 2회차 보고 ★2)
     */
    const scope = opts?.scope ?? "one";
    const prev = row.category;
    await db.transaction(async (tx) => {
      if (scope === "all" && prev) {
        const bulk = await tx.execute<{ id: number }>(sql`
          UPDATE cash_txn SET category = NULL
          WHERE is_active AND out_amount > 0 AND category = ${prev}
            AND (${sql.raw(PAYER_KEY_SQL)}) = ${key} -- 정본 (2026 감사 G6)
          RETURNING id
        `);
        applied = bulk.length;
      } else {
        await tx.execute(sql`UPDATE cash_txn SET category = NULL WHERE id = ${cashTxnId}`);
        applied = 1;
      }
      // 규칙도 지운다 — 같은 상대를 계속 잘못 붙이지 않게
      await tx.execute(sql`DELETE FROM expense_rule WHERE key = ${key}`);
    });
  } else {
    await db.execute(sql`UPDATE cash_txn SET category = ${category} WHERE id = ${cashTxnId}`);
    if (key.length >= 2) {
      await db.execute(sql`
        INSERT INTO expense_rule (key, category) VALUES (${key}, ${category})
        ON CONFLICT (key) DO UPDATE SET category = EXCLUDED.category, updated_at = now()
      `);
      // 같은 상대의 분류 안 된 지출에 일괄 적용 — 과거 것까지 한 번에
      const bulk = await db.execute<{ id: number }>(sql`
        UPDATE cash_txn SET category = ${category}
        WHERE category IS NULL AND is_active AND out_amount > 0
          AND (${sql.raw(PAYER_KEY_SQL)}) = ${key} -- 정본 (2026 감사 G6)
        RETURNING id
      `);
      applied += bulk.length;
    }
  }

  /* ⭐ 최근 한 일 — 붙이기는 되돌리기 = setExpenseCategory(id, null, {scope:'all'}) (붙일 때의 거울상: 같은 상대·같은 분류 전부 + 규칙 삭제).
     해제는 되돌리기 자체(다시 붙이면 같은 규칙으로 전 기간에 붙는다) */
  await logActivity({
    ym: row.ym,
    actor: uid,
    how: "사람",
    verb: category === null ? "되돌리기" : "분류",
    target: { table: "cash_txn", id: cashTxnId },
    n: Math.max(1, applied),
    amount: Number(row.out_amount),
    label:
      category === null
        ? `${W.undo}: 분류 「${row.category ?? ""}」 해제 — ${key} ${won(Number(row.out_amount))}${applied > 1 ? ` (같은 상대 ${applied}건)` : ""}`
        : `분류 → ${category}: ${key} ${won(Number(row.out_amount))}${applied > 1 ? ` (같은 상대 ${applied}건)` : ""}`,
    undo: category === null ? null : { kind: "expense", args: { cashTxnId, scope: applied > 1 ? "all" : "one" } },
  });

  revalidateFinance(); // 3단계(2026-09-12): 돈관리 화면 목록은 fin-revalidate 하나 — /finance/weekly 포함
  return { ok: true, applied, payer: key };
}
