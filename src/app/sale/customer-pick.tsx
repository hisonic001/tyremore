"use client";

/**
 * ⭐ 누구에게 파는가 — 고객·차량 ↔ 거래처 선택기 (2026-08-17 공용으로 뺌)
 *
 * 판매 등록(sale/client.tsx)에만 있던 것을, 정비 내역의 「손님·거래처 바꾸기」도
 * 쓰게 되어 여기로 옮겼다.
 *
 * 🔴 베껴 쓰지 않고 **옮긴** 이유: 두 벌이 되면 거래처 검색 규칙(공백 무시·
 *    비활성 제외·목록 지연 로딩)이 갈라진다. 그건 거래처 표를 만든 이유
 *    (「쌍성」과 「쌍성 타이어」가 두 곳으로 갈리던 일)와 똑같은 실패다.
 *
 * ⭐ `allowNew` 를 끄면 「등록 안 된 손님입니다」가 안 나온다 — 정비 내역에서
 *    대상을 바꿀 때는 이미 있는 손님·거래처 중에서만 고른다.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import type { VehicleHit } from "@/lib/search";
import { searchVehicles } from "@/lib/search-actions";
import { createCustomerAndVehicle } from "@/lib/sale";
import { isMarsMaker, makerSuggestions, MARS_MAKER_LIST_ID, MarsMakerDatalist } from "@/lib/mars-makers";
import { listSuppliers } from "@/lib/supplier";
import { BODY_TYPES, FUEL_TYPES, type NewCustomerInput } from "@/lib/sale-types";

export function CustomerPick({
  vehicle,
  onPick,
  walkIn,
  onWalkIn,
  supplier,
  onSupplier,
  newDraft = null,
  onNewDraft,
  allowNew = true,
}: {
  vehicle: VehicleHit | null;
  onPick: (v: VehicleHit | null) => void;
  walkIn: { name: string; phone: string; plateNo: string };
  onWalkIn: (w: { name: string; phone: string; plateNo: string }) => void;
  supplier: string | null;
  onSupplier: (s: string | null) => void;
  /** 임시 저장이 접어 둔 신규 손님 폼 — 있으면 폼이 열린 채로 시작 (2026-08-19) */
  newDraft?: NewCustomerDraft | null;
  onNewDraft?: (d: NewCustomerDraft | null) => void;
  /** 끄면 「등록 안 된 손님입니다」(새 고객 만들기)가 안 나온다 — 대상 바꾸기용 */
  allowNew?: boolean;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<VehicleHit[]>([]);
  // 임시 저장을 펼치면(newDraft 있음) 신규 폼이 열린 채로 시작한다 (2026-08-19)
  const [manual, setManual] = useState(!!newDraft);
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
          {/* 대상 바꾸기에서는 새 손님을 만들지 않는다 — 이미 있는 손님 중에서만 고른다 */}
          {allowNew && (
            <button
              type="button"
              onClick={() => setManual(true)}
              className="mt-2 w-full py-2 text-sm text-slate-500 underline underline-offset-4"
            >
              등록 안 된 손님입니다
            </button>
          )}
        </>
      ) : (
        <NewCustomer
          draft={newDraft}
          onDraftChange={onNewDraft}
          initialPlate={q}
          onCreated={(v) => {
            onPick(v);
            setManual(false);
            setQ("");
            onNewDraft?.(null); // 등록됐으니 접어둘 것이 없다
          }}
          onCancel={() => {
            setManual(false);
            onNewDraft?.(null); // 취소 = 버리기
          }}
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
/**
 * ⭐ 신규 손님 폼의 중간 상태 (2026-08-19 — 판매 임시저장이 함께 접어 둔다).
 *    폼은 내부 상태였는데, 반쯤 입력하고 「임시 저장」을 누르면 이름·전화·차량
 *    정보가 통째로 사라졌다 — 부모(판매 등록)로 올려 보내 함께 저장한다.
 */
export interface NewCustomerDraft {
  f: NewCustomerInput;
  choices: { privacy: boolean | null; marketing: boolean | null };
}

function NewCustomer({
  initialPlate,
  onCreated,
  onCancel,
  draft,
  onDraftChange,
}: {
  initialPlate: string;
  onCreated: (v: VehicleHit) => void;
  onCancel: () => void;
  draft?: NewCustomerDraft | null;
  onDraftChange?: (d: NewCustomerDraft) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<NewCustomerInput>(draft?.f ?? {
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
  const [choices, setChoices] = useState<{ privacy: boolean | null; marketing: boolean | null }>(draft?.choices ?? {
    privacy: null,
    marketing: null,
  });

  // 🔴 타이핑을 부모(판매 등록)로 흘려보낸다 — 임시 저장이 이 폼까지 접어 두게 (2026-08-19)
  useEffect(() => {
    onDraftChange?.({ f, choices });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, choices]);

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
