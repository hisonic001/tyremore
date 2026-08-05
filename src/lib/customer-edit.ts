"use server";

/**
 * ⭐ 고객·차량 정보 수정 (사장님 요청 2026-08-05)
 *
 *   "고객, 차량 정보도 메인화면에서 검색 후에 고객/차량 카드로 들어가서
 *    수정이 가능했으면 좋겠음."
 *
 * 검색 카드 → /vehicle/[id] 로 들어와 이름·전화·주소·차량 정보를 고친다.
 *
 * 🔴 `mars_contact_no` · `mars_vehicle_no` 는 **절대 여기서 못 고친다.**
 *    MARS 로 내보낼 때 맞추는 열쇠라(D-08 단방향 출구), 틀어지면 자동 입력이
 *    엉뚱한 고객·차량에 붙는다.
 */
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { customer, vehicle } from "@/db/schema";

function refresh() {
  for (const p of ["/", "/sale", "/sales"]) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
}

export async function updateCustomerInfo(input: {
  customerId: number;
  name: string;
  phone?: string | null;
  address?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "이름은 비울 수 없습니다" };
  const [c] = await db.select({ id: customer.id }).from(customer).where(eq(customer.id, input.customerId)).limit(1);
  if (!c) return { ok: false, error: "고객을 찾을 수 없습니다" };

  await db
    .update(customer)
    .set({
      name,
      phone: input.phone?.trim() || null,
      address: input.address?.trim() || null,
    })
    .where(eq(customer.id, input.customerId));
  refresh();
  return { ok: true };
}

export async function updateVehicleInfo(input: {
  vehicleId: number;
  plateNo: string;
  makerName?: string | null;
  model?: string | null;
  year?: number | null;
  mileage?: number | null;
  memo?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const plate = input.plateNo.trim();
  const plateNorm = plate.replace(/[\s-]/g, "");
  if (!plateNorm) return { ok: false, error: "차량번호는 비울 수 없습니다" };
  const [v] = await db.select({ id: vehicle.id }).from(vehicle).where(eq(vehicle.id, input.vehicleId)).limit(1);
  if (!v) return { ok: false, error: "차량을 찾을 수 없습니다" };

  // 같은 번호판이 다른 차량에 있으면 막는다 — 판매·이력이 갈라진다
  const [dup] = await db.execute<{ id: number }>(sql`
    SELECT id FROM vehicle WHERE plate_no_norm = ${plateNorm} AND id <> ${input.vehicleId} LIMIT 1
  `);
  if (dup) return { ok: false, error: `차량번호 ${plate} 는 이미 다른 차량에 있습니다` };

  await db
    .update(vehicle)
    .set({
      plateNo: plate,
      plateNoNorm: plateNorm,
      makerName: input.makerName?.trim() || null,
      model: input.model?.trim() || null,
      year: input.year ?? null,
      mileage: input.mileage ?? null,
      memo: input.memo?.trim() || null,
    })
    .where(eq(vehicle.id, input.vehicleId));
  refresh();
  return { ok: true };
}
