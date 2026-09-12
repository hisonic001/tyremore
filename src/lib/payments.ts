/**
 * ⭐ 결제수단 공용 규칙 (사장님 요청 2026-08-10)
 *
 * "혼합 결제라고 하기보다는 결제시 결제수단을 1개 이상 고르게 할 수 있으며
 *  동시에 반영가능하게" — 판매 등록·정비 내역 수정·서버 검증이 전부 이 파일을 본다.
 *
 * · 분할에 섞을 수 있는 것: 현금 · 카드 · 계좌이체 · 지역화폐 · 간편결제
 * · 외상·서비스는 단독으로만 — MARS·대기열 처리가 결제수단 하나를 전제한다
 * · ⭐ 마이너스 금액도 된다 (사장님 요청 2026-08-21 — 카드 취소·환불). 「카드 −100,000 +
 *   현금 100,000」처럼 수단을 바꿔 준 경우도, 판매 자체가 환불(합계 마이너스)인 경우도.
 *   0 은 여전히 안 된다 — 0원 수단은 빼고 적는다.
 * · 지역화폐는 MARS 에 현금으로 들어간다 (사장님 지시 — scripts/mars-fill.ts PAY_CODE)
 * · ⭐ 간편결제 (사장님 요청 2026-08-29) — QR코드·네이버페이·카카오페이·토스페이.
 *   어느 페이인지는 앱에서 고르지 않는다. 토스 포스 매출리포트 「매입사」 칸에 이미 적혀 온다
 *   (실측 2026-08-28: 토스페이·현대·삼성). 여신협회 승인내역에는 안 잡히므로 카드와 갈라 센다.
 *   MARS 에는 카드로 들어간다 — 매입사가 카드사로 찍히는 건이 대부분이다.
 */

/** 분할에 섞을 수 있는 수단 (화면 단추 순서 그대로) */
export const SPLITTABLE = ["카드", "현금", "계좌이체", "지역화폐", "간편결제"] as const;
/** 단독으로만 되는 수단 */
export const EXCLUSIVE = ["외상", "서비스"] as const;
/**
 * ⭐ 외상 수금 수단 (사장님 제보 2026-09-07 — 강원수산 수금을 개인계좌로 받음).
 *    「개인계좌」는 법인 통장 자료에 안 찍히는 수령 — 통장 대조 대상이 아니고,
 *    돈관리 홈이 「통장 밖 수령」으로 따로 보여 준다. 판매 수단에는 안 쓴다.
 *
 *    🔴 DB 의 `receivable_payment_method_check` 에도 「개인계좌」가 들어 있어야 한다 —
 *       이 목록만 늘리고 제약을 안 늘리면 수금 저장이 23514 로 튕긴다.
 *       정본 스크립트: scripts/add-collect-personal.ts (점검·수리: add-collect-personal-fix.ts)
 */
export const COLLECT_METHODS: readonly string[] = [...SPLITTABLE, "개인계좌"];
/**
 * ⭐ quote.payment_method 에 들어갈 수 있는 전부 (2026-08-29).
 * 「혼합」은 사람이 고르는 값이 아니라 수단 2개 이상일 때 서버가 굳히는 값이다.
 * 🔴 목록을 다른 파일에 또 적지 말 것 — 간편결제를 넣을 때 sale-edit 에만 하드코딩이
 *    남아 있어 「결제수단이 올바르지 않습니다」로 막혔다 (사장님 제보 2026-08-29).
 *    DB CHECK 와 어긋나지 않는지는 payments.test.ts 가 지킨다.
 */
export const ALL_METHODS: readonly string[] = [...SPLITTABLE, ...EXCLUSIVE, "혼합"];

export interface PaymentPart {
  method: string;
  amount: number;
  /** ⭐ 받은 날 (예약거래 2026-09-01) — 비면 판매 작업일. 검증은 안 하고 통과만 시킨다 */
  paidOn?: string | null;
}

/**
 * 분할 결제 검증 — 2개 이상일 때만 「분할」이다.
 * 통과하면 { split } 에 정리된 배열(1개 이하면 null)을 돌려준다.
 *
 * 🔴 합계 일치는 **풀지 않는다** (2026-09-10 확인). 본사청구·예약처럼 덜 받는 자리는
 *    quote_payment 를 아예 안 쓰고 「외상 + 받은 몫 수금(receivable_payment)」으로
 *    간다 (정본 sale.ts `prepaid`). 여기를 느슨하게 풀면 합이 안 맞는 분할 결제가
 *    quote_payment 에 남아, 그 표를 합계로 믿는 카드 일마감·정산이 조용히 어긋난다.
 *
 * ⭐ **같은 수단이 두 줄 이상인 것은 막지 않는다** (2026-09-12, 사장님 제보로 발견).
 *    전에는 「『카드』가 두 번 들어 있습니다」로 거부했는데, 이 앱이 **스스로 그런 줄을
 *    만든다**: 예약금을 받고 잔금을 또 카드로 받으면 `reservation-pay.ts` 가 받은 날을
 *    살리려고 수금 줄을 **합치지 않고 한 줄씩** `quote_payment` 로 옮긴다. 그래서
 *    「카드 200,000(9/10) + 카드 854,000(9/10) + 카드 200,000(9/12)」 같은 정상 자료가
 *    생기는데, 규칙이 그걸 불법이라 해서 **그 판매는 「고치기」 저장이 영영 막혀 있었다.**
 *    🔴 합치는 쪽으로 풀면 **받은 날이 사라져** 카드 일마감이 어긋난다(D-18) — 그래서
 *    막는 규칙을 없애고 **줄 단위 그대로** 둔다. 틀린 금액은 아래 **합계 검사**가 잡는다.
 */
export function checkSplitPayments(
  payments: PaymentPart[] | null | undefined,
  total: number,
): { ok: true; split: PaymentPart[] | null } | { ok: false; error: string } {
  const parts = (payments ?? []).filter((p) => p.amount !== 0);
  if (parts.length <= 1) return { ok: true, split: null };

  for (const p of parts) {
    if (!(SPLITTABLE as readonly string[]).includes(p.method)) {
      return { ok: false, error: `「${p.method}」 는 분할 결제에 섞을 수 없습니다` };
    }
    /* 같은 수단 중복은 정상이다 — 위 ⭐ 설명 참조 (카드 두 장, 예약금+잔금) */
    if (!Number.isInteger(p.amount) || p.amount === 0) {
      return { ok: false, error: `「${p.method}」 금액이 올바르지 않습니다` };
    }
  }
  const sum = parts.reduce((s, p) => s + p.amount, 0);
  if (sum !== total) {
    return {
      ok: false,
      error: `분할 금액 합계(${sum.toLocaleString()}원)가 판매 합계(${total.toLocaleString()}원)와 다릅니다`,
    };
  }
  return { ok: true, split: parts };
}

/** 「카드 30,000 + 현금 5,000」 — 카드·영수증·내역 표시용 */
export function splitLabel(parts: PaymentPart[]): string {
  return parts.map((p) => `${p.method} ${p.amount.toLocaleString()}`).join(" + ");
}
