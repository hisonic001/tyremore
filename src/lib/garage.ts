/**
 * ⭐ 거래처 차고 고객 찾기/만들기 (2026-09-02 — 거래처 화면 개편 때 추출)
 *
 *   거래처 차량은 그 거래처의 「차고 고객」(법인) 소속이다 — 이름 비교가 아니라
 *   customer.supplier_name **링크**로만 잇는다 (동명 실손님과 안 섞이게, 2026-09-01 설계).
 *   쓰는 곳: sale.ts createSupplierVehicle · customer-edit.ts moveVehicleToSupplier.
 *
 * 🔴 "use server" 아님 — 공개 엔드포인트가 아니라 서버 코드 전용 헬퍼다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

export async function ensureGarageCustomer(supplierName: string): Promise<number> {
  const name = supplierName.trim();
  const [garage] = await db.execute<{ id: number }>(sql`
    SELECT id FROM customer WHERE supplier_name = ${name} LIMIT 1
  `);
  if (garage) return Number(garage.id);
  const [made] = await db.execute<{ id: number }>(sql`
    INSERT INTO customer (name, name_search, type, supplier_name, memo)
    VALUES (${name}, ${name.replace(/\s/g, "").toLowerCase()}, '법인', ${name},
            ${"거래처 차고 — " + name + " 차량 보관용 (자동 생성)"})
    RETURNING id
  `);
  return Number(made.id);
}
