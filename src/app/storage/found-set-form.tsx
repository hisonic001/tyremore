"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { searchVehicles } from "@/lib/search-actions";
import type { VehicleHit } from "@/lib/search";
import { listSuppliers } from "@/lib/supplier";
import { foundSetHints, registerFoundSet, suggestModels, type FoundOwner, type Loc } from "@/lib/storage-area";
import { sizeHints, suggestDropKind, type StorageDropInput } from "@/lib/tire-storage-pure";
import { DropFields, emptyDrop } from "./drop-fields";
import { monthToDate, MonthWheel } from "./month-wheel";

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
  // 실사 때 친 「3398」도 그대로 둔다 — 앞자리만 더 치면 된다 (사장님 2026-11-18)
  const [plate, setPlate] = useState(q0);
  /** 차종 (선택) — 사장님 2026-11-18 「차량이 뭔지도 선택적으로 적을 수 있는 칸」 */
  const [model, setModel] = useState("");
  const [hits, setHits] = useState<VehicleHit[]>([]);
  const [picked, setPicked] = useState<VehicleHit | null>(null);
  const [mode, setMode] = useState<"손님" | "거래처">("손님");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [suppliers, setSuppliers] = useState<string[] | null>(null);
  const [sq, setSq] = useState("");
  const [supplier, setSupplier] = useState<string | null>(null);
  const [drop, setDrop] = useState<StorageDropInput>(() => emptyDrop(suggestDropKind({ month: Number(today.slice(5, 7)) })));
  /** 맡긴 날 — 「모름」 또는 연도·월 바퀴 (사장님 2026-11-18 「연도·월이 나오게 하고 누른 뒤 스크롤해서 고르게」). 실사 화면은 모름이 기본 */
  const [unknown, setUnknown] = useState(!!loc);
  const [ym, setYm] = useState({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) });
  /** 「이 차 규격」 바로 고르기 — 판매 기록·같은 차종 */
  const [sizeHintList, setSizeHintList] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [modelOpen, setModelOpen] = useState(false);
  const mTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  /** 차를 고르면 그 차에 끼운 규격을 판매 기록에서 찾아 **바로 넣는다** (차 칸의 「지난번 규격」은 비어 있다) */
  const pick = (h: VehicleHit) => {
    setPicked(h);
    void foundSetHints({ vehicleId: h.vehicleId, model: h.model }).then((r) => {
      setSizeHintList(r.sizes);
      if (r.sizes[0]) setDrop((d) => (d.size ? d : { ...d, size: r.sizes[0] }));
    });
  };

  // 전체 번호를 다 쳤고 그 번호의 차가 앱에 딱 하나 있으면 저절로 고른다
  useEffect(() => {
    if (picked) return;
    const n = norm(plate);
    if (!/[가-힣]/.test(n) || n.length < 7) return;
    const same = hits.filter((h) => norm(h.plateNo) === n);
    if (same.length === 1) pick(same[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, plate, picked]);

  // 차종 자동완성 — 앞글자만 쳐도 (차종 목록 + 손님 차에 적힌 이름)
  const typeModel = (v: string) => {
    setModel(v);
    setModelOpen(true);
    if (mTimer.current) clearTimeout(mTimer.current);
    if (!v.trim()) return setModels([]);
    mTimer.current = setTimeout(() => void suggestModels(v).then(setModels), 200);
  };
  const chooseModel = (m: string) => {
    setModel(m);
    setModelOpen(false);
    void foundSetHints({ model: m }).then((r) => setSizeHintList((old) => [...new Set([...old, ...r.sizes])].slice(0, 4)));
  };
  const modelBox = (placeholder: string) => (
    <div className="relative mt-2">
      <input
        value={model}
        onChange={(e) => typeModel(e.target.value)}
        onFocus={() => model && setModelOpen(true)}
        onBlur={() => setTimeout(() => setModelOpen(false), 150)}
        placeholder={placeholder}
        className={INPUT}
      />
      {modelOpen && models.length > 0 && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-control border-2 border-slate-900 bg-white shadow-lg">
          {models.map((m) => (
            <button
              key={m}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => chooseModel(m)}
              className="block min-h-12 w-full border-b border-slate-100 px-3 text-left text-base font-semibold active:bg-slate-100"
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );


  const submit = () =>
    start(async () => {
      setErr(null);
      const owner: FoundOwner = picked
        ? { kind: "차량", vehicleId: picked.vehicleId }
        : mode === "손님"
          ? { kind: "손님", name, phone }
          : { kind: "거래처", supplier: supplier ?? "" };
      if (owner.kind === "거래처" && !supplier) return setErr("거래처를 골라 주세요");
      const r = await registerFoundSet({
        plate: picked ? picked.plateNo : plate,
        model,
        owner,
        drop,
        storedOn: unknown ? null : monthToDate(ym.y, ym.m, today),
        storedApprox: !unknown,
        loc,
      });
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
        ) : null}
        {picked && !picked.model && modelBox("차종이 비어 있어요 — 알면 앞글자만 (예: 쏘)")}
        {picked ? null : (
          <>
            <input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="전체 번호 (예: 12가3456)" className={INPUT} autoFocus />
            {modelBox("차종 — 앞글자만 치면 아래에서 고르기 (몰라도 됨)")}
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
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="손님 이름 — 몰라도 됩니다" className={INPUT} />
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
        <DropFields value={drop} onChange={setDrop} disabled={pending} sizeHints={sizeHints(...sizeHintList, picked?.lastFittedSize)} />
      </section>

      {/* ④ 맡긴 날 — 모름 또는 연도·월 바퀴 */}
      <section>
        <p className="mb-1 font-bold">④ 맡긴 달</p>
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
        <p className="mt-1 text-xs text-slate-500">
          {unknown ? "「맡긴 날 모름」으로 남고, 날짜 칸은 오늘(등록한 날)로 들어갑니다." : `${ym.y}년 ${ym.m}월 「대략」으로 남습니다.`}
        </p>
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
