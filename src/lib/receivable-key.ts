import { sql, type SQL } from "drizzle-orm";

/**
 * ⭐ 외상 대상 열쇠 정본 (2026-09-10 추출)
 *
 *   「이 외상은 누구에게 받을 돈인가」를 정하는 판정. 전에는 같은 CASE 문이
 *   receivable-book·fin-deposits·settlement-apply 세 곳에 복붙돼 있어, 대상이
 *   하나 늘 때마다 세 곳을 다 고쳐야 했다 — 한 곳만 빠뜨리면 외상 장부에는
 *   보이는데 수금은 못 하는 식으로 갈라진다.
 *
 *   🔴 `claim_party`(본사청구, 2026-09-10) 가 여기 들어온 이유: 미쉐린 데미지
 *      쿠폰·OE AS 는 손님 차에 시공하지만 돈은 본사가 준다. `supplier_name`
 *      을 쓰면 MARS 가 「해당없음」으로 굳어 소매 등록이 막히므로 칸을 따로 뒀고,
 *      **받을 돈으로는 거래처와 똑같이 묶여야** 한다.
 *
 *   🔴 비회원은 건별로 하나의 대상('W:'||id)이다 — 이름으로 묶으면 동명이인의
 *      외상이 한 덩어리가 되어 남의 것을 대신 털게 된다.
 */
export const receivableKeySql: SQL = sql`CASE
  WHEN COALESCE(q.supplier_name, q.claim_party) IS NOT NULL
    THEN 'S:' || COALESCE(q.supplier_name, q.claim_party)
  WHEN q.customer_id IS NOT NULL THEN 'C:' || q.customer_id
  ELSE 'W:' || q.id END`;

/** 대상 이름 (열쇠 안에 들어 있는 값이라 max() 로 안전) */
export const receivablePartySql: SQL = sql`COALESCE(q.supplier_name, q.claim_party)`;

/** 열쇠 하나를 조건으로 — 수금·청구가 「그 대상의 외상만」 고를 때 */
export function receivableKeyCond(partyKey: string): SQL {
  if (partyKey.startsWith("S:")) return sql`COALESCE(q.supplier_name, q.claim_party) = ${partyKey.slice(2)}`;
  if (partyKey.startsWith("C:"))
    return sql`COALESCE(q.supplier_name, q.claim_party) IS NULL AND q.customer_id = ${Number(partyKey.slice(2))}`;
  if (partyKey.startsWith("W:")) return sql`q.id = ${Number(partyKey.slice(2))}`;
  return sql`false`;
}
