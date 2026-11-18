"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { setStorageLocation } from "@/lib/storage-area";
import type { AreaInfo, PinRow } from "@/lib/tire-storage-data";
import { LocationFinder, LocationPicker } from "./location";

/** 보관 상세·붙이기·실사에서 쓰는 「📍 위치」 — 있으면 찾기 그림, 없으면 찍기 단추 */
export function LocationSection({
  id,
  areaId,
  x,
  y,
  areas,
  pins,
  startOpen = false,
  compact = false,
  onDone,
}: {
  id: number;
  areaId: number | null;
  x: number | null;
  y: number | null;
  areas: AreaInfo[];
  pins: PinRow[];
  startOpen?: boolean;
  /** 붙이기·실사 줄에서는 찾기 그림을 안 그리고 단추만 */
  compact?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [picking, setPicking] = useState(startOpen);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const has = areaId != null && x != null && y != null;

  if (picking)
    return (
      <>
        <LocationPicker
          areas={areas}
          pins={pins}
          selfId={id}
          value={{ areaId, x, y }}
          pending={pending}
          onCancel={() => setPicking(false)}
          onSave={(a, px, py) =>
            start(async () => {
              const r = await setStorageLocation(id, a, px, py);
              if (!r.ok) return setErr(r.error);
              setErr(null);
              setPicking(false);
              onDone?.();
              router.refresh();
            })
          }
        />
        {err && <Notice tone="error">{err}</Notice>}
      </>
    );

  return (
    <div className="mt-2">
      {has && !compact && <LocationFinder areas={areas} pins={pins} me={{ id, areaId: areaId!, x: x!, y: y! }} />}
      <Button variant={has ? "ghost" : "primary"} className={has ? "mt-1" : "w-full"} onClick={() => setPicking(true)}>
        <MapPin className="size-5" />
        {has ? "위치 바꾸기" : "📍 위치 찍기"}
      </Button>
    </div>
  );
}
