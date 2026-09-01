"use server";

/**
 * ⭐ 정비 내역의 대상 바꾸기 (사장님 지시 2026-08-17)
 *
 *   "정비내역카드에서 정비내역에 연결된 고객이나 거래처도 변경이 가능하게 해줘"
 *
 * 지금까지는 손님을 잘못 붙이면 **판매를 통째로 취소하고 다시 등록**하는 수밖에
 * 없었다. 재고가 빠졌다 들어왔다 하고, 판매 번호도 새로 생긴다.
 *
 * 🔴 **이 판매 한 건만 옮긴다** (사장님 결정 2026-08-17).
 *    차량(vehicle) 레코드의 주인은 건드리지 않는다 — 그러면 그 차의 지난 정비
 *    내역 전부가 새 주인 것이 되어 버린다. 그건 다른 기능이어야 한다.
 *
 * 🔴 이 파일에 권한 가드를 직접 넣는다. `sale-edit.ts` 에 넣지 않은 이유는 그
 *    파일에 가드가 하나도 없어서, 거기 두면 「가드 없는 것」이 자연스러워 보이기
 *    때문이다. 대상 바꾸기는 **외상 잔액과 이미 받은 돈의 주인**을 바꾼다.
 */

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { quote } from "@/db/schema";
import { isOwner } from "./auth";

function refresh() {
  for (const p of ["/sales", "/", "/receivables"]) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
}

const won = (n: number) => n.toLocaleString("ko-KR");

export type ReassignTarget =
  /** 차를 고르면 그 차 주인이 곧 고객이다 — 판매 등록과 같은 규칙 */
  | { kind: "customer"; vehicleId: number }
  | { kind: "supplier"; supplierName: string }
  | { kind: "walkin"; name: string; phone?: string; plateNo?: string };

export async function reassignSale(input: {
  quoteId: number;
  target: ReassignTarget;
  /** MARS 에 이미 올라간 건도 바꾸겠다는 확인 */
  confirmMars?: boolean;
  /** 이미 받은 수금이 함께 옮겨가는 것을 알겠다는 확인 */
  confirmMoney?: boolean;
}): Promise<
  | { ok: true; from: string; to: string; warning: string | null }
  | { ok: false; error: string; needMarsConfirm?: boolean; needMoneyConfirm?: boolean }
> {
  if (!(await isOwner())) {
    return { ok: false, error: "손님·거래처 바꾸기는 사장님 계정에서만 됩니다" };
  }

  const [q] = await db
    .select({
      id: quote.id,
      quoteNo: quote.quoteNo,
      status: quote.status,
      marsStatus: quote.marsStatus,
      customerId: quote.customerId,
      vehicleId: quote.vehicleId,
      supplierName: quote.supplierName,
      marsMemo: quote.marsMemo,
      paymentMemo: quote.paymentMemo,
      paymentMethod: quote.paymentMethod,
    })
    .from(quote)
    .where(eq(quote.id, input.quoteId))
    .limit(1);
  if (!q) return { ok: false, error: "판매 기록을 찾을 수 없습니다" };
  if (q.status === "취소") return { ok: false, error: "취소된 판매는 대상을 바꿀 수 없습니다" };

  /**
   * 🔴 「미전송」은 확인을 물어도 안 된다 — 지금 매장 PC 가 그 건을 MARS 화면에
   *    치고 있을 수 있다. 다 치고 나면 markEntered 가 mars_memo 를 덮어쓰므로,
   *    그 사이에 대상을 바꾸면 MARS 에는 옛 손님이 우리에겐 새 손님이 남는다.
   */
  if (q.marsStatus === "미전송") {
    return { ok: false, error: "지금 MARS 에 올리는 중입니다 — 끝난 뒤에 바꿔 주세요" };
  }
  if (q.marsStatus === "전송완료" && !input.confirmMars) {
    return {
      ok: false,
      needMarsConfirm: true,
      error:
        "이 판매는 MARS 에 이미 들어갔습니다. 여기서 손님을 바꿔도 MARS 쪽 고객은 그대로입니다 — " +
        "MARS 에서도 직접 고치셔야 합니다. 그래도 바꿀까요?",
    };
  }

  /**
   * 이미 받은 수금이 있으면 한 번 더 묻는다.
   * ⭐ receivable_payment 는 quote_id 로만 묶여 있어 **저절로 따라간다** —
   *    옮길 것이 없다. 다만 「받은 돈의 주인이 바뀐다」는 사실은 알려야 한다.
   */
  const [paid] = await db.execute<{ s: number; n: number }>(sql`
    SELECT COALESCE(SUM(amount), 0)::int s, count(*)::int n
    FROM receivable_payment WHERE quote_id = ${q.id}
  `);
  if (Number(paid?.n ?? 0) > 0 && !input.confirmMoney) {
    return {
      ok: false,
      needMoneyConfirm: true,
      error:
        `이 건은 이미 ${won(Number(paid.s))}원을 받았습니다. 대상을 바꾸면 그 수금 기록도 ` +
        "함께 옮겨갑니다. 그래도 바꿀까요?",
    };
  }

  /* ── 지금 대상 (화면에 「금호 → 김철수」로 보여 준다) ── */
  const before = await describeTarget(q.customerId, q.vehicleId, q.supplierName, q.marsMemo);

  /* ── 새 대상 풀어내기 ── */
  let setCustomerId: number | null = null;
  let setVehicleId: number | null = null;
  let setSupplier: string | null = null;
  let setMemo: string | null = null;
  let after = "";

  if (input.target.kind === "customer") {
    const [v] = await db.execute<{
      id: number;
      customer_id: number;
      plate_no: string;
      name: string;
    }>(sql`
      SELECT v.id, v.customer_id, v.plate_no, c.name
      FROM vehicle v JOIN customer c ON c.id = v.customer_id
      WHERE v.id = ${input.target.vehicleId} AND v.is_active
    `);
    if (!v) return { ok: false, error: "차량을 찾지 못했습니다" };
    setCustomerId = Number(v.customer_id);
    setVehicleId = Number(v.id);
    after = `${v.name} ${v.plate_no}`;
  } else if (input.target.kind === "supplier") {
    /** 거래처 표의 **정식 이름**으로 맞춘다 — 손으로 친 이름이 갈라지지 않게 */
    const key = input.target.supplierName.replace(/\s/g, "").toLowerCase();
    const [s] = await db.execute<{ name: string }>(sql`
      SELECT name FROM supplier WHERE name_key = ${key} AND is_active LIMIT 1
    `);
    if (!s) return { ok: false, error: "그 거래처를 찾지 못했습니다 — 설정 > 거래처에서 먼저 추가해 주세요" };
    setSupplier = s.name;
    /* ⭐ 차량은 유지한다 (2026-09-01 — 「거래처로 묶되 차량 유지」 2026-08-21 결정이
       등록에는 있었는데 여기엔 없어서, 거래처로 돌리면 차량이 날아갔다) */
    setCustomerId = q.customerId;
    setVehicleId = q.vehicleId;
    after = `거래처 ${s.name}${q.vehicleId ? " (차량 유지)" : ""}`;
  } else {
    const name = input.target.name?.trim();
    if (!name) return { ok: false, error: "손님 이름을 넣어 주세요" };
    const parts = [name, input.target.phone?.trim(), input.target.plateNo?.trim()].filter(Boolean);
    setMemo = `비회원 ${parts.join(" ")}`;
    after = setMemo;
  }

  if (before === after) return { ok: false, error: "이미 그 대상입니다" };

  /**
   * ── MARS 상태 ──
   * 거래처 판매는 MARS 에 안 간다('해당없음'). 개인으로 돌아오면 다시 올릴 수 있어야 한다.
   * 🔴 '미전송' 이 아니라 '보류' 로 돌린다 — '미전송' 은 매장 PC 가 확인 없이 집어간다.
   *    '보류' 로 두면 정비 내역에서 체크(queueForMars)해야 올라간다 = 기존 흐름 그대로.
   * 🔴 '전송완료' 는 **그대로 둔다.** '해당없음' 으로 내리면 정합 감사가 그 건을
   *    감시 대상에서 빼 버려 「MARS 에 남아 있다」는 사실이 조용히 사라진다.
   */
  const toSupplier = input.target.kind === "supplier";
  let marsStatus = q.marsStatus;
  if (q.marsStatus !== "전송완료") {
    if (toSupplier) marsStatus = "해당없음";
    else if (q.marsStatus === "해당없음" && q.paymentMethod !== "서비스") marsStatus = "보류";
  }

  /** 어떤 대상이든 mars_memo 의 옛 이름 흔적은 걷어낸다 (비회원이면 새로 쓴다) */
  const keptMemo = (q.marsMemo ?? "")
    .split("·")
    .map((x) => x.trim())
    .filter((x) => x && !x.startsWith("비회원") && !x.startsWith("거래처"))
    .join(" · ");
  const newMarsMemo = [setMemo, keptMemo].filter(Boolean).join(" · ") || null;

  /** 흔적 — 사장님이 카드에서 그대로 읽으신다 */
  const now = new Date();
  const stamp = `${now.getMonth() + 1}/${now.getDate()}`;
  const trace = `· ${stamp} 대상 바꿈: ${before} → ${after}`;
  const newPayMemo = [q.paymentMemo?.trim(), trace].filter(Boolean).join(" ").slice(-240);

  let warning: string | null = null;
  await db.transaction(async (tx) => {
    await tx
      .update(quote)
      .set({
        customerId: setCustomerId,
        vehicleId: setVehicleId,
        supplierName: setSupplier,
        marsStatus,
        marsMemo: newMarsMemo,
        paymentMemo: newPayMemo,
        updatedAt: now,
      })
      .where(eq(quote.id, q.id));

    /** MARS 에 이미 들어간 건은 메모에도 한 번만 남긴다 (sale-edit 의 방식과 같게) */
    if (q.marsStatus === "전송완료") {
      await tx.execute(sql`
        UPDATE quote SET mars_memo = COALESCE(mars_memo || ' · ', '') || '대상 바뀜 — MARS 고객 확인 필요'
        WHERE id = ${q.id} AND (mars_memo IS NULL OR mars_memo NOT LIKE '%대상 바뀜 — MARS 고객 확인 필요%')
      `);
      warning = "MARS 에 이미 들어간 판매입니다 — MARS 쪽 고객도 직접 고쳐 주세요";
    }
  });

  /**
   * ⚠️ 재고(stock_movement)와 수금(receivable_payment)은 quote_id 로 묶여 있어
   *    **아무것도 옮기지 않아도 따라온다.** 건드리면 오히려 어긋난다.
   * ⚠️ vehicle.mileage 도 갱신하지 않는다 — 과거 판매를 새 차에 붙이면서 그 차의
   *    최신 주행거리를 옛 값으로 덮으면 안 된다.
   */
  refresh();
  return { ok: true, from: before, to: after, warning };
}

/** 지금 이 판매가 누구 것인지 한 줄로 */
async function describeTarget(
  customerId: number | null,
  vehicleId: number | null,
  supplierName: string | null,
  marsMemo: string | null,
): Promise<string> {
  if (supplierName) return `거래처 ${supplierName}`;
  if (customerId) {
    const [c] = await db.execute<{ name: string; plate_no: string | null }>(sql`
      SELECT c.name, v.plate_no FROM customer c
      LEFT JOIN vehicle v ON v.id = ${vehicleId ?? null}
      WHERE c.id = ${customerId}
    `);
    if (c) return [c.name, c.plate_no].filter(Boolean).join(" ");
  }
  if (marsMemo?.startsWith("비회원")) return marsMemo.split("·")[0].trim();
  return "손님 미지정";
}
