"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProductHit, VehicleHit } from "@/lib/search";
import { searchProducts, searchVehicles } from "@/lib/search-actions";
import { findServices, saveSale, suggestServices, type SaleLine, type SuggestedService } from "@/lib/sale";

const won = (n: number) => n.toLocaleString();

/** 담긴 한 줄 */
interface Row extends SaleLine {
  key: string;
  /** 공임 자동 추천으로 들어온 줄인지 — 타이어를 빼면 같이 다시 계산한다 */
  auto?: boolean;
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
  const tires = rows.filter((r) => r.kind === "tire");

  /**
   * ⭐ 타이어가 바뀌면 공임·밸런스를 다시 올린다.
   * 빼는 것은 쉽고 넣는 것은 잊는다 — 그래서 자동으로 올려 둔다.
   * 사장님이 직접 지운 것은 다시 올리지 않는다.
   */
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const tireKey = tires.map((t) => `${t.productId}:${t.qty}:${t.rimInch}`).join("|");
  useEffect(() => {
    let alive = true;
    if (tires.length === 0) {
      setRows((rs) => rs.filter((r) => !r.auto));
      return;
    }
    void (async () => {
      const sug = await suggestServices(tires.map((t) => ({ rimInch: t.rimInch ?? null, qty: t.qty })));
      if (!alive) return;
      setRows((rs) => [
        ...rs.filter((r) => !r.auto),
        ...sug
          .filter((s) => !dismissed.has(s.serviceItemId))
          .map(
            (s: SuggestedService): Row => ({
              key: `auto-${s.serviceItemId}`,
              kind: "service",
              serviceItemId: s.serviceItemId,
              marsNo: s.marsNo,
              description: s.name,
              qty: s.qty,
              unitPrice: s.price,
              auto: true,
            }),
          ),
      ]);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tireKey, dismissed]);

  const addTire = (p: ProductHit) => {
    const price = p.salePrice ?? p.listPrice ?? 0;
    setRows((rs) => {
      const hit = rs.find((r) => r.productId === p.productId);
      if (hit) return rs.map((r) => (r === hit ? { ...r, qty: r.qty + 1 } : r));
      return [
        ...rs.filter((r) => !r.auto),
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
        ...rs.filter((r) => r.auto),
      ];
    });
  };

  const setRow = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const removeRow = (r: Row) => {
    if (r.auto && r.serviceItemId) setDismissed((d) => new Set(d).add(r.serviceItemId!));
    setRows((rs) => rs.filter((x) => x.key !== r.key));
  };

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await saveSale({
        vehicleId: vehicle?.vehicleId ?? null,
        customerId: vehicle?.customerId ?? null,
        walkIn: vehicle ? null : walkIn.name || walkIn.phone || walkIn.plateNo ? walkIn : null,
        lines: rows.map(({ key, auto, rimInch, ...l }) => l),
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
      setDismissed(new Set());
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
    <li className={`rounded-lg p-2 ${row.auto ? "bg-sky-50" : "bg-slate-50"}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {row.description}
            {row.auto && <span className="ml-1 text-xs font-normal text-sky-700">자동</span>}
          </div>
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
        <>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <input
              value={walkIn.plateNo}
              onChange={(e) => onWalkIn({ ...walkIn, plateNo: e.target.value })}
              placeholder="차량번호"
              className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            />
            <input
              value={walkIn.name}
              onChange={(e) => onWalkIn({ ...walkIn, name: e.target.value })}
              placeholder="이름"
              className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            />
            <input
              value={walkIn.phone}
              onChange={(e) => onWalkIn({ ...walkIn, phone: e.target.value })}
              inputMode="tel"
              placeholder="전화"
              className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            전화번호가 이미 등록된 분과 같으면 그 고객으로 이어집니다.
          </p>
          <button
            type="button"
            onClick={() => setManual(false)}
            className="mt-1 w-full py-2 text-sm text-slate-500 underline underline-offset-4"
          >
            검색으로 돌아가기
          </button>
        </>
      )}
    </section>
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
