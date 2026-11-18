"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { searchVehicles } from "@/lib/search-actions";
import type { VehicleHit } from "@/lib/search";
import { listSuppliers } from "@/lib/supplier";
import { registerFoundSet, type FoundOwner, type Loc } from "@/lib/storage-area";
import { sizeHints, suggestDropKind, type StorageDropInput } from "@/lib/tire-storage-pure";
import { DropFields, emptyDrop } from "./drop-fields";

const INPUT =
  "w-full rounded-control border-2 border-slate-300 bg-white px-3 py-3 text-lg placeholder:text-base placeholder:text-slate-400 focus:border-slate-900 focus:outline-none";

export interface FoundSetDone {
  id: number;
  no: number;
  stackNo: number | null;
  vehicleId: number;
  plate: string;
  owner: string;
  reused: boolean;
  drop: StorageDropInput;
}

/**
 * ⭐ 처음 보는 세트 — 손님·차·거래처가 앱에 없어도 여기서 한 번에 (사장님 2026-11-18)
 *
 *   「오늘 맡긴 것도 아니고 실사 중에 나오는데 등록된 손님·차·거래처가 없음 —
 *    맡김 등록하면서 그걸 할 수 있게 넘어가서 빠르게 실사·등록이 되어야」.
 *   전엔 「판매 등록에서 손님·차량을 먼저」에서 막혔다.
 *
 *   ① 차번호 → 이미 있는 차면 「이 차 맞아요」 한 번 ② 없으면 개인 손님(이름·전화) 또는 거래처 고르기
 *   ③ 타이어 내용(고르기) ④ 맡긴 날(모르면 「모름」) → 등록 = 번호 + (실사 화면이면) 지금 더미에 놓기.
 */
export function FoundSetForm({
  initialQuery,
  loc,
  locText,
  today,
  onDone,
  onCancel,
}: {
  initialQuery: string;
  /** 창고 실사 화면의 지금 위치 — 있으면 등록과 동시에 그 더미에 놓는다 */
  loc: Loc | null;
  locText?: string | null;
  today: string;
  onDone: (r: FoundSetDone) => void;
  onCancel: () => void;
}) {
  const q0 = initialQuery.trim();
  const [plate, setPlate] = useState(/^\d+$/.test(q0.replace(/\s/g, "")) ? "" : q0);
  const [hits, setHits] = useState<VehicleHit[]>([]);
  const [picked, setPicked] = useState<VehicleHit | null>(null);
  const [mode, setMode] = useState<"손님" | "거래처">("손님");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [suppliers, setSuppliers] = useState<string[] | null>(null);
  const [sq, setSq] = useState("");
  const [supplier, setSupplier] = useState<string | null>(null);
  const [drop, setDrop] = useState<StorageDropInput>(() => emptyDrop(suggestDropKind({ month: Number(today.slice(5, 7)) })));
  const [dateKnown, setDateKnown] = useState(!loc); // 실사 화면은 「모름」이 기본
  const [storedOn, setStoredOn] = useState(today);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 차번호(없으면 실사 검색어 — 끝 4자리 등)로 이미 있는 차를 찾는다
  const needle = plate.trim() || q0;
  useEffect(() => {
    if (picked || needle.replace(/\s/g, "").length < 2) return setHits([]);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void searchVehicles(needle).then((r) => setHits(r.slice(0, 5))), 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [needle, picked]);

  useEffect(() => {
    if (mode !== "거래처" || suppliers !== null) return;
    void listSuppliers().then((rows) => setSuppliers(rows.filter((r) => r.isActive).map((r) => r.name)));
  }, [mode, suppliers]);

  const norm = (s: string) => s.replace(/\s/g, "").toLowerCase();
  const supplierHits = (suppliers ?? []).filter((n) => !sq.trim() || norm(n).includes(norm(sq))).slice(0, 12);

  const pick = (h: VehicleHit) => {
    setPicked(h);
    if (!drop.size && h.lastFittedSize) setDrop({ ...drop, size: h.lastFittedSize });
  };

  const submit = () =>
    start(async () => {
      setErr(null);
      const owner: FoundOwner = picked
        ? { kind: "차량", vehicleId: picked.vehicleId }
        : mode === "손님"
          ? { kind: "손님", name, phone }
          : { kind: "거래처", supplier: supplier ?? "" };
      if (owner.kind === "거래처" && !supplier) return setErr("거래처를 골라 주세요");
      const r = await registerFoundSet({ plate: picked ? picked.plateNo : plate, owner, drop, storedOn: dateKnown ? storedOn : null, loc });
      if (!r.ok) return setErr(r.error);
      onDone({ id: r.id, no: r.no, stackNo: r.stackNo, vehicleId: r.vehicleId, plate: r.plate, owner: r.owner, reused: r.reused, drop });
    });

  return (
    <div className="mt-3 space-y-4 rounded-card border-2 border-slate-900 bg-white p-3">
      <div>
        <p className="text-lg font-extrabold">처음 보는 세트 — 여기서 바로 등록</p>
        {loc && locText && <p className="text-sm font-semibold text-blue-800">📍 {locText}에 놓입니다</p>}
      </div>

      {/* ① 어느 차 */}
      <section>
        <p className="mb-1 font-bold">① 타이어에 적힌 차번호</p>
        {picked ? (
          <div className="flex items-center gap-2 rounded-card bg-slate-50 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-extrabold">
                {picked.plateNo} · {picked.customerName}
              </p>
              <p className="truncate text-sm text-slate-600">{[picked.makerName, picked.model].filter(Boolean).join(" ")} — 이미 있는 차</p>
            </div>
            <Button variant="ghost" onClick={() => setPicked(null)}>
              바꾸기
            </Button>
          </div>
        ) : (
          <>
            <input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="전체 번호 (예: 12가3456)" className={INPUT} autoFocus />
            {hits.length > 0 && (
              <div className="mt-2 rounded-card border border-amber-300 bg-amber-50 p-2">
                <p className="text-sm font-semibold text-amber-900">이미 있는 차일 수 있어요 — 맞으면 누르세요</p>
                {hits.map((h) => (
                  <button
                    key={h.vehicleId}
                    type="button"
                    onClick={() => pick(h)}
                    className="mt-1.5 block min-h-12 w-full rounded-control border border-amber-300 bg-white px-3 py-2 text-left active:bg-amber-100"
                  >
                    <span className="block font-bold">
                      {h.plateNo} · {h.customerName}
                    </span>
                    <span className="block text-xs text-slate-600">{[h.makerName, h.model, h.lastFittedSize].filter(Boolean).join(" · ")}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* ② 누구 것 — 이미 있는 차를 골랐으면 그 차 주인 */}
      {!picked && (
        <section>
          <p className="mb-1 font-bold">② 누구 타이어인가요?</p>
          <div className="grid grid-cols-2 gap-2">
            {(["손님", "거래처"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`min-h-12 rounded-control text-base font-bold ${mode === m ? "bg-slate-900 text-white" : "border-2 border-slate-300 bg-white text-slate-800"}`}
              >
                {m === "손님" ? "개인 손님" : "거래처 차"}
              </button>
            ))}
          </div>
          {mode === "손님" ? (
            <div className="mt-2 space-y-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="손님 이름" className={INPUT} />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="전화 (몰라도 됩니다)" className={INPUT} />
            </div>
          ) : supplier ? (
            <div className="mt-2 flex items-center gap-2 rounded-card bg-slate-50 p-3">
              <p className="min-w-0 flex-1 truncate text-lg font-extrabold">{supplier}</p>
              <Button variant="ghost" onClick={() => setSupplier(null)}>
                바꾸기
              </Button>
            </div>
          ) : (
            <div className="mt-2">
              <input value={sq} onChange={(e) => setSq(e.target.value)} placeholder="거래처 이름 찾기" className={INPUT} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {suppliers === null && <span className="text-sm text-slate-500">불러오는 중…</span>}
                {supplierHits.map((n) => (
                  <button key={n} type="button" onClick={() => setSupplier(n)} className="min-h-11 rounded-full border-2 border-slate-300 bg-white px-3 text-base font-medium">
                    {n}
                  </button>
                ))}
                {suppliers !== null && supplierHits.length === 0 && <span className="text-sm text-slate-500">그런 거래처가 없습니다 — 설정 › 거래처에서 먼저 만들어 주세요</span>}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ③ 타이어 */}
      <section>
        <p className="mb-1 font-bold">③ 타이어</p>
        <DropFields value={drop} onChange={setDrop} disabled={pending} sizeHints={sizeHints(picked?.lastFittedSize)} />
      </section>

      {/* ④ 맡긴 날 */}
      <section>
        <p className="mb-1 font-bold">④ 맡긴 날</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setDateKnown(false)}
            className={`min-h-11 rounded-full px-4 text-base font-bold ${!dateKnown ? "bg-slate-900 text-white" : "border-2 border-slate-300 bg-white"}`}
          >
            모름
          </button>
          <button
            type="button"
            onClick={() => setDateKnown(true)}
            className={`min-h-11 rounded-full px-4 text-base font-bold ${dateKnown ? "bg-slate-900 text-white" : "border-2 border-slate-300 bg-white"}`}
          >
            날짜 고르기
          </button>
          {dateKnown && (
            <input
              type="date"
              value={storedOn}
              max={today}
              onChange={(e) => setStoredOn(e.target.value)}
              className="tabular min-h-11 rounded-control border-2 border-slate-300 bg-white px-3"
            />
          )}
        </div>
        {!dateKnown && <p className="mt-1 text-xs text-slate-500">「맡긴 날 모름」으로 기록이 남고, 날짜 칸은 오늘(등록한 날)로 들어갑니다.</p>}
      </section>

      {err && <Notice tone="error">{err}</Notice>}

      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          그만두기
        </Button>
        <Button size="lg" className="flex-1" pending={pending} onClick={submit}>
          {loc ? "등록하고 여기 ✓" : "등록하고 보관번호 받기"}
        </Button>
      </div>
    </div>
  );
}
