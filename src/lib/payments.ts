/**
 * ⭐ 결제수단 공용 규칙 (사장님 요청 2026-08-10)
 *
 * "혼합 결제라고 하기보다는 결제시 결제수단을 1개 이상 고르게 할 수 있으며
 *  동시에 반영가능하게" — 판매 등록·정비 내역 수정·서버 검증이 전부 이 파일을 본다.
 *
 * · 분할에 섞을 수 있는 것: 현금 · 카드 · 계좌이체 · 지역화폐
 * · 외상·서비스는 단독으로만 — MARS·대기열 처리가 결제수단 하나를 전제한다
 * · 지역화폐는 MARS 에 현금으로 들어간다 (사장님 지시 — scripts/mars-fill.ts PAY_CODE)
 */

/** 분할에 섞을 수 있는 수단 (화면 단추 순서 그대로) */
export const SPLITTABLE = ["카드", "현금", "계좌이체", "지역화폐"] as const;
/** 단독으로만 되는 수단 */
export const EXCLUSIVE = ["외상", "서비스"] as const;

export interface PaymentPart {
  method: string;
  amount: number;
}

/**
 * 분할 결제 검증 — 2개 이상일 때만 「분할」이다.
 * 통과하면 { split } 에 정리된 배열(1개 이하면 null)을 돌려준다.
 */
export function checkSplitPayments(
  payments: PaymentPart[] | null | undefined,
  total: number,
): { ok: true; split: PaymentPart[] | null } | { ok: false; error: string } {
  const parts = (payments ?? []).filter((p) => p.amount !== 0);
  if (parts.length <= 1) return { ok: true, split: null };

  const seen = new Set<string>();
  for (const p of parts) {
    if (!(SPLITTABLE as readonly string[]).includes(p.method)) {
      return { ok: false, error: `「${p.method}」 는 분할 결제에 섞을 수 없습니다` };
    }
    if (seen.has(p.method)) return { ok: false, error: `「${p.method}」 가 두 번 들어 있습니다` };
    seen.add(p.method);
    if (!Number.isInteger(p.amount) || p.amount <= 0) {
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
