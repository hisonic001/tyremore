"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { confirmCandidate, dismissCandidate, moveStorage } from "@/lib/tire-storage";
import { formatStorageNo, sizeHints, sizesIn, type StorageDropInput, type StorageKind } from "@/lib/tire-storage-pure";
import type { StorageRow } from "@/lib/tire-storage-data";
import { DropFields } from "./drop-fields";
import { otherPlatesIn, VehiclePicker } from "./vehicle-picker";

/**
 * ⭐ 실사 체크표 (D-42 2단계) — 판매 메모에서 뽑은 후보를 창고에서 확인한다.
 *   있음 → 번호 받고 보관중(맡긴 날 = 원래 판매일) · 없음 → 제외.
 *   이 화면에서 「있음」 한 세트들은 아래 「스티커 한꺼번에 인쇄」로 뽑는다.
 */
export function AuditList({ rows }: { rows: StorageRow[] }) {
  const [done, setDone] = useState<{ id: number; no: number }[]>([]);
  return (
    <div className="mt-2">
      {done.length > 0 && (
        <div className="sticky top-14 z-10 mt-2 flex items-center justify-between gap-2 rounded-card bg-brand-50 p-3 lg:top-28">
          <span className="text-sm text-brand-700">
            방금 확인 {done.length}세트 · {done.map((d) => `#${formatStorageNo(d.no)}`).join(" ")}
          </span>
          <a
            href={`/print/storage?ids=${done.map((d) => d.id).join(",")}`}
            target="_blank"
            className="inline-flex min-h-11 shrink-0 items-center rounded-control bg-brand-600 px-4 text-sm font-semibold text-white"
          >
            스티커 한꺼번에 인쇄
          </a>
        </div>
      )}
      <div className="divide-y divide-slate-100">
        {rows.map((r) => (
          <AuditRow key={r.id} r={r} onConfirmed={(no) => setDone((d) => [...d, { id: r.id, no }])} />
        ))}
      </div>
    </div>
  );
}

function AuditRow({ r, onConfirmed }: { r: StorageRow; onConfirmed: (no: number) => void }) {
  const router = useRouter();
  const [drop, setDrop] = useState<StorageDropInput>({
    kind: (r.kind as StorageKind | null) ?? null,
    brand: r.brand ?? "",
    size: r.size ?? "",
    qty: r.qty,
    dot: r.dot ?? "",
    memo: r.memo ?? "",
  });
  const [state, setState] = useState<{ kind: "ok"; no: number } | { kind: "gone" } | { kind: "err"; msg: string } | null>(null);
  const [pending, start] = useTransition();
  /** ⭐ 다른 차·주인으로 (2026-11-17 — 「84고0717보관 이 차량번호로 바꿔 적어서 붙이기」 같은 메모) */
  const [moving, setMoving] = useState(false);
  const others = otherPlatesIn(r.sourceText, r.plateNo);

  if (state?.kind === "ok")
    return (
      <p className="py-3 text-sm text-brand-700">
        ✓ #{formatStorageNo(state.no)} {r.plateNo} {r.ownerName} — 보관 중으로 등록
      </p>
    );
  if (state?.kind === "gone") return <p className="py-3 text-sm text-slate-400">— {r.plateNo} {r.ownerName} 없음 처리</p>;

  return (
    <div className="py-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[15px] font-semibold">
          {r.plateNo ?? "차량 없음"} · {r.ownerName}
          <span className="ml-2 text-xs font-normal text-slate-400">{r.storedOn} 판매</span>
        </p>
        {!moving && (
          <button
            type="button"
            onClick={() => setMoving(true)}
            className={`shrink-0 rounded-control border px-2.5 py-1.5 text-xs font-medium ${others.length ? "border-amber-400 bg-amber-50 text-amber-800" : "border-slate-300 text-slate-600"}`}
          >
            {others.length ? `⚠️ 메모에 ${others[0]} — 차 바꾸기` : "차·주인 바꾸기"}
          </button>
        )}
      </div>
      {moving && (
        <VehiclePicker
          suggestions={others}
          pending={pending}
          onCancel={() => setMoving(false)}
          onPick={(h) =>
            start(async () => {
              const res = await moveStorage(r.id, h.vehicleId);
              if (res.ok) {
                setMoving(false);
                setState(null);
                router.refresh();
              } else setState({ kind: "err", msg: res.error });
            })
          }
        />
      )}
      {r.sourceText && <p className="mt-1 rounded-control bg-slate-50 p-2 text-[13px] leading-snug text-slate-600">{r.sourceText}</p>}
      {r.releaseNote && (
        <p className={`mt-1 text-xs font-medium ${/없음|찾아갔/.test(r.releaseNote) ? "text-amber-700" : "text-brand-700"}`}>
          {/없음|찾아갔/.test(r.releaseNote) ? "⚠️ " : "✓ "}
          {r.releaseNote}
        </p>
      )}
      <div className="mt-2">
        <DropFields value={drop} onChange={setDrop} disabled={pending} sizeHints={sizeHints(r.size, r.lastFittedSize, ...sizesIn(r.sourceText ?? ""))} />
      </div>
      {state?.kind === "err" && <Notice tone="error">{state.msg}</Notice>}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          pending={pending}
          onClick={() =>
            start(async () => {
              const res = await dismissCandidate(r.id);
              if (res.ok) {
                setState({ kind: "gone" });
                router.refresh();
              } else setState({ kind: "err", msg: res.error });
            })
          }
        >
          없음
        </Button>
        <Button
          pending={pending}
          onClick={() =>
            start(async () => {
              const res = await confirmCandidate(r.id, drop);
              if (res.ok) {
                setState({ kind: "ok", no: res.no });
                onConfirmed(res.no);
              } else setState({ kind: "err", msg: res.error });
            })
          }
        >
          있음 — 번호 받기
        </Button>
      </div>
    </div>
  );
}
