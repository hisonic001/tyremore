"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RateBox } from "../rate-box";
import type { ProductHit, VehicleHit } from "@/lib/search";
import { searchProducts, searchVehicles } from "@/lib/search-actions";
import { createCustomerAndVehicle, findServices, saveSale, type SaleLine } from "@/lib/sale";
import { isMarsMaker, makerSuggestions, MARS_MAKER_LIST_ID, MarsMakerDatalist } from "@/lib/mars-makers";
import { listSuppliers } from "@/lib/supplier";
import { BODY_TYPES, FUEL_TYPES, type NewCustomerInput } from "@/lib/sale-types";

const won = (n: number) => n.toLocaleString();

/** 담긴 한 줄 */
interface Row extends SaleLine {
  key: string;
  /** 인치 — 화면에서만 쓴다 (저장할 때는 뺀다) */
  rimInch?: number | null;
}

/** 서비스 = 무상 (사장님 요청 2026-08-07 — 단골 무상 점검·가벼운 서비스) */
const PAYMENTS = ["카드", "현금", "계좌이체", "외상", "서비스"] as const;

export function SaleForm() {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [vehicle, setVehicle] = useState<VehicleHit | null>(null);
  /** ⭐ 거래처 판매 (사장님 요청 2026-08-05) — MARS 에 등록하지 않는다 */
  const [supplierSale, setSupplierSale] = useState<string | null>(null);
  const [walkIn, setWalkIn] = useState({ name: "", phone: "", plateNo: "" });
  const [mileage, setMileage] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [payment, setPayment] = useState<string>("카드");
  const [memo, setMemo] = useState("");
  /** 실제로 정비한 날 — 기본은 오늘이지만 고칠 수 있다 */
  const today = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD
  const [workDate, setWorkDate] = useState(today);
  const [done, setDone] = useState<{ quoteNo: string; shortages: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * ⭐ 어느 바퀴를 갈았는지 (사장님 요청 2026-08-05) — MARS 점검표에 그대로 반영된다.
   *    본수를 바꾸면 짐작값(1본=앞왼쪽, 2본=앞, 4본=전부)을 미리 채워 주되,
   *    한 번이라도 직접 고치면 그 선택을 존중한다.
   */
  const WHEELS = ["전륜 좌측", "전륜 우측", "후륜 좌측", "후륜 우측"] as const;
  const [wheels, setWheels] = useState<string[]>([]);
  const wheelsTouched = useRef(false);
  const tyreQty = rows.filter((r) => r.kind === "tire").reduce((s, r) => s + r.qty, 0);
  useEffect(() => {
    if (wheelsTouched.current) return;
    const guess = tyreQty >= 4 ? [...WHEELS] : tyreQty === 2 ? [WHEELS[0], WHEELS[1]] : tyreQty === 1 ? [WHEELS[0]] : [];
    setWheels(tyreQty >= 3 && tyreQty < 4 ? [WHEELS[0], WHEELS[1], WHEELS[2]] : guess);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tyreQty]);

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

  const submit = () => {
    /**
     * ⭐ 고객 미등록 경고 (사장님 요청 2026-08-08).
     *    "고객 등록을 안하고 판매 확정을 누르면 한번 경고를 하며 고객등록을 하도록 유도"
     *    거래처 판매가 아닌데 차량을 고르지 않았으면 — 한 번 묻는다.
     */
    if (!supplierSale && !vehicle) {
      const ok = confirm(
        "고객·차량을 등록하지 않았습니다.\n" +
          "이대로 저장하면 비회원 판매로 남아 MARS 자동 입력이 안 되고, 다음 방문 때 이력이 이어지지 않습니다.\n\n" +
          "「취소」를 누르고 고객·차량 탭에서 「등록 안 된 손님입니다」로 등록하는 것을 권합니다.\n" +
          "그래도 이대로 저장할까요?",
      );
      if (!ok) return;
    }
    start(async () => {
      setError(null);
      const res = await saveSale({
        vehicleId: supplierSale ? null : (vehicle?.vehicleId ?? null),
        customerId: supplierSale ? null : (vehicle?.customerId ?? null),
        walkIn: supplierSale || vehicle ? null : walkIn.name || walkIn.phone || walkIn.plateNo ? walkIn : null,
        supplierName: supplierSale,
        lines: rows.map(({ key, rimInch, ...l }) => l),
        paymentMethod: payment,
        workDate,
        memo: memo.trim() || null,
        mileage: mileage ? Number(mileage.replace(/\D/g, "")) : null,
        // 거래처 판매는 차량 점검이 없다 — 바퀴 정보도 안 넘긴다
        tyrePositions: !supplierSale && tyreQty > 0 && wheels.length > 0 ? wheels : null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone({ quoteNo: res.quoteNo, shortages: res.shortages });
      setRows([]);
      setVehicle(null);
      setSupplierSale(null);
      setWalkIn({ name: "", phone: "", plateNo: "" });
      setMileage("");
      setMemo("");
      setWheels([]);
      wheelsTouched.current = false;
      router.refresh();
    });
  };

  if (done) {
    return (
      <section className="mt-5 rounded-2xl border-2 border-emerald-600 bg-emerald-50 p-5">
        <h2 className="text-lg font-bold text-emerald-900">판매를 등록했습니다 — {done.quoteNo}</h2>
        <p className="mt-1 text-sm text-emerald-800">
          재고가 빠졌고 정비 내역에 남았습니다. MARS 에 올릴 때는 정비 내역에서 카드를 체크하세요.
        </p>
        {done.shortages.length > 0 && (
          <div className="mt-3 rounded-lg bg-amber-100 p-3 text-sm text-amber-900">
            <strong>재고보다 많이 팔렸습니다</strong> — {done.shortages.join(", ")}
            <br />
            판매는 그대로 등록했습니다. 재고 수량이 실제와 다른 것 같으니 확인해 주세요.
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <a
            href="/sales"
            className="flex-1 rounded-lg bg-indigo-700 py-3 text-center font-semibold text-white"
          >
            정비 내역 보기
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
    /**
     * ⭐ PC 배치 2차 수정 (사장님 피드백 2026-08-08 — "배치가 조금 별로").
     *    반반 나누니 시선이 좌우로 튀었다. 이제 **작업 흐름은 폰과 같은 한 줄기**
     *    (왼쪽 2/3: 고객 → 검색 → 작업 내역 → 바퀴 → 공임)로 두고,
     *    오른쪽 1/3 에 **결제만 고정(sticky)** — 스크롤해도 결제·메모가 늘 보인다.
     *    폰(1024px 미만)은 세로 순서 그대로다.
     */
    <div className="mt-5 pb-40 lg:grid lg:grid-cols-3 lg:items-start lg:gap-4">
    <div className="space-y-4 lg:col-span-2">
      <CustomerPick
        vehicle={vehicle}
        onPick={setVehicle}
        walkIn={walkIn}
        onWalkIn={setWalkIn}
        supplier={supplierSale}
        onSupplier={setSupplierSale}
      />

      {vehicle && !supplierSale && (
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

      {/* ⭐ 어느 바퀴를 갈았는지 (사장님 요청 2026-08-05) — MARS 점검표에 그대로 반영 */}
      {tyreQty > 0 && !supplierSale && (
        <section className="rounded-2xl border border-slate-300 bg-white p-3">
          <h2 className="font-bold">
            갈아 끼운 바퀴
            <span className="ml-2 text-sm font-normal text-slate-500">타이어 {tyreQty}본</span>
          </h2>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {WHEELS.map((w) => (
              <label
                key={w}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${
                  wheels.includes(w) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"
                }`}
              >
                <input
                  type="checkbox"
                  checked={wheels.includes(w)}
                  onChange={(e) => {
                    wheelsTouched.current = true;
                    setWheels((ws) => (e.target.checked ? [...ws, w] : ws.filter((x) => x !== w)));
                  }}
                  className="h-5 w-5"
                />
                {w}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            MARS 차량 점검표의 타이어 교체 표시가 이 선택을 그대로 따릅니다.
          </p>
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
    </div>

    {/* 오른쪽 — 결제만 고정(sticky). 스크롤해도 결제·메모가 늘 보인다 */}
    <div className="mt-4 space-y-4 lg:sticky lg:top-4 lg:mt-0">
      <section className="rounded-2xl border border-slate-300 bg-white p-3">
        <h2 className="font-bold">결제</h2>

        {/*
          ⭐ 실제로 정비한 날 (사장님 지시 2026-08-02)
             "입력은 오늘 해도 실제 정비는 이전에 했을 수도 있음"
             MARS 매출 주문의 문서 날짜·완료 일자로 그대로 들어간다.
        */}
        <label className="mt-2 flex items-center gap-2">
          <span className="text-sm text-slate-500">작업일자</span>
          <input
            type="date"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
            className="tabular rounded-lg border border-slate-300 px-3 py-2"
          />
          {workDate !== today && (
            <button
              type="button"
              onClick={() => setWorkDate(today)}
              className="text-xs text-slate-500 underline underline-offset-4"
            >
              오늘로
            </button>
          )}
        </label>

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
        {payment === "외상" && (
          <p className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
            외상은 <strong>MARS 자동 입력에서 빠집니다.</strong> 여기 기록만 남고, MARS 는 직접 처리해 주세요.
          </p>
        )}
        {payment === "서비스" && (
          <p className="mt-1.5 rounded-lg bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900">
            서비스(무상)는 <strong>MARS 에 등록하지 않습니다</strong> — 우리 기록에만 남습니다.
            단가를 0원으로 바꿔서 등록하세요.
          </p>
        )}
        {/*
          ⭐ 이 메모는 이제 MARS 에 안 들어간다 (사장님 지시 2026-08-07).
             MARS 설명 2 는 위 품목 줄마다 있는 메모 칸이 맡는다.
             여기는 우리 기록용 — 정비 내역 카드에 노랗게 보인다.
        */}
        <input
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="메모 (선택 · 우리 기록용, MARS 미반영)"
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </section>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </div>

      {/* 합계는 늘 보여야 한다 — 손님 앞에서 금액을 말해야 하므로 */}
      <div className="fixed inset-x-0 bottom-0 border-t border-slate-300 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3 lg:max-w-6xl">
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
  /**
   * 🔴 단가를 바꾸면 저장될 할인율도 같이 따라간다 (코드 리뷰 2026-08-08).
   *    전에는 담을 때의 기본 할인율이 스냅샷으로 남아, 30% 로 깎아 팔아도
   *    기록에는 25% 로 남았다 — 나중의 마진·할인 분석이 거짓 근거를 읽는다.
   */
  const priceChange = (n: number): Partial<Row> => ({
    unitPrice: n,
    salesRate:
      row.listPrice && row.listPrice > 0
        ? Math.round(Math.max(0, Math.min(0.999, 1 - n / row.listPrice)) * 10000) / 10000
        : (row.salesRate ?? null),
  });
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
            onChange={(e) => onChange(priceChange(Number(e.target.value.replace(/\D/g, "")) || 0))}
            inputMode="numeric"
            className="tabular h-9 w-28 rounded-lg border border-slate-300 px-2 text-right"
          />
        </label>
        <span className="tabular w-24 text-right text-sm font-semibold">{won(row.unitPrice * row.qty)}</span>
      </div>
      {/* ⭐ 검색 카드와 같은 할인 계산 (사장님 요청 2026-08-08) — %를 치면 단가가 따라온다 */}
      {row.listPrice ? (
        <div className="mt-1.5 flex justify-end">
          <RateBox
            listPrice={row.listPrice}
            price={row.unitPrice}
            onPrice={(n) => onChange(priceChange(n))}
          />
        </div>
      ) : null}
      {/* ⭐ 줄별 메모 (사장님 지시 2026-08-07) — MARS 이 줄의 「설명 2」로 들어간다 */}
      <input
        value={row.memo ?? ""}
        onChange={(e) => onChange({ memo: e.target.value })}
        placeholder="이 줄 메모 (선택) — MARS 설명 2"
        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
      />
    </li>
  );
}

function CustomerPick({
  vehicle,
  onPick,
  walkIn,
  onWalkIn,
  supplier,
  onSupplier,
}: {
  vehicle: VehicleHit | null;
  onPick: (v: VehicleHit | null) => void;
  walkIn: { name: string; phone: string; plateNo: string };
  onWalkIn: (w: { name: string; phone: string; plateNo: string }) => void;
  supplier: string | null;
  onSupplier: (s: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<VehicleHit[]>([]);
  const [manual, setManual] = useState(false);
  /**
   * ⭐ 고객·차량 ↔ 거래처 — 동등한 탭 전환 (사장님 요청 2026-08-08).
   *    "거래처에 판매의 경우 좀 더 직관적으로 … 동등한 위치에서 버튼을 통해서
   *     스위칭이 가능하게. 거래처를 고를때도 검색을 통해서."
   *    전에는 고객 검색 밑의 작은 밑줄 링크라 눈에 안 띄었다.
   */
  const [mode, setMode] = useState<"customer" | "supplier">("customer");
  const [sq, setSq] = useState("");
  const [supplierList, setSupplierList] = useState<
    { id: number; name: string; phone: string | null; memo: string | null }[] | null
  >(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (mode !== "supplier" || supplierList !== null) return;
    void listSuppliers().then((rows) =>
      setSupplierList(
        rows
          .filter((r) => r.isActive)
          .map((r) => ({ id: r.id, name: r.name, phone: r.phone ?? null, memo: r.memo ?? null })),
      ),
    );
  }, [mode, supplierList]);

  // 거래처 검색 — 설정 > 거래처와 같은 방식 (이름·전화·메모, 공백 무시)
  const norm = (s: string | null | undefined) => (s ?? "").replace(/\s/g, "").toLowerCase();
  const needle = norm(sq);
  const supplierHits = (supplierList ?? []).filter(
    (r) => !needle || norm(r.name).includes(needle) || norm(r.phone).includes(needle) || norm(r.memo).includes(needle),
  );

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

  if (supplier) {
    return (
      <section className="rounded-2xl border-2 border-violet-700 bg-violet-50 p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-bold text-violet-900">거래처 판매 · {supplier}</div>
            <div className="text-sm text-violet-700">MARS 에는 등록하지 않습니다 — 재고와 판매 기록만 남습니다</div>
          </div>
          <button
            type="button"
            onClick={() => onSupplier(null)}
            className="shrink-0 text-sm text-violet-700 underline"
          >
            바꾸기
          </button>
        </div>
      </section>
    );
  }

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
      {/* ⭐ 누구에게 파는가 — 고객·차량과 거래처가 동등한 탭 (사장님 요청 2026-08-08) */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {(
          [
            ["customer", "고객·차량"],
            ["supplier", "거래처"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={`flex-1 rounded-lg py-2.5 text-sm font-semibold ${
              mode === id
                ? id === "supplier"
                  ? "bg-white text-violet-800 shadow-sm"
                  : "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 active:bg-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "supplier" ? (
        <>
          <p className="mt-2 px-1 text-xs text-violet-700">
            거래처 판매는 MARS 에 등록하지 않습니다 — 재고와 판매 기록만 남습니다.
          </p>
          <input
            value={sq}
            onChange={(e) => setSq(e.target.value)}
            placeholder="거래처 검색  예: 금호, 쌍성, 010…"
            className="mt-2 w-full rounded-lg border border-violet-300 px-3 py-3 text-lg outline-none focus:border-violet-700"
          />
          {/*
            ⭐ 미리 깔리는 목록 없음 (사장님 지시 2026-08-08) —
               "어차피 거래처가 수십개가 될수도 있기에 사전에 미리 없애고
                그냥 검색창만 놔두고 검색시에 실시간으로 확인 가능하게."
               고객·차량 검색과 같은 방식: 치는 글자대로 그때그때만 보여준다.
          */}
          {needle !== "" && (
            <ul className="mt-2 space-y-1">
              {supplierList === null && <li className="py-2 text-sm text-slate-500">불러오는 중…</li>}
              {supplierHits.slice(0, 8).map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSupplier(s.name);
                      setSq("");
                    }}
                    className="w-full rounded-lg border border-violet-200 px-3 py-2 text-left active:bg-violet-50"
                  >
                    <div className="text-sm font-medium">{s.name}</div>
                    {(s.phone || s.memo) && (
                      <div className="text-xs text-slate-500">{[s.phone, s.memo].filter(Boolean).join(" · ")}</div>
                    )}
                  </button>
                </li>
              ))}
              {supplierList !== null && supplierHits.length === 0 && (
                <li className="py-2 text-sm text-slate-500">
                  「{sq}」에 맞는 거래처가 없습니다 — 설정 &gt; 거래처에서 먼저 추가해 주세요
                </li>
              )}
            </ul>
          )}
        </>
      ) : !manual ? (
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

  /**
   * 🔴 동의는 「동의함/거부함」 중 **반드시 하나를 고르게** 한다 (사장님 지시 2026-08-05).
   *    체크박스는 「안 본 것」과 「거부」가 구분되지 않아서, 깜빡 넘어가면
   *    거부가 아닌데 거부로 — 또는 그 반대로 — MARS 에 올라갈 수 있다.
   *    거부는 MARS 에 「거부된 동의 + 불매치 코드 NONEED」로 그대로 올라간다.
   */
  const [choices, setChoices] = useState<{ privacy: boolean | null; marketing: boolean | null }>({
    privacy: null,
    marketing: null,
  });

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
            {/*
              🔴 MARS 의 「제조사」는 목록에서 고르는 칸이다 (사장님 제보 2026-08-09) —
                 목록 밖 이름이면 MARS 차량 등록이 실패한다. 치면 목록이 걸러져 나온다.
            */}
            <input
              value={f.makerName}
              onChange={(e) => set({ makerName: e.target.value })}
              list={MARS_MAKER_LIST_ID}
              placeholder="치면 목록이 나옵니다"
              className={IN}
            />
            <MarsMakerDatalist />
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
        <div className="mt-2 space-y-2">
          {(
            [
              ["privacy", "개인정보 활용 동의"],
              ["marketing", "뉴스·프로모션 수신 (카카오톡·문자)"],
            ] as const
          ).map(([k, label]) => (
            <div key={k} className="flex items-center justify-between gap-2">
              <span className="text-sm text-amber-900">{label}</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setChoices((c) => ({ ...c, [k]: true }))}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                    choices[k] === true
                      ? "border-emerald-700 bg-emerald-600 text-white"
                      : "border-amber-300 bg-white text-amber-900"
                  }`}
                >
                  동의함
                </button>
                <button
                  type="button"
                  onClick={() => setChoices((c) => ({ ...c, [k]: false }))}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                    choices[k] === false
                      ? "border-red-700 bg-red-600 text-white"
                      : "border-amber-300 bg-white text-amber-900"
                  }`}
                >
                  거부함
                </button>
              </div>
            </div>
          ))}
          <p className="text-xs text-amber-800">
            종이에 표시된 그대로 골라 주세요. 거부는 MARS 에 「거부된 동의」로 그대로 올라갑니다.
          </p>
          <label className="flex items-center gap-2 text-sm text-amber-900">
            <input
              type="checkbox"
              checked={f.michelinMember}
              onChange={(e) => set({ michelinMember: e.target.checked })}
              className="h-5 w-5"
            />
            미쉐린 멤버십 가입
          </label>
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
              /**
               * 🔴 서명을 받았는데 동의/거부를 안 골랐으면 막는다 (사장님 지시 2026-08-05).
               *    앱에서 애매하게 남으면 MARS 동의 기록이 종이와 어긋난다.
               */
              if (f.signed && (choices.privacy === null || choices.marketing === null)) {
                setError("개인정보 동의를 종이 보고서대로 「동의함/거부함」 중에 골라 주세요.");
                return;
              }
              // 🔴 제조사는 MARS 목록에 있는 이름만 (2026-08-09) — 아니면 MARS 등록이 실패한다
              if (f.makerName.trim() && !isMarsMaker(f.makerName)) {
                const near = makerSuggestions(f.makerName);
                setError(
                  `제조사 「${f.makerName.trim()}」 는 MARS 목록에 없습니다 — 목록에서 골라 주세요.` +
                    (near.length ? ` 비슷한 것: ${near.join(" · ")}` : ""),
                );
                return;
              }
              const r = await createCustomerAndVehicle({
                ...f,
                consentPrivacy: choices.privacy ?? false,
                consentMarketing: choices.marketing ?? false,
              });
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
  /** ⭐ 기본은 취급 상품만 (품목 정리 ① 2026-08-05) — 없으면 전체 목록을 연다 */
  const [all, setAll] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      setHits([]);
      setAll(false);
      return;
    }
    timer.current = setTimeout(() => void searchProducts(q, { all }).then((r) => setHits(r.slice(0, 8))), 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, all]);

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
      {q.trim() && !all && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-2 w-full py-1.5 text-center text-sm text-slate-500 underline underline-offset-4"
        >
          {hits.length === 0 ? "취급 상품에 없습니다 — 전체 목록에서 찾기" : "전체 목록에서 찾기"}
        </button>
      )}
      {q.trim() && all && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
          전체 목록에서 보는 중 — 취급 안 하는 상품도 나옵니다
        </p>
      )}
    </section>
  );
}

function ServicePick({
  onAdd,
}: {
  onAdd: (s: { id: number; marsNo: string | null; name: string; price: number | null }) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Awaited<ReturnType<typeof findServices>>>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * ⭐ 접지 않는다 (사장님 지시 2026-08-09) — "타이어 부품처럼 그냥 검색창이 바로".
   *    전에는 「공임·정비 추가 ▼」를 눌러야 검색창이 나왔다.
   *    빈 검색어도 자주 쓰는 목록을 바로 보여준다 — 얼라인먼트·펑크수리는 치기 전에 보인다.
   */
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void findServices(q).then(setHits), 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  const list = useMemo(() => hits.slice(0, 12), [hits]);

  return (
    <section className="rounded-2xl border border-slate-300 bg-white p-3">
      <h2 className="font-bold">공임·정비 추가</h2>
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
    </section>
  );
}
