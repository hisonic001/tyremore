/**
 * ⭐ 원단위 자동 잇기 지킴이 (2026-08-31)
 *
 *   미지급 리모델링의 핵심 규칙 — 출금 금액이 ①인보이스 하나 ②같은 작성일 묶음 합과
 *   정확히 일치할 때만 자동 잇기를 제안한다. 2026-08-31 실측(콘티 4건·미쉐린 4건)을
 *   그대로 시험으로 고정한다. 근사치 제안은 절대 안 된다 — 돈은 원단위로 맞아야 한다.
 *
 *   실행: npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { exactPlan } from "./payables-plan";

const inv = (id: number, no: string, d: string, remain: number) => ({ id, no, d, remain });

describe("원단위 자동 잇기 (exactPlan)", () => {
  test("인보이스 하나와 정확 일치 — 미쉐린형", () => {
    const r = exactPlan(1203048, [inv(1, "KR_A", "2026-08-05", 1203048), inv(2, "KR_B", "2026-08-12", 16045568)]);
    assert.deepEqual(r?.nos, ["KR_A"]);
  });

  test("같은 작성일 묶음 합과 일치 — 콘티형 (8/13 두 장 = 출금 2,390,300)", () => {
    const r = exactPlan(2390300, [
      inv(1, "CO-4236", "2026-08-13", 963050),
      inv(2, "CO-4237", "2026-08-13", 1427250),
      inv(3, "CO-5216", "2026-08-21", 1267750),
    ]);
    assert.deepEqual(r?.nos, ["CO-4236", "CO-4237"]);
  });

  test("세 장 묶음도 된다 — 콘티 8/28 (960,300+1,023,660+148,500)", () => {
    const r = exactPlan(2132460, [
      inv(1, "CO-6266", "2026-08-28", 960300),
      inv(2, "CO-6267", "2026-08-28", 1023660),
      inv(3, "CO-6268", "2026-08-28", 148500),
    ]);
    assert.equal(r?.nos.length, 3);
  });

  test("🔴 근사치는 제안하지 않는다 — 1원만 어긋나도 null", () => {
    assert.equal(exactPlan(2390301, [inv(1, "A", "2026-08-13", 963050), inv(2, "B", "2026-08-13", 1427250)]), null);
  });

  test("이미 지급된(잔액 0) 인보이스는 셈에서 뺀다", () => {
    const r = exactPlan(100000, [inv(1, "A", "2026-08-13", 0), inv(2, "B", "2026-08-13", 100000)]);
    assert.deepEqual(r?.nos, ["B"]);
  });
});
