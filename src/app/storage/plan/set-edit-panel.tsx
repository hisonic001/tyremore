"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useConfirm } from "@/components/ui/confirm";
import { updateCustomerInfo } from "@/lib/customer-edit";
import { suggestModels } from "@/lib/storage-area";
import { excludeStorage, moveStorage, releaseStorage, renumberStorage, setStoredOn, setVehicleModel, updateStorage } from "@/lib/tire-storage";
import { formatStorageNo, sizeHints, type StorageDropInput } from "@/lib/tire-storage-pure";
import { DropFields } from "../drop-fields";
import { monthToDate, MonthWheel } from "../month-wheel";
import { otherPlatesIn, VehiclePicker } from "../vehicle-picker";
import type { SetLite } from "./location";

const INPUT =
  "w-full rounded-control border-2 border-slate-300 bg-white px-3 py-3 text-lg placeholder:text-base placeholder:text-slate-400 focus:border-slate-900 focus:outline-none";

/**
 * ⭐ 두 번 톡톡 = 전부 고치기 (사장님 2026-11-18 — 「톡톡 눌러 수정할 때 다 수정 가능하게. 지금은 너무 일부분만 나옴」)
 *
 *   한 칸에서: 타이어 · 맡긴 날 · 손님 이름·전화 · 차종 → 「고친 것 저장」 한 번 (바뀐 것만 보낸다)
 *   따로 단추: 다른 차로 바꾸기 · 보관번호 바꾸기 · 찾아감 · 폐기 · 잘못 등록 지우기 (되돌리기 어려운 것은 확인창)
 *   서버 쪽은 상세 화면과 같은 정본(updateStorage·moveStorage·renumberStorage·releaseStorage·excludeStorage·updateCustomerInfo).
 */
export function SetEditPanel({
  set,
  today,
  onClose,
  onPatch,
  onGone,
}: {
  set: SetLite;
  today: string;
  onClose: () => void;
  /** 화면의 세트를 바로 고친다 */
  onPatch: (patch: Partial<SetLite>) => void;
  /** 찾아감·폐기·지우기 — 실사 목록에서 뺀다 */
  onGone: (msg: string) => void;
}) {
  const [ask, confirmNode] = useConfirm();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const drop0: StorageDropInput = { kind: (set.kind as StorageDropInput["kind"]) ?? null, brand: set.brand ?? "", size: set.size ?? "", qty: set.qty, dot: set.dot ?? "", memo: set.memo ?? "" };
  const [drop, setDrop] = useState(drop0);
  const unknown0 = /^맡긴 날 모름/.test(set.sourceText ?? "");
  const [unknown, setUnknown] = useState(unknown0);
  const so = set.storedOn ?? today;
  const ym0 = { y: Number(so.slice(0, 4)), m: Number(so.slice(5, 7)) };
  const [ym, setYm] = useState(ym0);
  const garage = !!set.supplierName;
  const [name, setName] = useState(set.owner);
  const [phone, setPhone] = useState(set.phone ?? "");
  const [model, setModel] = useState(set.model ?? "");
  const [models, setModels] = useState<string[]>([]);
  const [moving, setMoving] = useState(false);
  const [newNo, setNewNo] = useState(set.no != null ? String(set.no) : "");

  const dropChanged = JSON.stringify(drop) !== JSON.stringify(drop0);
  const dateChanged = unknown !== unknown0 || (!unknown && (ym.y !== ym0.y || ym.m !== ym0.m));
  const custChanged = !garage && set.customerId != null && (name.trim() !== set.owner || (phone.trim() || null) !== (set.phone ?? null));
  const modelChanged = set.vehicleId != null && model.trim() !== (set.model ?? "");
  const anyChanged = dropChanged || dateChanged || custChanged || modelChanged;

  const saveAll = () =>
    start(async () => {
      setErr(null);
      setOkMsg(null);
      const done: string[] = [];
      if (dropChanged) {
        const r = await updateStorage(set.id, drop);
        if (!r.ok) return setErr(`타이어: ${r.error}`);
        onPatch({ kind: drop.kind, brand: drop.brand, size: drop.size, qty: drop.qty, dot: drop.dot, memo: drop.memo, describe: [drop.brand, drop.size, `${drop.qty}본`].filter(Boolean).join(" ") });
        done.push("타이어");
      }
      if (dateChanged) {
        const date = unknown ? null : monthToDate(ym.y, ym.m, today);
        const r = await setStoredOn(set.id, date, !unknown);
        if (!r.ok) return setErr(`맡긴 날: ${r.error}`);
        onPatch({ storedOn: date ?? set.storedOn, sourceText: unknown ? "맡긴 날 모름" : `맡긴 날 대략 ${date!.slice(0, 7)}쯤` });
        done.push("맡긴 날");
      }
      if (custChanged) {
        let r = await updateCustomerInfo({ customerId: set.customerId!, name, phone });
        if (!r.ok && r.needsScopeConfirm) {
          if (!(await ask({ title: "여러 차가 붙은 손님입니다", body: r.needsScopeConfirm, confirmLabel: "그래도 고치기" }))) return setErr("손님 정보는 고치지 않았습니다");
          r = await updateCustomerInfo({ customerId: set.customerId!, name, phone, confirmScope: true });
        }
        if (!r.ok) return setErr(`손님: ${r.error}`);
        onPatch({ owner: name.trim(), phone: phone.trim() || null });
        done.push("손님");
      }
      if (modelChanged) {
        const r = await setVehicleModel(set.vehicleId!, model);
        if (!r.ok) return setErr(`차종: ${r.error}`);
        onPatch({ model: model.trim() || null });
        done.push("차종");
      }
      setOkMsg(`${done.join("·")} 고쳤습니다${dropChanged || custChanged ? " — 스티커 내용이 바뀌었으면 다시 뽑아 주세요" : ""}`);
    });

  const typeModel = (v: string) => {
    setModel(v);
    if (!v.trim()) return setModels([]);
    void suggestModels(v).then(setModels);
  };

  const status = (to: "찾아감" | "폐기" | "지우기") =>
    start(async () => {
      const t = {
        찾아감: { title: "손님이 찾아갔나요?", body: "보관 목록에서 빠지고 「찾아감」으로 남습니다.", label: "찾아감" },
        폐기: { title: "폐기했나요?", body: "보관 목록에서 빠지고 「폐기」로 남습니다.", label: "폐기", tone: "danger" as const },
        지우기: { title: "잘못 등록한 건가요?", body: "이 등록을 지웁니다(기록은 「제외」로 남고 번호는 다시 쓰지 않습니다). 붙인 스티커는 떼 주세요.", label: "등록 지우기", tone: "danger" as const },
      }[to];
      if (!(await ask({ title: t.title, body: t.body, confirmLabel: t.label, tone: "tone" in t ? t.tone : undefined }))) return;
      const r = to === "지우기" ? await excludeStorage(set.id, "잘못 등록(실사 화면)") : await releaseStorage(set.id, to);
      if (!r.ok) return setErr(r.error);
      onGone(`#${formatStorageNo(set.no)} ${set.plate ?? ""} — ${to === "지우기" ? "등록을 지웠습니다" : to + " 처리"}`);
    });

  return (
    <div className="mt-3 space-y-4 rounded-card border-2 border-amber-500 bg-amber-50 p-3">
      {confirmNode}
      <div className="flex items-start justify-between gap-2">
        <p className="text-lg font-extrabold">
          #{formatStorageNo(set.no)} {set.plate ?? "차량 없음"} {set.owner} — 고치기
        </p>
        <button type="button" onClick={onClose} className="min-h-11 shrink-0 rounded-control border-2 border-slate-300 bg-white px-3 text-sm font-bold">
          닫기
        </button>
      </div>

      {/* 타이어 */}
      <section>
        <p className="mb-1 font-bold">타이어</p>
        <DropFields value={drop} onChange={setDrop} disabled={pending} sizeHints={sizeHints(set.size, set.lastFittedSize)} />
      </section>

      {/* 맡긴 날 */}
      <section>
        <p className="mb-1 font-bold">
          맡긴 날 <span className="text-sm font-normal text-slate-600">지금: {unknown0 ? "모름" : set.storedOn}</span>
        </p>
        <div className="flex flex-wrap items-start gap-2">
          <button
            type="button"
            onClick={() => setUnknown(true)}
            className={`min-h-12 rounded-control px-4 text-lg font-extrabold ${unknown ? "bg-slate-900 text-white" : "border-2 border-slate-300 bg-white"}`}
          >
            모름
          </button>
          <div onClick={() => setUnknown(false)} className={unknown ? "opacity-50" : ""}>
            <MonthWheel value={ym} today={today} onChange={(v) => (setYm(v), setUnknown(false))} />
          </div>
        </div>
      </section>

      {/* 차·손님 */}
      <section className="space-y-2">
        <p className="font-bold">차·손님</p>
        {garage ? (
          <p className="text-sm text-slate-700">거래처 차({set.supplierName}) — 거래처 정보는 거래처 화면에서 고칩니다</p>
        ) : (
          <>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">손님 이름</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="손님 이름" className={INPUT} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">전화</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="전화" className={INPUT} />
            </label>
          </>
        )}
        {set.vehicleId != null && (
          <div className="relative">
            <span className="text-xs font-semibold text-slate-600">차종</span>
            <input value={model} onChange={(e) => typeModel(e.target.value)} placeholder="차종 (앞글자만 치면 고르기)" className={INPUT} />
            {models.length > 0 && model.trim() && !models.includes(model) && (
              <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-control border-2 border-slate-900 bg-white shadow-lg">
                {models.map((m) => (
                  <button key={m} type="button" onClick={() => (setModel(m), setModels([]))} className="block min-h-12 w-full border-b border-slate-100 px-3 text-left text-base font-semibold active:bg-slate-100">
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {err && <Notice tone="error">{err}</Notice>}
      {okMsg && <Notice tone="success">{okMsg}</Notice>}
      <Button size="lg" className="w-full" pending={pending} disabled={!anyChanged} onClick={saveAll}>
        {anyChanged ? "고친 것 저장" : "고친 것이 없습니다"}
      </Button>

      {/* 다른 차로 · 번호 · 상태 */}
      <section className="space-y-2 border-t border-amber-300 pt-3">
        <p className="font-bold">그 밖에</p>
        {moving ? (
          <VehiclePicker
            suggestions={otherPlatesIn(set.sourceText ?? "", set.plate)}
            pending={pending}
            onCancel={() => setMoving(false)}
            onPick={(h) =>
              start(async () => {
                if (!(await ask({ title: `${h.plateNo} ${h.customerName} 의 세트로 바꿀까요?`, body: "주인이 그 차의 주인으로 바뀝니다. 스티커를 다시 뽑아 붙여 주세요.", confirmLabel: "바꾸기" }))) return;
                const r = await moveStorage(set.id, h.vehicleId);
                if (!r.ok) return setErr(r.error);
                setMoving(false);
                onPatch({ plate: h.plateNo, owner: h.customerName, vehicleId: h.vehicleId, customerId: h.customerId, phone: h.phone, model: h.model });
                setOkMsg(`${h.plateNo} 의 세트로 바꿨습니다 — 스티커를 다시 뽑아 붙여 주세요`);
              })
            }
          />
        ) : (
          <button type="button" onClick={() => setMoving(true)} className="min-h-12 w-full rounded-control border-2 border-slate-900 bg-white text-base font-bold">
            다른 차(주인)의 타이어로 바꾸기
          </button>
        )}
        {set.no != null && (
          <div className="flex gap-2">
            <input value={newNo} onChange={(e) => setNewNo(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="보관번호" className={`${INPUT} min-w-0 flex-1`} />
            <Button
              variant="secondary"
              disabled={!newNo || Number(newNo) === set.no}
              pending={pending}
              onClick={() =>
                start(async () => {
                  const r = await renumberStorage(set.id, Number(newNo));
                  if (!r.ok) return setErr(r.error);
                  onPatch({ no: r.no });
                  setOkMsg("번호를 바꿨습니다 — 스티커를 다시 뽑아 붙여 주세요");
                })
              }
            >
              번호 바꾸기
            </Button>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <button type="button" disabled={pending} onClick={() => status("찾아감")} className="min-h-12 rounded-control border-2 border-slate-300 bg-white text-sm font-bold">
            찾아감
          </button>
          <button type="button" disabled={pending} onClick={() => status("폐기")} className="min-h-12 rounded-control border-2 border-red-200 bg-white text-sm font-bold text-red-700">
            폐기
          </button>
          <button type="button" disabled={pending} onClick={() => status("지우기")} className="min-h-12 rounded-control border-2 border-red-200 bg-white text-sm font-bold text-red-700">
            잘못 등록 지우기
          </button>
        </div>
      </section>
    </div>
  );
}
