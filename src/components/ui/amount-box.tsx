"use client";

/**
 * ⭐ 줄 합계 금액 칸 — 양방향 (사장님 지시 2026-08-18, 판매 등록에서 시작).
 *    "단가는 조정가능하지만 수량을 곱한 금액이 조정이 되지 않는 것이 불편함."
 *    금액을 치면 단가 = 금액÷수량(반올림)으로 따라온다. 나누어떨어지지 않으면
 *    단가가 정수로 잡히며 금액이 몇 원 조정된다 — 손을 떼면 확정값을 보여준다.
 *
 * 2026-09-03 공용 부품으로 추출 (사장님: "매입내역에서도 판매내역과 같이 양방향") —
 * 판매(sale/client)와 매입(receiving)이 같은 정본을 쓴다. 동작 불변.
 */
import { useState } from "react";
import { showSigned, signedInt, signedStr } from "@/lib/signed-input";

const won = (n: number) => n.toLocaleString("ko-KR");

export function AmountBox({
  qty,
  unitPrice,
  onUnit,
  allowNegative = true,
  className = "tabular h-9 w-24 rounded-lg border border-slate-300 px-2 text-right text-sm font-semibold",
}: {
  qty: number;
  unitPrice: number;
  onUnit: (unit: number) => void;
  /** 판매는 '-' 허용(환불 줄, 2026-08-21) — 매입가는 음수가 없다 */
  allowNegative?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? won(unitPrice * qty);
  return (
    <input
      value={shown}
      inputMode="numeric"
      className={className}
      onFocus={() => setDraft(won(unitPrice * qty))}
      onChange={(e) => {
        const raw = allowNegative ? signedStr(e.target.value) : e.target.value.replace(/\D/g, "");
        setDraft(allowNegative ? showSigned(raw) : raw === "" ? "" : Number(raw).toLocaleString("ko-KR"));
        const total = allowNegative ? signedInt(raw) : Number(raw) || 0;
        onUnit(qty > 0 ? Math.round(total / qty) : total);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}
