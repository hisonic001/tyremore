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
import { SquareArrowOutUpRight } from "lucide-react";
import Link from "@/lib/link";
import type { VehicleHit } from "@/lib/search";
import { searchVehicles } from "@/lib/search-actions";
import { createCustomerAndVehicle, createSupplierVehicle } from "@/lib/sale";
import { isMarsMaker, makerSuggestions, MARS_MAKER_LIST_ID, MarsMakerDatalist } from "@/lib/mars-makers";
import { listSuppliers } from "@/lib/supplier";
import { BODY_TYPES, FUEL_TYPES, type NewCustomerInput } from "@/lib/sale-types";
import { PhotoAssist, type PhotoInfo } from "./photo-assist";

/** 이름 없는 손님을 담는 자리표시 거래처 — 동명 손님을 여기로 묶지 않는다 (2026-08-21) */
const PLACEHOLDER_SUPPLIERS = ["고객", "관광객"];

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
  onMileage,
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
  /** ⭐ 계기판 사진에서 읽은 주행거리를 판매 등록의 주행거리 칸에 (2026-09-05) */
  onMileage?: (km: number) => void;
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
  /* ⭐ 사진으로 찾기·등록 (사장님 제안 2026-09-05) — 읽은 값을 모아 두고 조회·프리필에 쓴다 */
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photo, setPhoto] = useState<PhotoInfo | null>(null);
  /** 검색이 실제로 끝난 검색어 — 「0건」 판단은 이걸로 (빈 hits 초기값과 구분) */
  const [searchedQ, setSearchedQ] = useState("");
  /** ⭐ 끝 4자리 되찾기 (사장님 제보 2026-09-06 — 번호판 가운데 한글 오독) — 한 번만 */
  const [fellBack, setFellBack] = useState(false);
  const handlePhotoInfo = (info: PhotoInfo) => {
    setPhoto((p) => ({ ...p, ...info }));
    // 번호판을 읽으면 검색창에 넣는다 — 기존 검색이 그대로 돌아 결과를 보여 준다
    if (info.plateNo) {
      setFellBack(false);
      setQ(info.plateNo);
    } else if (info.plateTail) {
      // 한글은 오독으로 버려졌고 숫자만 살았다 — 바로 끝 4자리로 찾는다 (2026-09-06)
      setFellBack(true);
      setQ(info.plateTail);
    }
    if (info.odoKm) onMileage?.(info.odoKm);
  };
  const [supplierList, setSupplierList] = useState<
    { id: number; name: string; phone: string | null; memo: string | null }[] | null
  >(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * ⭐ 거래처와 이름이 같은 손님 (사장님 버그 제보 2026-08-21)
   *
   *   "거래처와 고객의 이름이 동일할 경우 판매등록이 동시에 되어버리는 버그"
   *
   * 강원수산은 거래처이면서 **차량마다 고객 기록이 따로(8명)** 있다. 차량으로 고르면
   * 고객 판매로 들어가서 — 외상 장부가 거래처 계정과 고객 계정으로 갈라지고, 사장님은
   * 취소하고 거래처로 다시 등록하셨다 (8/20 · 8/21 실제 흔적, 차량 정보는 잃은 채).
   *
   * → 고른 차량의 주인 이름이 **활성 거래처와 같으면 거래처 판매로 묶는다.** 차량은 그대로
   *   달린다(그 차 기록에 남고, 외상은 거래처 장부 한 곳에 모인다). 되돌리는 단추를 둔다.
   *
   * 🔴 「고객」·「관광객」은 이름 없는 손님을 담는 자리표시 거래처다(고객 229명·관광객 4명이
   *    그 이름으로 있다). 이건 묶지 않고 **개인 손님이 기본** — 안내만 하고 단추로 묶게 둔다.
   */
  const [declined, setDeclined] = useState<number | null>(null);
  const nameKey = (s: string) => s.replace(/\s/g, "").toLowerCase();
  const matchedSupplier =
    vehicle && supplierList
      ? (supplierList.find((s) => nameKey(s.name) === nameKey(vehicle.customerName)) ?? null)
      : null;
  const placeholder = matchedSupplier ? PLACEHOLDER_SUPPLIERS.includes(matchedSupplier.name) : false;

  useEffect(() => {
    if (!vehicle || supplier || !matchedSupplier || placeholder) return;
    if (declined === vehicle.vehicleId) return;
    onSupplier(matchedSupplier.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle, supplier, matchedSupplier, placeholder, declined]);

  useEffect(() => {
    // 거래처 탭을 열거나 **차량을 골랐을 때** 목록을 불러온다 — 동명 거래처를 알아보려면 필요하다
    if ((mode !== "supplier" && !vehicle) || supplierList !== null) return;
    void listSuppliers().then((rows) =>
      setSupplierList(
        rows
          .filter((r) => r.isActive)
          .map((r) => ({ id: r.id, name: r.name, phone: r.phone ?? null, memo: r.memo ?? null })),
      ),
    );
  }, [mode, vehicle, supplierList]);

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
    timer.current = setTimeout(
      () =>
        void searchVehicles(q).then((r) => {
          setHits(r.slice(0, 6));
          setSearchedQ(q);
        }),
      250,
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  /* ⭐ 끝 4자리 되찾기 (2026-09-06) — 사진 번호판 그대로는 0건일 때, 한글이 오독됐을 수
     있으니 숫자 끝 4자리로 한 번 다시 찾는다 (기존 검색이 뒤 4자리를 지원).
     자동 선택(정확 일치 1대)은 조건이 안 맞아 안 일어난다 — 사장님이 눈으로 고른다. */
  useEffect(() => {
    if (!photo?.plateNo || fellBack || vehicle) return;
    if (searchedQ !== photo.plateNo || hits.length > 0) return;
    const tail = photo.plateNo.match(/(\d{4})$/)?.[1];
    if (!tail) return;
    setFellBack(true);
    setQ(tail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchedQ, hits]);

  /* ⭐ 번호판 사진과 정확히 맞는 차가 딱 하나면 바로 잡는다 (2026-09-05) — 한 번 더 누를 일이 없다 */
  useEffect(() => {
    if (!photo?.plateNo || vehicle) return;
    const norm = (s: string) => s.replace(/\s/g, "");
    const p = norm(photo.plateNo);
    const exact = hits.filter((h) => {
      const hp = norm(h.plateNo);
      return hp === p || hp.endsWith(p) || p.endsWith(hp);
    });
    if (exact.length === 1) {
      onPick(exact[0]);
      setQ("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits]);

  /** ⭐ 「등록 안 된 손님입니다」 — 사진에서 읽은 것이 있으면 신규 폼에 미리 채워 연다 (2026-09-05) */
  const openNew = () => {
    if (photo && !newDraft && onNewDraft) {
      onNewDraft({
        f: {
          name: photo.ownerName ?? "",
          phone: "",
          address: "속초",
          consentPrivacy: false,
          consentMarketing: false,
          michelinMember: false,
          signed: false,
          plateNo: photo.plateNo ?? (/\d/.test(q) ? q : ""),
          // 제조사는 차대번호에서 (MARS 목록 이름과 같은 한글) — 아니면 비워 둔다
          makerName: photo.makerName && isMarsMaker(photo.makerName) ? photo.makerName : "",
          // 사장님이 5년간 쳐 오신 「쏘렌토(MQ4)」 꼴 — 괄호코드가 세대 열쇠가 된다
          model: photo.carName ? `${photo.carName}${photo.modelCode ? `(${photo.modelCode})` : ""}` : "",
          year: photo.year ? String(photo.year) : "",
          fuelType: "",
          bodyType: "",
          mileage: photo.odoKm ? String(photo.odoKm) : "",
          vin: photo.vin ?? "",
        },
        choices: { privacy: null, marketing: null },
      });
    }
    setManual(true);
  };

  if (supplier) {
    return (
      <section className="rounded-2xl border-2 border-violet-700 bg-violet-50 p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-bold text-violet-900">
              거래처 판매 · {supplier}
              {vehicle && <span className="ml-2 font-semibold text-violet-800">{vehicle.plateNo}</span>}
            </div>
            {vehicle ? (
              <div className="text-sm text-violet-700">
                {[vehicle.makerName, vehicle.model].filter(Boolean).join(" · ")}
                {vehicle.makerName || vehicle.model ? " — " : ""}
                이 차 기록에 남고, 외상은 거래처 장부 한 곳에 모입니다. MARS 에는 등록하지 않습니다
              </div>
            ) : (
              <div className="text-sm text-violet-700">MARS 에는 등록하지 않습니다 — 재고와 판매 기록만 남습니다</div>
            )}
            {/* ⭐ 거래처 차량 달기 (사장님 요청 2026-09-01) — 전엔 메모에 「156허9093 K5 26688km」처럼
                손으로 적으셨다. 차량을 달면 주행거리 칸이 열리고 그 차 기록에 남는다. */}
            {!vehicle && (
              <SupplierVehiclePick supplier={supplier} onPick={onPick} />
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {/* ⭐ 거래처 정보 바로가기 ↗ (사장님 요청 2026-09-05 — 정비 카드와 같은 문법) */}
            <Link
              href={`/settings/suppliers?q=${encodeURIComponent(supplier)}`}
              title="거래처 정보 보기"
              className="flex items-center gap-1 text-xs text-violet-600 underline underline-offset-2"
            >
              거래처 정보 <SquareArrowOutUpRight className="size-3" />
            </Link>
            {vehicle && (
              <Link
                href={`/vehicle/${vehicle.vehicleId}`}
                title="차량 정보 보기"
                className="flex items-center gap-1 text-xs text-violet-600 underline underline-offset-2"
              >
                차량 정보 <SquareArrowOutUpRight className="size-3" />
              </Link>
            )}
            <button
              type="button"
              onClick={() => {
                onSupplier(null);
                if (vehicle) onPick(null);
              }}
              className="text-sm text-violet-700 underline"
            >
              바꾸기
            </button>
            {vehicle && (
              <button
                type="button"
                onClick={() => {
                  setDeclined(vehicle.vehicleId);
                  onSupplier(null);
                }}
                className="text-xs text-violet-600 underline"
              >
                개인 손님 판매로
              </button>
            )}
          </div>
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
          <div className="flex shrink-0 flex-col items-end gap-1">
            {/* ⭐ 차량·고객 한 장 바로가기 ↗ (사장님 요청 2026-09-05 — 정비 카드와 같은 문법) */}
            <Link
              href={`/vehicle/${vehicle.vehicleId}`}
              title="차량·고객 정보 보기"
              className="flex items-center gap-1 text-xs text-slate-500 underline underline-offset-2"
            >
              차량·고객 정보 <SquareArrowOutUpRight className="size-3" />
            </Link>
            <button type="button" onClick={() => onPick(null)} className="text-sm text-slate-500 underline">
              바꾸기
            </button>
          </div>
        </div>
        {/* 동명 거래처가 있는데 개인 손님으로 두는 중 — 한 번에 묶을 수 있게 */}
        {matchedSupplier && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-violet-50 px-2 py-1.5 text-xs text-violet-800">
            <span>
              「{matchedSupplier.name}」 거래처로도 등록돼 있습니다 — 지금은 <strong>개인 손님 판매</strong>입니다
            </span>
            <button
              type="button"
              onClick={() => {
                setDeclined(null);
                onSupplier(matchedSupplier.name);
              }}
              className="shrink-0 font-semibold underline"
            >
              거래처 판매로 묶기
            </button>
          </div>
        )}
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
          {/* ⭐ 사진으로 찾기·등록 (사장님 제안 2026-09-05) — 과하지 않게 접힌 단추 하나 */}
          {allowNew && (
            <button
              type="button"
              onClick={() => setPhotoOpen((v) => !v)}
              className="mt-1.5 text-sm text-slate-500 underline underline-offset-4"
            >
              📷 사진으로 찾기·등록 {photoOpen ? "접기" : ""}
            </button>
          )}
          {allowNew && photoOpen && <PhotoAssist onInfo={handlePhotoInfo} />}
          {/* ⭐ 끝 4자리로 되찾은 상태 — 한글 오독일 수 있으니 눈으로 골라 달라고 말한다 (2026-09-06) */}
          {(photo?.plateNo || photo?.plateTail) && fellBack && hits.length > 0 && (
            <p className="mt-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
              번호판 가운데 한글이 확실치 않아 <strong>숫자 끝 4자리로 찾았습니다</strong> —
              목록에서 그 차를 골라 주세요.
            </p>
          )}
          {/* 번호판을 읽었는데 (되찾기까지 해도) 등록된 차가 없으면 다음 걸음을 말해 준다 */}
          {(photo?.plateNo || photo?.plateTail) && q.trim() !== "" && searchedQ === q && hits.length === 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              「{photo.plateNo ?? `끝 4자리 ${photo.plateTail}`}」로 등록된 차가 없습니다 — 아래{" "}
              <strong>등록 안 된 손님입니다</strong>를 누르면 사진에서 읽은 정보가 미리 채워집니다.
            </p>
          )}
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
              onClick={openNew}
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

/**
 * 거래처 카드 안의 차량 달기 — 검색(기존 정본 searchVehicles)과 「새 차량」.
 * 새 차량은 그 거래처의 차고 고객 소속으로 만들어진다 (sale.ts createSupplierVehicle —
 * 같은 번호판이 있으면 그 차량 재사용, 중복 금지). MARS 필수 항목은 안 받는다.
 */
function SupplierVehiclePick({ supplier, onPick }: { supplier: string; onPick: (v: VehicleHit) => void }) {
  const [vq, setVq] = useState("");
  const [vhits, setVhits] = useState<VehicleHit[]>([]);
  const [focused, setFocused] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ plateNo: "", makerName: "", model: "", mileage: "" });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const vt = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* ⭐ 거래처 차량도 사진으로 (사장님 요청 2026-09-06) — 개인 흐름과 같은 PhotoAssist */
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photo, setPhoto] = useState<PhotoInfo | null>(null);
  const [searchedVq, setSearchedVq] = useState("");
  const [fellBack, setFellBack] = useState(false);
  const handlePhotoInfo = (info: PhotoInfo) => {
    setPhoto((p) => ({ ...p, ...info }));
    if (info.plateNo) {
      setFellBack(false);
      setVq(info.plateNo); // 검색이 돌아 차고·기존 차량 후보가 뜬다
    } else if (info.plateTail) {
      setFellBack(true);
      setVq(info.plateTail); // 한글 오독 — 숫자 끝 4자리로 바로 찾는다
    }
  };

  /* ⭐ 끝 4자리 되찾기 (2026-09-06) — 개인 흐름과 같은 규칙: 한글 오독 대비 */
  useEffect(() => {
    if (!photo?.plateNo || fellBack) return;
    if (searchedVq !== photo.plateNo || vhits.length > 0) return;
    const tail = photo.plateNo.match(/(\d{4})$/)?.[1];
    if (!tail) return;
    setFellBack(true);
    setVq(tail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchedVq, vhits]);

  useEffect(() => {
    if (!focused && !vq.trim()) return;
    if (vt.current) clearTimeout(vt.current);
    // 검색어가 없으면 거래처 이름으로 — 차고·동명 고객의 차량들이 후보로 뜬다
    vt.current = setTimeout(
      () =>
        void searchVehicles(vq.trim() || supplier).then((r) => {
          setVhits(r.slice(0, 6));
          setSearchedVq(vq.trim());
        }),
      250,
    );
    return () => {
      if (vt.current) clearTimeout(vt.current);
    };
  }, [vq, focused, supplier]);

  const add = () =>
    start(async () => {
      setErr(null);
      const r = await createSupplierVehicle({ supplier, ...form });
      if (!r.ok) return setErr(r.error);
      onPick({
        vehicleId: r.vehicleId, plateNo: r.plateNo, makerName: r.makerName, model: r.model,
        year: null, mileage: r.mileage, vin: null, lastFittedSize: null,
        customerId: r.customerId, customerName: supplier, phone: null, memo: null, familyGroupId: null,
      });
    });

  return (
    <div className="mt-2">
      {!adding ? (
        <>
          <input
            value={vq}
            onChange={(e) => setVq(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 250)}
            placeholder="차량번호로 달기 (선택) — 예: 156허9093"
            className="w-full rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm"
          />
          {/* ⭐ 사진으로 달기 (2026-09-06) — 번호판·차량카드·계기판을 앨범에서 한꺼번에 */}
          <button
            type="button"
            onClick={() => setPhotoOpen((v) => !v)}
            className="mt-1 text-xs text-violet-600 underline underline-offset-4"
          >
            📷 사진으로 달기 {photoOpen ? "접기" : ""}
          </button>
          {photoOpen && <PhotoAssist onInfo={handlePhotoInfo} />}
          {(photo?.plateNo || photo?.plateTail) && fellBack && vhits.length > 0 && (
            <p className="mt-1 rounded-lg bg-sky-50 px-3 py-1.5 text-xs text-sky-800">
              번호판 한글이 확실치 않아 숫자 끝 4자리로 찾았습니다 — 목록에서 골라 주세요.
            </p>
          )}
          {(focused || vq.trim()) && (
            <ul className="mt-1 space-y-1" onMouseDown={(e) => e.preventDefault()}>
              {vhits.map((h) => (
                <li key={h.vehicleId}>
                  <button
                    type="button"
                    onClick={() => onPick(h)}
                    className="flex w-full items-baseline gap-2 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-left text-sm active:bg-violet-100"
                  >
                    <span className="font-medium">{h.plateNo}</span>
                    <span className="min-w-0 truncate text-xs text-slate-500">
                      {[h.model, h.customerName].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setAdding(true);
                    // 사진에서 읽은 값이 있으면 미리 채운다 (2026-09-06) — 저장 전 전부 수정 가능
                    setForm((f) => ({
                      plateNo: photo?.plateNo ?? vq.trim() ?? f.plateNo,
                      makerName: photo?.makerName ?? f.makerName,
                      model: photo?.carName
                        ? `${photo.carName}${photo.modelCode ? `(${photo.modelCode})` : ""}`
                        : f.model,
                      mileage: photo?.odoKm ? String(photo.odoKm) : f.mileage,
                    }));
                  }}
                  className="w-full rounded-lg border border-dashed border-violet-400 px-3 py-1.5 text-sm font-medium text-violet-700 active:bg-violet-100"
                >
                  + 새 차량으로 달기{vq.trim() ? ` (${vq.trim()})` : ""}
                </button>
              </li>
            </ul>
          )}
        </>
      ) : (
        <div className="rounded-xl border border-violet-300 bg-white p-2">
          <div className="grid grid-cols-2 gap-1.5">
            <input value={form.plateNo} onChange={(e) => setForm({ ...form, plateNo: e.target.value })}
              placeholder="차량번호 (필수)" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
            <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="모델 (선택) — K5" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
            <input value={form.makerName} onChange={(e) => setForm({ ...form, makerName: e.target.value })}
              placeholder="제조사 (선택)" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
            <input value={form.mileage} onChange={(e) => setForm({ ...form, mileage: e.target.value.replace(/[^\d]/g, "") })}
              inputMode="numeric" placeholder="주행거리 km (선택)" className="tabular rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            거래처 차량으로 담깁니다 — 나중에 개인 손님으로 오면 「새 손님 등록」 때 그 손님에게 자동으로 넘어갑니다.
          </p>
          {err && <p className="mt-1 rounded-lg bg-red-50 p-1.5 text-xs text-red-700">⚠️ {err}</p>}
          <div className="mt-1.5 flex gap-2">
            <button type="button" onClick={() => setAdding(false)} className="text-xs text-slate-500 underline">닫기</button>
            <button type="button" disabled={pending || !form.plateNo.trim()} onClick={add}
              className="ml-auto rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              담기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

