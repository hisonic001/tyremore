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
import { isPlaceholderCustomerName, normalizePlate } from "./normalize";
import { customer, vehicle } from "@/db/schema";
import { PERM_DENIED } from "./perm-keys";

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
  /** 영향 고지를 보고 그래도 바꾸겠다는 확인 (아래 needsScopeConfirm 왕복) */
  confirmScope?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string; needsScopeConfirm?: string }> {
  if (!(await (await import("./auth")).hasPerm("customer"))) return { ok: false, error: PERM_DENIED };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "이름은 비울 수 없습니다" };
  const [c] = await db
    .select({ id: customer.id, name: customer.name, phone: customer.phone, address: customer.address })
    .from(customer)
    .where(eq(customer.id, input.customerId))
    .limit(1);
  if (!c) return { ok: false, error: "고객을 찾을 수 없습니다" };

  // 그대로면 아무 일도 안 한다 — 차량 폼 저장에 딸려 와도 고지가 안 뜬다
  const same =
    name === c.name && (input.phone?.trim() || null) === (c.phone ?? null) && (input.address?.trim() || null) === (c.address ?? null);
  if (same) return { ok: true };

  /**
   * ⭐ 영향 고지 (박은지 연동 사고 2026-09-09) — 차량이 여러 대 붙은 고객은
   *    한 행이라 이름을 고치면 **그 차량들의 정비 카드가 전부 함께 바뀐다.**
   *    자리표시에 딴 손님들이 섞여 있던 실사고를 저장 전에 눈으로 보게 한다.
   */
  if (!input.confirmScope) {
    const [n] = await db.execute<{ ncars: number; nquotes: number }>(sql`
      SELECT (SELECT count(*)::int FROM vehicle WHERE customer_id = ${input.customerId}) ncars,
             (SELECT count(*)::int FROM quote WHERE customer_id = ${input.customerId}) nquotes`);
    if (Number(n?.ncars ?? 0) >= 2) {
      return {
        ok: false,
        error: "확인이 필요합니다",
        needsScopeConfirm:
          `이 고객에는 차량 ${n.ncars}대 · 정비 ${n.nquotes}건이 붙어 있습니다 — ` +
          `고치면 전부 함께 바뀝니다. 다른 손님의 차가 섞여 보인다면 바꾸지 말고 사장님(관리자)에게 알려 주세요.`,
      };
    }
  }

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
  /** ⭐ 연료 (2026-08-17) — MARS 필수 정보. 값은 MARS 표기 그대로 (Fuel·Diesel·Hybird·BEV) */
  fuelType?: string | null;
  mileage?: number | null;
  vin?: string | null;
  memo?: string | null;
  /**
   * ⭐ 번호판이 바뀌었을 때의 뜻 (사장님 제보 2026-09-02 — 조혜진 차 바꿈 사건):
   *    'replace' = 차를 바꿨다 → **새 차량으로 등록**하고 옛 차는 그대로 둔다
   *                (과거 정비 내역이 옛 차에 남는다 — 이력은 차량에 붙어 있으므로)
   *    'fix'     = 번호판 오타 수정 → 이 차량 기록 자체를 고친다 (과거 내역 표시도 같이 바뀜)
   *    안 주고 번호판이 바뀌면 → needsPlateChoice 로 화면이 한 번 묻는다.
   */
  plateChangeMode?: "fix" | "replace";
}): Promise<
  | { ok: true; newVehicleId?: number }
  | { ok: false; error: string; needsPlateChoice?: boolean }
> {
  if (!(await (await import("./auth")).hasPerm("customer"))) return { ok: false, error: PERM_DENIED };
  const fuelType = input.fuelType?.trim() || null;
  if (fuelType && !["Fuel", "Diesel", "Hybird", "BEV", "LPG"].includes(fuelType)) {
    return { ok: false, error: "연료 종류가 올바르지 않습니다" };
  }
  const plate = input.plateNo.trim();
  const plateNorm = normalizePlate(plate); // 정본 하나 (2026-09-01 통일)
  if (!plateNorm) return { ok: false, error: "차량번호는 비울 수 없습니다" };
  const [v] = await db
    .select({ id: vehicle.id, plateNoNorm: vehicle.plateNoNorm, plateNo: vehicle.plateNo, customerId: vehicle.customerId })
    .from(vehicle)
    .where(eq(vehicle.id, input.vehicleId))
    .limit(1);
  if (!v) return { ok: false, error: "차량을 찾을 수 없습니다" };

  // 같은 번호판이 다른 차량에 있으면 막는다 — 판매·이력이 갈라진다
  const [dup] = await db.execute<{ id: number }>(sql`
    SELECT id FROM vehicle WHERE plate_no_norm = ${plateNorm} AND id <> ${input.vehicleId} LIMIT 1
  `);
  if (dup) return { ok: false, error: `차량번호 ${plate} 는 이미 다른 차량에 있습니다` };

  /**
   * 🔴 번호판이 바뀌었다 = 십중팔구 **차를 바꾼 것**이다 (조혜진 사건 2026-09-02:
   *    새 차 정보로 덮어써서 2월 정비 내역까지 BMW i4 로 바뀌어 보였다).
   *    화면이 뜻을 확인하기 전에는 덮어쓰지 않는다.
   */
  const plateChanged = plateNorm !== (v.plateNoNorm ?? normalizePlate(v.plateNo));
  if (plateChanged && !input.plateChangeMode) {
    return {
      ok: false,
      needsPlateChoice: true,
      error: `차량번호가 ${v.plateNo} → ${plate} 로 바뀌었습니다 — 차를 바꾸신 건가요, 번호 오타를 고치신 건가요?`,
    };
  }

  /**
   * 🔴 제조사는 **코드까지 같이** 맞춘다 (사장님 버그 제보 2026-08-05).
   *    검색 카드는 maker_code 의 이름을 우선 보여주기 때문에, 글자만 바꾸면
   *    낡은 코드가 이겨서 화면이 옛 제조사를 계속 보여준다.
   *    이름·코드·별칭 표에서 찾아지면 그 코드로, 못 찾으면 코드를 비워 글자가 보이게 한다.
   */
  const makerText = input.makerName?.trim() || null;
  // 🔴 제조사는 MARS 목록의 이름만 (사장님 제보 2026-08-09) — 목록 밖이면 MARS 등록이 실패한다
  if (makerText) {
    const { isMarsMaker } = await import("./mars-makers");
    if (!isMarsMaker(makerText)) {
      return { ok: false, error: `제조사 「${makerText}」 는 MARS 목록에 없습니다 — 목록에서 골라 주세요` };
    }
  }
  let makerCode: string | null = null;
  if (makerText) {
    const [hit] = await db.execute<{ code: string }>(sql`
      SELECT code FROM vehicle_maker WHERE name_ko = ${makerText} OR code = ${makerText.toUpperCase()}
      UNION ALL
      SELECT code FROM vehicle_maker_alias WHERE raw_name = ${makerText}
      LIMIT 1
    `);
    makerCode = hit?.code ?? null;
  }

  const vinClean = input.vin?.trim().toUpperCase().replace(/\s/g, "") || null;

  /* ⭐ 차 바꿈 — 폼의 내용으로 **새 차량**을 만들고 옛 차는 손대지 않는다.
     과거 정비 내역은 quote.vehicle_id 로 옛 차에 붙어 있으니 그대로 보존되고,
     오늘부터의 판매는 새 차로 나간다 (사장님 요구 2026-09-02). */
  if (plateChanged && input.plateChangeMode === "replace") {
    /* 🔴 자리표시 「고객」 행에는 새 차를 못 단다 (연동 사고 2026-09-09) — 265에
       이 경로로 서로 다른 손님 6대가 붙었다. 새 손님은 판매 등록에서 새로 등록. */
    const [own] = await db.execute<{ name: string; sup: string | null }>(sql`
      SELECT name, supplier_name sup FROM customer WHERE id = ${v.customerId}`);
    if (!own?.sup && isPlaceholderCustomerName(own?.name)) {
      return {
        ok: false,
        error: `「${own?.name}」 은 여러 손님이 섞이는 자리표시입니다 — 새 손님의 차는 판매 등록 화면에서 새로 등록해 주세요`,
      };
    }
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    const [nv] = await db
      .insert(vehicle)
      .values({
        customerId: v.customerId,
        plateNo: plate,
        plateNoNorm: plateNorm,
        makerCode,
        makerName: makerText,
        model: input.model?.trim() || null,
        year: input.year ?? null,
        fuelType,
        mileage: input.mileage ?? null,
        mileageAt: input.mileage ? new Date() : null,
        vin: vinClean,
        memo: input.memo?.trim() || null,
      })
      .returning({ id: vehicle.id });
    // 옛 차에는 자국만 — 정보는 그대로 (과거 내역이 이 차의 모습으로 남는다)
    await db.execute(sql`
      UPDATE vehicle SET memo = COALESCE(memo || ' · ', '') || ${`차 바꿈 ${today} → ${plate}`}
      WHERE id = ${input.vehicleId}
    `);
    refresh();
    return { ok: true, newVehicleId: Number(nv.id) };
  }

  await db
    .update(vehicle)
    .set({
      plateNo: plate,
      plateNoNorm: plateNorm,
      makerCode,
      makerName: makerText,
      model: input.model?.trim() || null,
      year: input.year ?? null,
      fuelType,
      mileage: input.mileage ?? null,
      // 차대번호 — 대문자·공백 제거만 하고 길이는 강제하지 않는다 (사장님 요청 2026-08-10).
      // 등록증에서 못 읽은 자리를 일부만 적어 두는 경우가 있다
      vin: vinClean,
      memo: input.memo?.trim() || null,
    })
    .where(eq(vehicle.id, input.vehicleId));
  refresh();
  return { ok: true };
}

/**
 * ⭐ 개인 고객 차량을 거래처 차고로 보낸다 (사장님 요청 2026-09-02 — 거래처 화면 개편).
 *
 *   차고→개인 방향은 「새 손님 등록」이 자동으로 한다(sale.ts 이전 규칙) — 이건 그 반대다.
 *   정비 이력(quote.vehicle_id)은 차량에 그대로 따라간다.
 * 🔴 지난 판매의 귀속(quote.supplier_name·customer_id)은 판매에 박제 — 안 바뀐다.
 *    지난 외상의 주인이 바뀌면 장부가 소급으로 흔들리기 때문에 일부러 안 건드린다.
 * 🔴 사장님 전용 — 차량 소유를 옮기는 것은 손님·거래처 바꾸기와 같은 무게다.
 */
export async function moveVehicleToSupplier(
  vehicleId: number,
  supplier: string,
): Promise<{ ok: true; plateNo: string; from: string } | { ok: false; error: string }> {
  /* 사장님 검증 지적(2026-09-02): 「고객·차량 수정」 권한을 준 직원도 돼야 한다 —
     owner 전용에서 customer 모듈 권한으로 완화 (owner 는 어차피 통과) */
  if (!(await (await import("./auth")).hasPerm("customer"))) return { ok: false, error: PERM_DENIED };
  const name = supplier.trim();
  if (!name) return { ok: false, error: "거래처를 골라 주세요" };
  const [sup] = await db.execute<{ id: number }>(sql`
    SELECT id FROM supplier WHERE name = ${name} AND is_active LIMIT 1
  `);
  if (!sup) return { ok: false, error: `활성 거래처 「${name}」 을(를) 찾을 수 없습니다` };

  const [v] = await db.execute<{ id: number; plate_no: string; customer_id: number; owner_name: string; owner_supplier: string | null }>(sql`
    SELECT v.id, v.plate_no, v.customer_id, c.name owner_name, c.supplier_name owner_supplier
    FROM vehicle v JOIN customer c ON c.id = v.customer_id
    WHERE v.id = ${vehicleId}
  `);
  if (!v) return { ok: false, error: "차량을 찾을 수 없습니다" };
  if (v.owner_supplier === name) return { ok: false, error: "이미 이 거래처 차고의 차량입니다" };

  const { ensureGarageCustomer } = await import("./garage");
  const garageId = await ensureGarageCustomer(name);
  const fromLabel = v.owner_supplier ? `${v.owner_supplier} 차고` : `개인 ${v.owner_name}`;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  await db.execute(sql`
    UPDATE vehicle SET customer_id = ${garageId},
      memo = COALESCE(memo || ' · ', '') || ${`${fromLabel}에게서 이전 ${today}`}
    WHERE id = ${vehicleId}
  `);
  for (const p of ["/settings/suppliers", "/sale", "/sales"]) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
  return { ok: true, plateNo: v.plate_no, from: fromLabel };
}

