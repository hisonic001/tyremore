/**
 * ⭐ 인박스 지킴이 (2026-08-31) — 「판정 재작성 금지」 원칙을 잠근다.
 *   인박스는 각 화면 정본 함수를 조립해야 한다 — 판정을 여기서 다시 쓰면
 *   화면과 인박스 숫자가 갈라진다 (이 저장소가 세 번 데인 자리).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("인박스는 정본을 재사용한다", () => {
  const src = readFileSync(join(process.cwd(), "src", "lib", "fin-inbox.ts"), "utf8");

  test("정본 함수 셋을 import 한다", () => {
    for (const fn of ["depositReconData", "payLinkData", "taxCashData"]) {
      assert.ok(src.includes(fn), `fin-inbox 가 정본 ${fn} 을 안 씁니다 — 판정을 다시 쓰면 화면과 갈라집니다`);
    }
  });

  test("입금·출금의 「됐다/할일」 판정을 직접 다시 쓰지 않는다", () => {
    // 이체입금·계산서의 소진량/미확인 판정 원문이 여기 다시 나타나면 안 된다
    assert.ok(!src.includes("cashUsedSql"), "소진량 계산은 정본 함수 안에서만 — 인박스가 직접 쓰면 정의가 둘이 된다");
    assert.ok(!src.includes("'매출계산서'"), "계산서 판정은 taxCashData 정본 몫입니다");
  });
});
