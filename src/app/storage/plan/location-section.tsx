"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useConfirm } from "@/components/ui/confirm";
import { setStorageLocation } from "@/lib/storage-area";
import type { AreaInfo } from "@/lib/tire-storage-data";
import { formatStorageNo } from "@/lib/tire-storage-pure";
import { chosenText, LocationChooser, LocationFinder, type LocValue, type SetLite } from "./location";
import { ONE_STACK, setsAtSlot } from "@/lib/storage-plan-pure";

/**
 * 보관 상세의 「📍 위치」 (2026-11-18 3차) — 있으면 찾기(글자 크게 → 같은 자리 세트 → 도면 — 더미는 2026-11-18 뺐다), 없으면 「위치 정하기」.
 */
export function LocationSection({
  id,
  no,
  areaId,
  slotId,
  stackNo,
  areas,
  sets,
}: {
  id: number;
  no: number | null;
  areaId: number | null;
  slotId: string | null;
  stackNo: number | null;
  areas: AreaInfo[];
  sets: SetLite[];
}) {
  const router = useRouter();
  const [ask, confirmNode] = useConfirm();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState<LocValue>({ areaId, slotId, stack: slotId ? (stackNo ?? ONE_STACK) : null });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const has = areaId != null;
  const mates = setsAtSlot(sets, areaId, slotId);

  if (editing)
    return (
      <div className="space-y-3">
        {confirmNode}
        <LocationChooser areas={areas} sets={sets} value={v} onChange={setV} selfId={id} />
        {err && <Notice tone="error">{err}</Notice>}
        <div className="sticky bottom-16 z-10 -mx-3 border-t border-slate-200 bg-white/95 p-3 backdrop-blur lg:bottom-0">
          <p className="mb-2 text-sm font-bold text-slate-900">{chosenText(areas, v, sets, id) ?? "구역을 고르세요"}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setEditing(false)}>
              그만두기
            </Button>
            <Button
              disabled={v.areaId == null || !v.slotId || v.stack == null}
              pending={pending}
              onClick={() =>
                start(async () => {
                  const r = await setStorageLocation(id, { areaId: v.areaId!, slotId: v.slotId!, stack: v.stack! });
                  if (!r.ok) return setErr(r.error);
                  setErr(null);
                  setEditing(false);
                  router.refresh();
                })
              }
            >
              이 위치로 저장
            </Button>
          </div>
        </div>
        {has && (
          <button
            type="button"
            className="mt-6 text-sm text-red-600 underline underline-offset-2"
            onClick={async () => {
              if (!(await ask({ title: "위치를 지울까요?", body: "이 세트가 「위치 없음」이 됩니다. 창고 실사에서 다시 정할 수 있습니다.", confirmLabel: "지우기", tone: "danger" }))) return;
              start(async () => {
                const r = await setStorageLocation(id, null);
                if (!r.ok) return setErr(r.error);
                setEditing(false);
                router.refresh();
              });
            }}
          >
            위치 지우기
          </button>
        )}
      </div>
    );

  return (
    <div>
      {has ? (
        <>
          <LocationFinder areas={areas} me={{ id, areaId: areaId!, slotId, stackNo }} mates={mates} />
          <Button variant="secondary" className="mt-3 w-full" onClick={() => setEditing(true)}>
            위치 바꾸기
          </Button>
        </>
      ) : (
        <>
          <p className="rounded-card border-2 border-amber-400 bg-amber-50 p-3 font-semibold text-amber-900">
            위치 없음 — 창고에서 보관번호 {formatStorageNo(no)} 스티커를 찾아 주세요
          </p>
          <Button size="lg" className="mt-2" onClick={() => setEditing(true)}>
            📍 위치 정하기
          </Button>
        </>
      )}
    </div>
  );
}
