/**
 * ⭐ 재고 정합 감시기 (재고 조사 2026-09-09 이후 상비)
 *
 *   "재고가 조금씩 달라지는 느낌"이 들면 이것부터 돌린다.
 *   🔴 판정 자체는 정본 `src/lib/stock-integrity.ts` 에 있다 (2026-09-10 추출) —
 *      「자료 사진」(ops-snapshot)도 같은 정본을 쓴다. 여기는 보여주기만.
 *
 * 실행: npx tsx --env-file=.env.local scripts/stock-integrity-check.ts
 */
import { stockIntegrity } from "@/lib/stock-integrity";

async function main() {
  const r = await stockIntegrity();

  const gap = r.shortfall.length - r.shortfallLive.length;
  console.log(
    `① 미차감(마지막 실사 이후 — 진짜 문제): ${r.shortfallLive.length}건` +
      (gap ? ` · 실사 이전 기록 공백 ${gap}건(정상)` : ""),
  );
  for (const s of r.shortfallLive) {
    console.log(`   · ${s.quoteNo} (${s.date}) ${s.name} ${s.missing}본 — 입고 등록하면 자동 소급, 급하면 fix-stock-shortfall.ts`);
  }

  console.log(`② 초과 차감(이중 차감): ${r.overDeducted.length}건`);
  for (const o of r.overDeducted) console.log(`   · ${o.quoteNo} 상품 ${o.productId}: 판 것 ${o.need}본, 빠진 것 ${o.got}본`);

  console.log(`③ 취소 미복원: ${r.cancelNotRestored.length}건`);
  for (const c of r.cancelNotRestored) console.log(`   · ${c.quoteNo} 상품 ${c.productId}`);

  console.log(`④ 유령 판매완료: ${r.ghostSold.length}건`);
  for (const g of r.ghostSold) console.log(`   · 재고행 ${g.stockItemId} 상품 ${g.productId}`);

  console.log(`⑤ 예약 조기 차감: ${r.reservedDeducted.length}건`);
  for (const e of r.reservedDeducted) console.log(`   · ${e.quoteNo} 출고 ${e.n}건`);

  console.log(r.badCount === 0 ? "\n✅ 전부 정상 — 재고 어긋남 없음" : `\n⚠ 이상 ${r.badCount}건 — 위 목록 확인 필요`);
  process.exit(0);
}
main();
