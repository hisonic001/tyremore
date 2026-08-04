"use client";

import { useState } from "react";
import type { PendingInvoice } from "@/lib/invoice";
import { InvoiceUpload } from "./client";
import { ManualPurchase } from "./manual";

/**
 * ⭐ 매입 등록 — 한 자리 (사장님 지시 2026-08-04)
 *
 *   "매입 타이어 등록도 중구난방으로 되어있는점. 어떤 타이어 어느 거래처에서 받던
 *    매입입고 화면에서 한번에 처리되어야함."
 *
 * 전에는 「인보이스 올리기」 카드와 「직접 매입」 카드가 **따로** 놓여 있어서
 * 어디로 들어가야 하는지부터 고민하게 했다. 이제 갈림길은 하나다:
 * **파일이 있으면 올리고, 없으면 담는다.** 결과는 같은 장부·같은 입고 예정 목록이다.
 */
export function RegisterPurchase({ openManual }: { openManual: PendingInvoice | null }) {
  // 직접 매입 장부가 열려 있으면 그 탭부터 — 하다 만 일이 먼저 보여야 한다
  const [tab, setTab] = useState<"invoice" | "manual">(openManual ? "manual" : "invoice");

  return (
    <section className="mt-4">
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {(
          [
            ["invoice", "인보이스 파일 올리기"],
            ["manual", openManual ? "직접 담기 (작성 중)" : "직접 담기"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 rounded-lg py-2.5 text-sm font-semibold ${
              tab === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 active:bg-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "invoice" ? (
        <>
          <p className="mt-2 px-1 text-xs text-slate-500">
            미쉐린·콘티넨탈·금호 엑셀(PDF)을 올리면 거래처와 품목을 알아서 읽습니다.
          </p>
          <InvoiceUpload />
        </>
      ) : (
        <>
          <p className="mt-2 px-1 text-xs text-slate-500">
            인보이스가 없을 때 — 거래처를 적고 품목을 검색해 담습니다.
          </p>
          <ManualPurchase open={openManual} />
        </>
      )}
    </section>
  );
}
