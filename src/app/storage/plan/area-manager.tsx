"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useConfirm } from "@/components/ui/confirm";
import { addArea, hideArea, renameArea, saveAreaPlan, setAreaImage } from "@/lib/storage-area";
import type { AreaInfo } from "@/lib/tire-storage-data";
import { formatStorageNo } from "@/lib/tire-storage-pure";
import { slotLabel, stacksIn } from "@/lib/storage-plan-pure";
import { StackStrip } from "./stack-strip";
import type { SetLite } from "./location";
import { areaImageUrl, PlanCanvas, toPlan } from "./plan-canvas";
import { PlanEditor } from "./plan-editor";

/** 사진을 화면에서 1600px·JPEG 로 줄인다 — 서버엔 900KB 아래만 */
async function shrinkImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = bad;
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.8, 0.65, 0.5]) {
      const d = c.toDataURL("image/jpeg", q);
      if (d.length < 880_000) return d;
    }
    return c.toDataURL("image/jpeg", 0.4);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * ⭐ 「구역」 탭 (2026-11-18) — 배치도·구역 도면 보기 + (판매 수정 권한) 도면 고치기·사진·이름·더하기·숨기기.
 *   앱이 그려 둔 기본 도면을 사장님이 실제대로 고친다 (사장님: 「알아서 그려 주거나 내가 살짝 수정 가능하게」).
 */
export function AreaManager({
  areas,
  sets,
  occupied,
  canEdit,
}: {
  areas: AreaInfo[];
  sets: SetLite[];
  occupied: { areaId: number; slotId: string; sets: number; stacks: number }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [ask, confirmNode] = useConfirm();
  const [selId, setSelId] = useState<number>(areas[0]?.id ?? 0);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [newName, setNewName] = useState("");
  const [slotId, setSlotId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const sel = areas.find((a) => a.id === selId) ?? areas[0];
  const rooms = areas.filter((a) => !a.isSite);
  if (!sel) return <p className="mt-4 text-slate-500">구역이 없습니다.</p>;
  const plan = toPlan(sel.plan);
  const occHere = occupied.filter((o) => o.areaId === sel.id);
  const badges: Record<string, string> = Object.fromEntries(occHere.map((o) => [o.slotId, `${o.sets}세트`]));

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setMsg({ tone: "error", text: r.error });
      setMsg({ tone: "success", text: done });
      after?.();
      router.refresh();
    });

  return (
    <div className="mt-3">
      {confirmNode}
      <div className="flex flex-wrap gap-1.5">
        {areas.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => {
              setSelId(a.id);
              setEditing(false);
              setSlotId(null);
              setName(a.name);
            }}
            className={`min-h-11 rounded-full px-3.5 text-sm font-medium ${a.id === sel.id ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}
          >
            {a.isSite ? "🗺 " : ""}
            {a.name}
            {!a.isSite && <span className="ml-1 text-xs opacity-70">{sets.filter((p) => p.areaId === a.id).length}</span>}
          </button>
        ))}
      </div>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <div className="mt-3">
        {editing ? (
          <PlanEditor
            key={sel.id}
            initial={plan}
            isSite={sel.isSite}
            areas={rooms.map((r) => ({ id: r.id, name: r.name }))}
            occupied={Object.fromEntries(occHere.map((o) => [o.slotId, o.sets]))}
            pending={pending}
            onCancel={() => setEditing(false)}
            onSave={(p) => run(() => saveAreaPlan(sel.id, p), "도면을 저장했습니다", () => setEditing(false))}
          />
        ) : (
          <>
            <PlanCanvas
              plan={plan}
              badges={sel.isSite ? {} : badges}
              selectedId={slotId}
              onSlotTap={sel.isSite ? undefined : (sh) => setSlotId(sh.id)}
              onShapeTap={
                sel.isSite
                  ? (sh) => {
                      const id = sh.areaIds?.[0];
                      const to = areas.find((a) => a.id === id);
                      if (!to) return;
                      // 구역 버튼과 똑같이 초기화 — 이름 칸·고른 자리가 옛 구역 것으로 남지 않게
                      setSelId(to.id);
                      setEditing(false);
                      setSlotId(null);
                      setName(to.name);
                    }
                  : undefined
              }
            />
            {sel.isSite && <p className="mt-1 text-sm text-slate-600">건물을 누르면 그 구역 도면으로 갑니다.</p>}
            {/* 사진은 도면 밑에 깔지 않는다(글자가 안 보임) — 따로 작게 */}
            {areaImageUrl(sel) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={areaImageUrl(sel)!} alt={`${sel.name} 사진`} className="mt-2 max-h-48 w-full rounded-control object-cover" />
            )}
            {!sel.isSite && slotId && (
              <div className="mt-2 rounded-card border-2 border-slate-900 p-3">
                <p className="text-lg font-extrabold">
                  {sel.name} › {slotLabel(plan, slotId)}
                </p>
                {stacksIn(sets, sel.id, slotId).length > 0 && (
                  <div className="mt-2">
                    <StackStrip
                      sets={sets.filter((x) => x.areaId === sel.id && x.slotId === slotId)}
                      count={0}
                      current={null}
                      showList={false}
                    />
                  </div>
                )}
                {stacksIn(sets, sel.id, slotId).map((st) => (
                  <div key={st.no} className="mt-2">
                    <p className="font-bold">
                      더미 {st.no} · {st.sets.length}세트 · {st.tires}본
                    </p>
                    <ul className="text-sm">
                      {st.sets.map((x) => (
                        <li key={x.id}>
                          <a href={`/storage/${x.id}`} className="underline underline-offset-2">
                            #{formatStorageNo(x.no)} {x.plate} {x.owner} · {x.describe}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {stacksIn(sets, sel.id, slotId).length === 0 && <p className="mt-1 text-sm text-slate-600">비어 있는 자리입니다.</p>}
              </div>
            )}
          </>
        )}
      </div>

      {canEdit && !editing && (
        <div className="mt-3 space-y-2 rounded-card border border-slate-200 bg-white p-3">
          <Button variant="secondary" className="w-full" onClick={() => setEditing(true)}>
            ✏️ 도면 고치기 (자리 옮기기·크기·이름)
          </Button>
          {!sel.isSite && (
            <a
              href={`/print/storage/signs?area=${sel.id}`}
              target="_blank"
              className="flex min-h-11 items-center justify-center rounded-control border border-slate-300 bg-white text-sm font-semibold text-slate-800"
            >
              🪧 자리 표지 인쇄 — 자리 이름을 A4 에 크게 뽑아 벽에 붙이기
            </a>
          )}
          <div className="flex gap-2">
            <input
              value={name || sel.name}
              onChange={(e) => setName(e.target.value)}
              className="min-w-0 flex-1 rounded-control border border-slate-300 px-3 py-2.5 text-base"
              aria-label="구역 이름"
            />
            <Button variant="secondary" pending={pending} onClick={() => run(() => renameArea(sel.id, name || sel.name), "이름을 바꿨습니다")}>
              이름 저장
            </Button>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-control border border-dashed border-slate-400 text-sm text-slate-600">
            📷 {sel.hasImage ? "배경 사진 바꾸기" : "배경 사진 넣기 (선택 — 도면 뒤에 흐리게)"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const d = await shrinkImage(f);
                run(() => setAreaImage(sel.id, d), "배경 사진을 넣었습니다");
              }}
            />
          </label>
          {sel.hasImage && (
            <button type="button" onClick={() => run(() => setAreaImage(sel.id, null), "배경 사진을 뺐습니다")} className="text-xs text-slate-500 underline">
              배경 사진 빼기
            </button>
          )}
          {!sel.isSite && (
            <button
              type="button"
              onClick={async () => {
                if (!(await ask({ title: `「${sel.name}」 구역을 숨길까요?`, body: "보관 중인 세트가 있으면 숨길 수 없습니다.", confirmLabel: "숨기기", tone: "danger" }))) return;
                run(() => hideArea(sel.id), "구역을 숨겼습니다", () => setSelId(areas[0].id));
              }}
              className="block text-xs text-red-600 underline"
            >
              이 구역 숨기기
            </button>
          )}
          <div className="flex gap-2 border-t border-slate-100 pt-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="새 구역 이름 (예: 컨테이너)"
              className="min-w-0 flex-1 rounded-control border border-slate-300 px-3 py-2.5 text-base"
            />
            <Button pending={pending} onClick={() => run(() => addArea(newName), "구역을 더했습니다 — 배치도의 건물에 이어 주세요", () => setNewName(""))}>
              + 구역
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
