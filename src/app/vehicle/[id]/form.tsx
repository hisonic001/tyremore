"use client";

/** 고객·차량 정보 수정 폼 — /vehicle/[id] (사장님 요청 2026-08-05) */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCustomerInfo, updateVehicleInfo } from "@/lib/customer-edit";
import { isMarsMaker, makerSuggestions, MARS_MAKER_LIST_ID, MarsMakerDatalist } from "@/lib/mars-makers";

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
    mileage: number | null;
    vin: string | null;
    memo: string | null;
  };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [address, setAddress] = useState(customer.address ?? "");

  const [plate, setPlate] = useState(vehicle.plateNo);
  const [maker, setMaker] = useState(vehicle.makerName ?? "");
  const [model, setModel] = useState(vehicle.model ?? "");
  const [year, setYear] = useState(vehicle.year ? String(vehicle.year) : "");
  const [mileage, setMileage] = useState(vehicle.mileage ? String(vehicle.mileage) : "");
  const [vin, setVin] = useState(vehicle.vin ?? "");
  const [memo, setMemo] = useState(vehicle.memo ?? "");

  function save() {
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
        mileage: mileage ? Number(mileage.replace(/\D/g, "")) : null,
        vin,
        memo,
      });
      if (!rv.ok) return setError(rv.error);
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

      <button
        type="button"
        disabled={pending}
        onClick={save}
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
