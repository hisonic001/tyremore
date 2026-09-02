"use client";

/** 고객·차량 정보 수정 폼 — /vehicle/[id] (사장님 요청 2026-08-05) */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCustomerInfo, updateVehicleInfo } from "@/lib/customer-edit";
import { isMarsMaker, makerSuggestions, MARS_MAKER_LIST_ID, MarsMakerDatalist } from "@/lib/mars-makers";
import { FUEL_TYPES } from "@/lib/sale-types";

const FIELD = "mt-0.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base outline-none focus:border-slate-900";
const LB = "block text-xs font-medium text-slate-500";

export function VehicleEditForm({
  customer,
  vehicle,
}: {
  customer: { customerId: number; name: string; phone: string | null; address: string | null };
  vehicle: {
    vehicleId: number;
    plateNo: string;
    makerName: string | null;
    model: string | null;
    year: number | null;
    fuelType: string | null;
    mileage: number | null;
    vin: string | null;
    memo: string | null;
  };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* ⭐ 번호판이 바뀌면 뜻을 묻는다 (조혜진 사건 2026-09-02) — 차 바꿈 vs 오타 수정 */
  const [plateChoice, setPlateChoice] = useState(false);

  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [address, setAddress] = useState(customer.address ?? "");

  const [plate, setPlate] = useState(vehicle.plateNo);
  const [maker, setMaker] = useState(vehicle.makerName ?? "");
  const [model, setModel] = useState(vehicle.model ?? "");
  const [year, setYear] = useState(vehicle.year ? String(vehicle.year) : "");
  // ⭐ 연료 (2026-08-17) — MARS 필수 정보인데 여기서만 고칠 수 있다 (판매 등록 밖에서는 처음)
  const [fuel, setFuel] = useState(vehicle.fuelType ?? "");
  const [mileage, setMileage] = useState(vehicle.mileage ? String(vehicle.mileage) : "");
  const [vin, setVin] = useState(vehicle.vin ?? "");
  const [memo, setMemo] = useState(vehicle.memo ?? "");

  function save(plateChangeMode?: "fix" | "replace") {
    start(async () => {
      setError(null);
      setMsg(null);
      // 🔴 제조사는 MARS 목록에 있는 이름만 (사장님 제보 2026-08-09) — 아니면 MARS 등록이 실패한다
      if (maker.trim() && !isMarsMaker(maker)) {
        const near = makerSuggestions(maker);
        setError(
          `제조사 「${maker.trim()}」 는 MARS 목록에 없습니다 — 목록에서 골라 주세요.` +
            (near.length ? ` 비슷한 것: ${near.join(" · ")}` : ""),
        );
        return;
      }
      const rc = await updateCustomerInfo({ customerId: customer.customerId, name, phone, address });
      if (!rc.ok) return setError(rc.error);
      const rv = await updateVehicleInfo({
        vehicleId: vehicle.vehicleId,
        plateNo: plate,
        makerName: maker,
        model,
        year: year ? Number(year) : null,
        fuelType: fuel || null,
        mileage: mileage ? Number(mileage.replace(/\D/g, "")) : null,
        vin,
        memo,
        plateChangeMode,
      });
      if (!rv.ok) {
        if (rv.needsPlateChoice) return setPlateChoice(true);
        return setError(rv.error);
      }
      setPlateChoice(false);
      if (rv.newVehicleId) {
        // 차 바꿈 — 새 차량 카드로 이동 (옛 차와 과거 내역은 그대로)
        router.push(`/vehicle/${rv.newVehicleId}`);
        return;
      }
      setMsg("저장했습니다");
      router.refresh();
    });
  }

  return (
    <div className="mt-5 space-y-5">
      <section className="rounded-2xl border border-slate-300 bg-white p-4">
        <h2 className="font-bold">고객</h2>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <label className="col-span-2 sm:col-span-1">
            <span className={LB}>이름</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={FIELD} />
          </label>
          <label className="col-span-2 sm:col-span-1">
            <span className={LB}>휴대폰</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className={FIELD} />
          </label>
          <label className="col-span-2">
            <span className={LB}>주소</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} className={FIELD} />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-300 bg-white p-4">
        <h2 className="font-bold">차량</h2>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <label>
            <span className={LB}>차량번호</span>
            <input value={plate} onChange={(e) => setPlate(e.target.value)} className={FIELD + " tabular"} />
          </label>
          <label>
            <span className={LB}>제조사</span>
            {/* MARS 목록에서 고른다 (2026-08-09) — 치면 목록이 걸러져 나온다 */}
            <input
              value={maker}
              onChange={(e) => setMaker(e.target.value)}
              list={MARS_MAKER_LIST_ID}
              placeholder="치면 목록이 나옵니다"
              className={FIELD}
            />
            <MarsMakerDatalist />
          </label>
          <label>
            <span className={LB}>모델</span>
            <input value={model} onChange={(e) => setModel(e.target.value)} className={FIELD} />
          </label>
          <label>
            <span className={LB}>연식</span>
            <input
              value={year}
              onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              className={FIELD + " tabular"}
            />
          </label>
          <div className="col-span-2">
            {/* ⭐ 연료 (2026-08-17) — MARS 차량 필수 정보. 값은 MARS 표기 그대로 (Fuel·Diesel…) */}
            <span className={LB}>연료</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {FUEL_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setFuel((cur) => (cur === t.value ? "" : t.value))}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${
                    fuel === t.value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <label>
            <span className={LB}>주행거리 (km)</span>
            <input
              value={mileage === "" ? "" : Number(mileage).toLocaleString()}
              onChange={(e) => setMileage(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              className={FIELD + " tabular"}
            />
          </label>
          <label className="col-span-2">
            {/* ⭐ 차대번호 (사장님 요청 2026-08-10) — 17자라 두 칸을 다 쓴다 */}
            <span className={LB}>차대번호</span>
            <input
              value={vin}
              onChange={(e) => setVin(e.target.value.toUpperCase().replace(/\s/g, ""))}
              placeholder="예: KMHD841DBGU165729"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className={FIELD + " tabular"}
            />
          </label>
          <label className="col-span-2">
            <span className={LB}>메모</span>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} className={FIELD} />
          </label>
        </div>
      </section>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}

      {/* ⭐ 번호판 변경의 뜻 확인 (2026-09-02 조혜진 사건 재발 방지) */}
      {plateChoice && (
        <div className="rounded-xl border-2 border-violet-400 bg-violet-50 p-3">
          <p className="text-sm font-bold text-violet-900">
            차량번호가 {vehicle.plateNo} → {plate.trim()} 로 바뀌었습니다
          </p>
          <p className="mt-1 text-xs text-violet-800">
            <strong>차를 바꾸셨다면</strong> 새 차량으로 등록합니다 — 지금까지의 정비 내역은
            이전 차({vehicle.plateNo})에 그대로 남고, 앞으로의 정비만 새 차로 나갑니다.
          </p>
          <div className="mt-2 flex flex-col gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => save("replace")}
              className="rounded-lg bg-violet-700 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              🚗 차를 바꿨어요 — 새 차량으로 등록 (권장)
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => save("fix")}
              className="rounded-lg border border-slate-300 bg-white py-2.5 text-sm text-slate-600 disabled:opacity-50"
            >
              번호 오타를 고친 것 — 이 차량 기록을 그대로 수정 (과거 내역 표시도 바뀜)
            </button>
            <button type="button" onClick={() => setPlateChoice(false)} className="text-xs text-slate-500 underline">
              그만두기
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={() => save()}
        className="w-full rounded-xl bg-slate-900 py-3.5 font-semibold text-white disabled:opacity-50"
      >
        {pending ? "저장 중…" : "저장"}
      </button>
      <p className="text-xs text-slate-400">
        MARS 번호(연락처 C·차량 V)는 자동 입력의 열쇠라 여기서 못 고칩니다. 여기 수정은 우리 기록에만
        반영됩니다 — MARS 쪽 정보는 MARS 에서 고쳐 주세요.
      </p>
    </div>
  );
}
