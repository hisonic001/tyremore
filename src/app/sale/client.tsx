"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProductHit, VehicleHit } from "@/lib/search";
import { searchProducts, searchVehicles } from "@/lib/search-actions";
import { createCustomerAndVehicle, findServices, saveSale, type SaleLine } from "@/lib/sale";
import { BODY_TYPES, FUEL_TYPES, type NewCustomerInput } from "@/lib/sale-types";

const won = (n: number) => n.toLocaleString();

/** 담긴 한 줄 */
interface Row extends SaleLine {
  key: string;
  /** 인치 — 화면에서만 쓴다 (저장할 때는 뺀다) */
  rimInch?: number | null;
}

const PAYMENTS = ["카드", "현금", "계좌이체", "외상"] as const;

export function SaleForm() {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [vehicle, setVehicle] = useState<VehicleHit | null>(null);
  const [walkIn, setWalkIn] = useState({ name: "", phone: "", plateNo: "" });
  const [mileage, setMileage] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [payment, setPayment] = useState<string>("카드");
  const [memo, setMemo] = useState("");
  const [done, setDone] = useState<{ quoteNo: string; shortages: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = rows.reduce((s, r) => s + r.unitPrice * r.qty, 0);

  /**
   * 🔴 공임·밸런스를 **자동으로 올리지 않는다** (사장님 지시 2026-08-02).
   *
   *   "타이어를 입력하면 자동으로 휠타이어 교환이나 휠밸런스가 올라가는데
   *    그럴 필요 없음. 그냥 타이어 값에 보통 포함되거든."
   *
   * 처음엔 「빼는 것은 쉽고 넣는 것은 잊는다」고 보고 자동으로 올렸는데,
   * 매장 실제와 달랐다. 따로 받는 경우에만 아래 「공임·정비 추가」로 넣으시면 된다.
   */

  const addTire = (p: ProductHit) => {
    const price = p.salePrice ?? p.listPrice ?? 0;
    setRows((rs) => {
      const hit = rs.find((r) => r.productId === p.productId);
      if (hit) return rs.map((r) => (r === hit ? { ...r, qty: r.qty + 1 } : r));
      return [
        ...rs,
        {
          key: `t-${p.productId}`,
          kind: "tire",
          productId: p.productId,
          description: p.model,
          marsName: p.marsName,
          marsNo: p.cai,
          qty: 1,
          listPrice: p.listPrice,
          salesRate: p.salesRate,
          unitPrice: price,
          rimInch: p.spec ? Number(/R(\d{2})/.exec(p.spec)?.[1] ?? 0) || null : null,
        },
      ];
    });
  };

  const setRow = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const removeRow = (r: Row) => {
    setRows((rs) => rs.filter((x) => x.key !== r.key));
  };

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await saveSale({
        vehicleId: vehicle?.vehicleId ?? null,
        customerId: vehicle?.customerId ?? null,
        walkIn: vehicle ? null : walkIn.name || walkIn.phone || walkIn.plateNo ? walkIn : null,
        lines: rows.map(({ key, rimInch, ...l }) => l),
        paymentMethod: payment,
        memo: memo.trim() || null,
        mileage: mileage ? Number(mileage.replace(/\D/g, "")) : null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone({ quoteNo: res.quoteNo, shortages: res.shortages });
      setRows([]);
      setVehicle(null);
      setWalkIn({ name: "", phone: "", plateNo: "" });
      setMileage("");
      setMemo("");
      router.refresh();
    });

  if (done) {
    return (
      <section className="mt-5 rounded-2xl border-2 border-emerald-600 bg-emerald-50 p-5">
        <h2 className="text-lg font-bold text-emerald-900">판매를 등록했습니다 — {done.quoteNo}</h2>
        <p className="mt-1 text-sm text-emerald-800">재고가 빠졌고 MARS 입력 대기열에 올라갔습니다.</p>
        {done.shortages.length > 0 && (
          <div className="mt-3 rounded-lg bg-amber-100 p-3 text-sm text-amber-900">
            <strong>재고보다 많이 팔렸습니다</strong> — {done.shortages.join(", ")}
            <br />
            판매는 그대로 등록했습니다. 재고 수량이 실제와 다른 것 같으니 확인해 주세요.
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <a
            href="/mars"
            className="flex-1 rounded-lg bg-indigo-700 py-3 text-center font-semibold text-white"
          >
            MARS 입력하러 가기
          </a>
          <button
            type="button"
            onClick={() => setDone(null)}
            className="flex-1 rounded-lg border border-emerald-600 bg-white py-3 font-semibold text-emerald-800"
          >
            판매 또 등록
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="mt-5 space-y-4 pb-40">
      <CustomerPick vehicle={vehicle} onPick={setVehicle} walkIn={walkIn} onWalkIn={setWalkIn} />

      {vehicle && (
        <label className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2">
          <span className="text-sm text-slate-500">주행거리</span>
          <input
            value={mileage}
            onChange={(e) => setMileage(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder={vehicle.mileage ? won(vehicle.mileage) : "선택"}
            className="tabular min-w-0 flex-1 text-right outline-none"
          />
          <span className="text-sm text-slate-500">km</span>
        </label>
      )}

      <TirePick onAdd={addTire} />

      {rows.length > 0 && (
        <section className="rounded-2xl border border-slate-300 bg-white p-3">
          <h2 className="font-bold">작업 내역</h2>
          <ul className="mt-2 space-y-2">
            {rows.map((r) => (
              <LineRow key={r.key} row={r} onChange={(p) => setRow(r.key, p)} onRemove={() => removeRow(r)} />
            ))}
          </ul>
        </section>
      )}

      <ServicePick
        onAdd={(s) =>
          setRows((rs) => [
            ...rs,
            {
              key: `s-${s.id}-${Date.now()}`,
              kind: "service",
              serviceItemId: s.id,
              marsNo: s.marsNo,
              description: s.name,
              qty: 1,
              unitPrice: s.price ?? 0,
            },
          ])
        }
      />

      <section className="rounded-2xl border border-slate-300 bg-white p-3">
        <h2 className="font-bold">결제</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {PAYMENTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPayment(p)}
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                payment === p ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <input
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="메모 (선택)"
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </section>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* 합계는 늘 보여야 한다 — 손님 앞에서 금액을 말해야 하므로 */}
      <div className="fixed inset-x-0 bottom-0 border-t border-slate-300 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-slate-500">합계 (VAT 포함)</div>
            <div className="tabular text-2xl font-bold">{won(total)}원</div>
          </div>
          <button
            type="button"
            disabled={pending || rows.length === 0}
            onClick={submit}
            className="shrink-0 rounded-xl bg-emerald-700 px-6 py-3.5 text-lg font-bold text-white disabled:opacity-40"
          >
            {pending ? "저장 중…" : "판매 확정"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function LineRow({
  row,
  onChange,
  onRemove,
}: {
  row: Row;
  onChange: (p: Partial<Row>) => void;
  onRemove: () => void;
}) {
  const BTN = "h-9 w-9 shrink-0 rounded-lg border border-slate-300 bg-white text-lg font-bold";
  return (
    <li className="rounded-lg bg-slate-50 p-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{row.description}</div>
          {row.marsNo && <div className="tabular text-xs text-slate-500">{row.marsNo}</div>}
        </div>
        <button type="button" onClick={onRemove} className="shrink-0 px-1.5 text-slate-400" aria-label="빼기">
          ✕
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <button type="button" className={BTN} onClick={() => onChange({ qty: Math.max(1, row.qty - 1) })}>
          −
        </button>
        <span className="tabular w-8 text-center font-bold">{row.qty}</span>
        <button type="button" className={BTN} onClick={() => onChange({ qty: row.qty + 1 })}>
          +
        </button>
        <label className="ml-auto flex items-center gap-1">
          <span className="text-xs text-slate-500">단가</span>
          <input
            value={won(row.unitPrice)}
            onChange={(e) => onChange({ unitPrice: Number(e.target.value.replace(/\D/g, "")) || 0 })}
            inputMode="numeric"
            className="tabular h-9 w-28 rounded-lg border border-slate-300 px-2 text-right"
          />
        </label>
        <span className="tabular w-24 text-right text-sm font-semibold">{won(row.unitPrice * row.qty)}</span>
      </div>
    </li>
  );
}

function CustomerPick({
  vehicle,
  onPick,
  walkIn,
  onWalkIn,
}: {
  vehicle: VehicleHit | null;
  onPick: (v: VehicleHit | null) => void;
  walkIn: { name: string; phone: string; plateNo: string };
  onWalkIn: (w: { name: string; phone: string; plateNo: string }) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<VehicleHit[]>([]);
  const [manual, setManual] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(() => void searchVehicles(q).then((r) => setHits(r.slice(0, 6))), 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  if (vehicle) {
    return (
      <section className="rounded-2xl border-2 border-slate-900 bg-white p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-bold">
              {vehicle.plateNo} · {vehicle.customerName}
            </div>
            <div className="text-sm text-slate-500">
              {[vehicle.makerName, vehicle.model, vehicle.phone].filter(Boolean).join(" · ")}
            </div>
          </div>
          <button type="button" onClick={() => onPick(null)} className="shrink-0 text-sm text-slate-500 underline">
            바꾸기
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-300 bg-white p-3">
      <h2 className="font-bold">고객·차량</h2>
      {!manual ? (
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="차량번호·전화번호·이름"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 text-lg outline-none focus:border-slate-900"
          />
          <ul className="mt-2 space-y-1">
            {hits.map((h) => (
              <li key={h.vehicleId}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(h);
                    setQ("");
                  }}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left active:bg-slate-100"
                >
                  <div className="text-sm font-medium">
                    {h.plateNo} · {h.customerName}
                  </div>
                  <div className="text-xs text-slate-500">
                    {[h.makerName, h.model, h.phone].filter(Boolean).join(" · ")}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setManual(true)}
            className="mt-2 w-full py-2 text-sm text-slate-500 underline underline-offset-4"
          >
            등록 안 된 손님입니다
          </button>
        </>
      ) : (
        <NewCustomer
          initialPlate={q}
          onCreated={(v) => {
            onPick(v);
            setManual(false);
            setQ("");
          }}
          onCancel={() => setManual(false)}
        />
      )}
    </section>
  );
}

/**
 * ⭐ 새 고객·차량 (사장님 지적 2026-08-02)
 *   "신규고객과 차량의 경우에는 필수로 넣어야 등록이 되는 정보들이 있음."
 *
 * 종이 「차량 점검 및 주문 보고서」의 고객·차량 정보 칸과 같은 항목이다.
 * 여기서 다 받아 두면 MARS 에 그대로 넘어간다.
 */
function NewCustomer({
  initialPlate,
  onCreated,
  onCancel,
}: {
  initialPlate: string;
  onCreated: (v: VehicleHit) => void;
  onCancel: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<NewCustomerInput>({
    name: "",
    phone: "",
    address: "속초",
    consentPrivacy: false,
    consentMarketing: false,
    michelinMember: false,
    signed: false,
    plateNo: /\d/.test(initialPlate) ? initialPlate : "",
    makerName: "",
    model: "",
    year: "",
    fuelType: "",
    bodyType: "",
    mileage: "",
    vin: "",
  });
  const set = (p: Partial<NewCustomerInput>) => setF((x) => ({ ...x, ...p }));

  const IN = "w-full rounded-lg border border-slate-300 px-2.5 py-2.5 text-sm outline-none focus:border-slate-900";
  const LB = "text-xs text-slate-500";
  const req = <span className="text-red-600">*</span>;

  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
        <strong>*</strong> 표시는 MARS 등록에 반드시 필요한 항목입니다.
      </div>

      <div>
        <div className="text-sm font-semibold">고객</div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <label>
            <span className={LB}>이름 {req}</span>
            <input value={f.name} onChange={(e) => set({ name: e.target.value })} className={IN} />
          </label>
          <label>
            <span className={LB}>휴대폰</span>
            <input
              value={f.phone}
              onChange={(e) => set({ phone: e.target.value })}
              inputMode="tel"
              placeholder="010-0000-0000"
              className={IN}
            />
          </label>
          <label className="col-span-2">
            <span className={LB}>주소 {req}</span>
            <input value={f.address} onChange={(e) => set({ address: e.target.value })} className={IN} />
          </label>
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold">차량</div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <label>
            <span className={LB}>차량번호 {req}</span>
            <input value={f.plateNo} onChange={(e) => set({ plateNo: e.target.value })} className={IN} />
          </label>
          <label>
            <span className={LB}>제조사</span>
            <input
              value={f.makerName}
              onChange={(e) => set({ makerName: e.target.value })}
              placeholder="현대·기아·BMW…"
              className={IN}
            />
          </label>
          <label>
            <span className={LB}>모델</span>
            <input value={f.model} onChange={(e) => set({ model: e.target.value })} className={IN} />
          </label>
          <label>
            <span className={LB}>연식</span>
            <input
              value={f.year}
              onChange={(e) => set({ year: e.target.value.replace(/\D/g, "").slice(0, 4) })}
              inputMode="numeric"
              placeholder="2022"
              className={IN}
            />
          </label>
          <label>
            <span className={LB}>주행거리 (km)</span>
            <input
              value={f.mileage}
              onChange={(e) => set({ mileage: e.target.value.replace(/\D/g, "") })}
              inputMode="numeric"
              className={IN}
            />
          </label>
          <label>
            <span className={LB}>차대번호</span>
            <input value={f.vin} onChange={(e) => set({ vin: e.target.value })} className={IN} />
          </label>
        </div>

        <div className="mt-2">
          <span className={LB}>연료 {req}</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {FUEL_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => set({ fuelType: t.value })}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  f.fuelType === t.value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2">
          <span className={LB}>차량 형태</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {BODY_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set({ bodyType: f.bodyType === t ? "" : t })}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  f.bodyType === t ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/*
        🔴 동의는 손님이 종이에 표시하고 서명한 그대로 옮겨 적는다.
           프로그램이 대신 정하지 않는다.
      */}
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
        <div className="text-sm font-semibold text-amber-900">개인정보 동의</div>
        <p className="mt-0.5 text-xs text-amber-800">
          종이 보고서에서 손님이 표시하신 그대로 눌러 주세요.
        </p>
        <div className="mt-2 space-y-1.5">
          {(
            [
              ["consentPrivacy", "개인정보 활용 동의 (필수)"],
              ["consentMarketing", "뉴스·프로모션 수신 동의 (카카오톡·문자)"],
              ["michelinMember", "미쉐린 멤버십 가입"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm text-amber-900">
              <input
                type="checkbox"
                checked={f[k]}
                onChange={(e) => set({ [k]: e.target.checked } as Partial<NewCustomerInput>)}
                className="h-5 w-5"
              />
              {label}
            </label>
          ))}
          <label className="mt-1 flex items-center gap-2 border-t border-amber-300 pt-2 text-sm font-semibold text-amber-900">
            <input
              type="checkbox"
              checked={f.signed}
              onChange={(e) => set({ signed: e.target.checked })}
              className="h-5 w-5"
            />
            종이 보고서에 손님 서명을 받았습니다
          </label>
        </div>
        {!f.signed && (
          <p className="mt-1.5 text-xs text-amber-800">
            서명을 안 받으면 저장은 되지만 <strong>MARS 고객 등록은 하지 않습니다.</strong>
          </p>
        )}
      </div>

      {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-300 px-4 py-3 text-sm text-slate-600"
        >
          취소
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await createCustomerAndVehicle(f);
              if (!r.ok) {
                setError(r.error);
                return;
              }
              const hits = await searchVehicles(f.plateNo);
              const v = hits.find((h) => h.vehicleId === r.vehicleId) ?? hits[0];
              if (v) onCreated(v);
              else onCancel();
            })
          }
          className="flex-1 rounded-lg bg-slate-900 py-3 font-semibold text-white disabled:opacity-50"
        >
          {pending ? "등록 중…" : "등록하고 판매 계속"}
        </button>
      </div>
    </div>
  );
}

function TirePick({ onAdd }: { onAdd: (p: ProductHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      setHits([]);
      return;
    }
    timer.current = setTimeout(() => void searchProducts(q).then((r) => setHits(r.slice(0, 8))), 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  return (
    <section className="rounded-2xl border border-slate-300 bg-white p-3">
      <h2 className="font-bold">타이어·부품</h2>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="규격·모델명·CAI   예: 2454518 primacy"
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 text-lg outline-none focus:border-slate-900"
      />
      <ul className="mt-2 space-y-1">
        {hits.map((h) => (
          <li key={h.productId}>
            <button
              type="button"
              onClick={() => {
                onAdd(h);
                setQ("");
              }}
              className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left active:bg-slate-100"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{h.model}</div>
                <div className="tabular text-xs text-slate-500">
                  {[h.spec, h.loadSpeed, h.brandName].filter(Boolean).join(" · ")}
                  {h.stockQty > 0 ? ` · 재고 ${h.stockQty}본` : " · 재고 없음"}
                </div>
              </div>
              <span className="tabular shrink-0 text-sm font-semibold">
                {won(h.salePrice ?? h.listPrice ?? 0)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ServicePick({
  onAdd,
}: {
  onAdd: (s: { id: number; marsNo: string | null; name: string; price: number | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Awaited<ReturnType<typeof findServices>>>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void findServices(q).then(setHits), 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, open]);

  const list = useMemo(() => hits.slice(0, 12), [hits]);

  return (
    <section className="rounded-2xl border border-slate-300 bg-white p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between font-bold"
      >
        공임·정비 추가
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="얼라인먼트 · 펑크수리 · 배터리…"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2"
          />
          <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
            {list.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onAdd(s)}
                  className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left active:bg-slate-100"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                  <span className="tabular shrink-0 text-sm font-semibold">
                    {s.price ? won(s.price) : "—"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
