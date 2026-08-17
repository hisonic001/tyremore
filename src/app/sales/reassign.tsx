"use client";

/**
 * ⭐ 정비 내역 — 손님·거래처 바꾸기 (사장님 지시 2026-08-17)
 *
 * 잘못 붙은 손님·거래처를 판매를 취소하지 않고 고친다.
 * 이 판매 한 건만 옮긴다 — 차량의 주인은 안 바뀐다.
 *
 * 선택기는 판매 등록과 **같은 것**을 쓴다 (sale/customer-pick.tsx) —
 * 거래처 검색 규칙이 두 벌로 갈리지 않게.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CustomerPick } from "../sale/customer-pick";
import { reassignSale } from "@/lib/sale-reassign";
import type { SaleRow } from "@/lib/sale-history";
import type { VehicleHit } from "@/lib/search";

export function ReassignPanel({
  sale: s,
  onDone,
}: {
  sale: SaleRow;
  onDone: (msg: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  /** 서버가 되물으면 그 문구를 여기 담고 확인 버튼을 띄운다 */
  const [ask, setAsk] = useState<{ text: string; mars: boolean; money: boolean } | null>(null);

  const [vehicle, setVehicle] = useState<VehicleHit | null>(null);
  const [supplier, setSupplier] = useState<string | null>(null);
  const [walkIn, setWalkIn] = useState({ name: "", phone: "", plateNo: "" });

  const now =
    s.customerName ?? (s.supplierName ? `거래처 ${s.supplierName}` : null) ?? s.walkIn ?? "손님 미지정";
  const next = supplier
    ? `거래처 ${supplier}`
    : vehicle
      ? `${vehicle.customerName} ${vehicle.plateNo}`
      : walkIn.name.trim()
        ? `비회원 ${[walkIn.name, walkIn.phone, walkIn.plateNo].filter(Boolean).join(" ")}`
        : null;

  function go(confirmMars: boolean, confirmMoney: boolean) {
    if (!next) return;
    start(async () => {
      setErr(null);
      const target = supplier
        ? ({ kind: "supplier", supplierName: supplier } as const)
        : vehicle
          ? ({ kind: "customer", vehicleId: vehicle.vehicleId } as const)
          : ({
              kind: "walkin",
              name: walkIn.name,
              phone: walkIn.phone || undefined,
              plateNo: walkIn.plateNo || undefined,
            } as const);
      const r = await reassignSale({ quoteId: s.quoteId, target, confirmMars, confirmMoney });
      if (!r.ok) {
        if (r.needMarsConfirm || r.needMoneyConfirm) {
          setAsk({
            text: r.error,
            mars: confirmMars || !!r.needMarsConfirm,
            money: confirmMoney || !!r.needMoneyConfirm,
          });
          return;
        }
        return setErr(r.error);
      }
      onDone(`${r.from} → ${r.to} 로 바꿨습니다${r.warning ? ` · ${r.warning}` : ""}`);
      router.refresh();
    });
  }

  return (
    <div className="mt-3 rounded-xl border-2 border-indigo-300 bg-indigo-50 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-indigo-900">손님·거래처 바꾸기</h3>
        <span className="truncate text-sm text-indigo-800">지금: {now}</span>
      </div>
      <p className="mt-1 text-xs text-indigo-700">
        이 정비 한 건만 옮깁니다 — 차량의 주인이나 지난 내역은 그대로입니다.
      </p>

      <div className="mt-2">
        <CustomerPick
          vehicle={vehicle}
          onPick={(v) => {
            setVehicle(v);
            if (v) setSupplier(null);
          }}
          walkIn={walkIn}
          onWalkIn={setWalkIn}
          supplier={supplier}
          onSupplier={(x) => {
            setSupplier(x);
            if (x) setVehicle(null);
          }}
          allowNew={false}
        />
      </div>

      {err && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      {/* 서버가 되물은 것 (MARS 에 이미 올라감 / 이미 받은 돈이 있음) */}
      {ask && (
        <div className="mt-2 rounded-xl border-2 border-amber-500 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">{ask.text}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setAsk(null)}
              className="flex-1 rounded-lg border border-amber-300 bg-white py-2 text-sm font-medium text-amber-800"
            >
              그만두기
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => go(ask.mars, ask.money)}
              className="flex-1 rounded-lg bg-amber-600 py-2 text-sm font-semibold text-white"
            >
              알겠습니다, 바꿉니다
            </button>
          </div>
        </div>
      )}

      {!ask && (
        <button
          type="button"
          disabled={pending || !next}
          onClick={() => go(false, false)}
          className="mt-2 w-full rounded-lg bg-indigo-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "바꾸는 중…" : next ? `${now} → ${next} 로 바꾸기` : "새 대상을 골라 주세요"}
        </button>
      )}
    </div>
  );
}
