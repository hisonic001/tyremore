"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { attachSaleStorage, saleStorage } from "@/lib/tire-storage";
import type { StorageRow } from "@/lib/tire-storage-data";
import { formatStorageNo, type SaleStorageInput } from "@/lib/tire-storage-pure";
import { EMPTY_SALE_STORAGE, StoragePanel } from "../sale/storage-panel";

/**
 * ⭐ 정비 내역 카드의 「📦 보관」 (사장님 지시 2026-11-17)
 *
 *   이미 저장한 판매에 보관을 붙인다 — ① 예약 판매를 「시공 완료」한 직후(예약 때는 타이어가 안 들어와 칸이 없다)
 *   ② 판매 등록 때 깜빡한 경우. 판매 화면과 같은 칸(StoragePanel)·같은 정본(applySaleStorage)이라
 *   그 판매와 연결되고, 판매를 취소하면 같이 되돌아간다.
 */
export function SaleStorageAttach({
  quoteId,
  vehicleId,
  customerId,
  lines,
  onClose,
}: {
  quoteId: number;
  vehicleId: number;
  customerId: number | null;
  lines: { lineType: string; description: string; spec: string | null }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [linked, setLinked] = useState<{ stored: StorageRow[]; released: StorageRow[] } | null>(null);
  const [value, setValue] = useState<SaleStorageInput>(EMPTY_SALE_STORAGE);
  const [epoch, setEpoch] = useState(0);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string; print?: number[] } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    void saleStorage(quoteId)
      .then((r) => alive && setLinked(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [quoteId, epoch]);

  const dirty = value.drops.length > 0 || value.pickupIds.length > 0;

  return (
    <div className="mt-3 rounded-xl border border-slate-300 bg-slate-50 p-3">
      {linked && (linked.stored.length > 0 || linked.released.length > 0) && (
        <ul className="mb-2 space-y-1 text-sm">
          {linked.stored.map((r) => (
            <li key={r.id}>
              <a href={`/storage/${r.id}`} className="underline underline-offset-2">
                📦 이 판매로 맡김 #{formatStorageNo(r.no)} {r.describe}
              </a>
              {r.status !== "보관중" && <span className="ml-1 text-xs text-slate-400">({r.status})</span>}
            </li>
          ))}
          {linked.released.map((r) => (
            <li key={r.id} className="text-slate-600">
              ↩ 이 판매로 찾아감 #{formatStorageNo(r.no)} {r.describe}
            </li>
          ))}
        </ul>
      )}

      <StoragePanel
        key={epoch}
        vehicle={{ vehicleId, customerId: customerId ?? 0 }}
        reserve={false}
        rows={lines.map((l) => ({ kind: l.lineType, description: l.description, spec: l.spec }))}
        value={value}
        onChange={setValue}
      />

      {msg && (
        <Notice tone={msg.tone}>
          {msg.text}
          {msg.print && msg.print.length > 0 && (
            <>
              {" "}
              <a href={`/print/storage?ids=${msg.print.join(",")}`} target="_blank" className="font-semibold underline">
                스티커 인쇄
              </a>
            </>
          )}
        </Notice>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onClose}>
          닫기
        </Button>
        <Button
          disabled={!dirty}
          pending={pending}
          onClick={() =>
            start(async () => {
              const r = await attachSaleStorage(quoteId, value);
              if (!r.ok) return setMsg({ tone: "error", text: r.error });
              const parts = [
                r.stored.length ? `보관번호 ${r.stored.map((x) => formatStorageNo(x.no)).join(", ")} 받음` : "",
                r.released ? `찾아감 ${r.released}세트` : "",
              ].filter(Boolean);
              setMsg({ tone: "success", text: `${parts.join(" · ")} — 이 판매에 연결했습니다.`, print: r.stored.map((x) => x.id) });
              setValue(EMPTY_SALE_STORAGE);
              setEpoch((e) => e + 1);
              router.refresh();
            })
          }
        >
          이 판매에 보관 저장
        </Button>
      </div>
    </div>
  );
}
