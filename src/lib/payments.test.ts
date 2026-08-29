/**
 * ⭐ 결제수단 지킴이 (2026-08-29)
 *
 *   사고: 간편결제를 넣으면서 `lib/payments.ts`·DB CHECK·화면은 고쳤는데
 *   `lib/sale-edit.ts` 에 목록이 하나 더 하드코딩돼 있어, 정비 내역에서도 카드 일마감에서도
 *   「결제수단이 올바르지 않습니다」로 막혔다 (사장님 제보).
 *
 *   그래서 이 시험은 **목록이 갈라지는 것 자체**를 잡는다:
 *     ① 코드가 아는 수단이 DB CHECK 에도 다 있나 (없으면 저장이 터진다)
 *     ② 결제수단 목록을 payments.ts 밖에서 또 적어 두지 않았나
 *
 *   실행: npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ALL_METHODS, EXCLUSIVE, SPLITTABLE } from "./payments";

const SRC = join(process.cwd(), "src");
const schema = readFileSync(join(SRC, "db", "schema.ts"), "utf8");

/** schema.ts 의 CHECK 한 줄에서 따옴표 안 낱말을 뽑는다 */
function methodsInCheck(needle: string): string[] {
  const line = schema.split("\n").find((l) => l.includes(needle) && l.includes("IN ("));
  assert.ok(line, `schema.ts 에서 ${needle} CHECK 를 못 찾았습니다`);
  const inside = /IN \(([^)]*)\)/.exec(line!)?.[1] ?? "";
  return [...inside.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("① 코드가 아는 결제수단이 DB 제약에도 다 있나", () => {
  test("quote.payment_method — 전체 목록", () => {
    const db = methodsInCheck("t.paymentMethod} IS NULL OR");
    for (const m of ALL_METHODS) {
      assert.ok(db.includes(m), `「${m}」 가 quote CHECK 에 없습니다 — scripts/add-*.ts 로 제약을 먼저 푸세요`);
    }
  });

  test("quote_payment.method — 분할에 섞을 수 있는 수단", () => {
    const db = methodsInCheck("quote_payment_method_check");
    for (const m of SPLITTABLE) {
      assert.ok(db.includes(m), `「${m}」 가 quote_payment CHECK 에 없습니다`);
    }
    for (const m of EXCLUSIVE) {
      assert.ok(!db.includes(m), `「${m}」 는 단독 수단인데 분할 CHECK 에 들어 있습니다`);
    }
  });

  test("receivable_payment.method — 외상 수금 수단", () => {
    const db = methodsInCheck("receivable_payment_method_check");
    for (const m of SPLITTABLE) {
      assert.ok(db.includes(m), `「${m}」 가 receivable_payment CHECK 에 없습니다`);
    }
  });
});

/* ------------------------------------------------------------------ */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("② 결제수단 목록을 payments.ts 밖에서 또 적지 않았나", () => {
  test("「현금」과 「계좌이체」가 한 줄에 나열된 곳은 정본·스키마·옛 이관 스크립트뿐", () => {
    /** 여기는 목록이 있어도 되는 곳 */
    const allowed = [
      join(SRC, "lib", "payments.ts"), // 정본
      join(SRC, "lib", "payments.test.ts"), // 이 시험
      join(SRC, "db", "schema.ts"), // DB CHECK (①이 정본과 대조한다)
      join(SRC, "lib", "pos-close.ts"), // 수단 착오 후보를 찾는 SQL — 대사 대상 밖 수단까지 훑는다
      join(SRC, "lib", "purchase-pay.ts"), // 매입 지급 — 판매 결제수단과 다른 갈래
      join(SRC, "app", "finance", "payables", "payables-ui.tsx"), // 위와 같은 갈래
    ];
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (allowed.includes(file)) continue;
      for (const [i, line] of readFileSync(file, "utf8").split("\n").entries()) {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue; // 주석 속 설명은 목록이 아니다
        // 「현금」과 「계좌이체」가 **따옴표에 싸여** 한 줄에 있으면 목록을 적은 것이다
        const quoted = (w: string) => line.includes(`"${w}"`) || line.includes(`'${w}'`);
        if (quoted("현금") && quoted("계좌이체")) {
          offenders.push(`${file.slice(SRC.length + 1)}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "결제수단 목록이 정본 밖에 또 있습니다 — lib/payments.ts 의 SPLITTABLE·EXCLUSIVE·ALL_METHODS 를 쓰세요:\n" +
        offenders.join("\n"),
    );
  });
});
