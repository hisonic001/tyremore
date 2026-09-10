"use client";

import { signedInt, signedStr, showSigned } from "@/lib/signed-input";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RateBox } from "../rate-box";
import type { ProductHit, VehicleHit } from "@/lib/search";
import { findOpenReservations, searchProducts } from "@/lib/search-actions";
import type { OpenReservation } from "@/lib/search";
import { findServices, saveSale, type SaleLine } from "@/lib/sale";
import { EXCLUSIVE, SPLITTABLE } from "@/lib/payments";
/** ⭐ 고객·거래처 선택기는 공용으로 뺐다 (2026-08-17) — 정비 내역의 「대상 바꾸기」도 쓴다 */
import { CustomerPick, type NewCustomerDraft } from "./customer-pick";
import { clearLegacyDrafts, readLegacyDrafts, type SaleDraftState } from "./draft-store";
import { listSaleDrafts, removeSaleDraft, saveSaleDraft, type ServerSaleDraft } from "@/lib/sale-draft";
import { useConfirm } from "@/components/ui/confirm";
import { AmountBox } from "@/components/ui/amount-box";

const won = (n: number) => n.toLocaleString();

/** 담긴 한 줄 */
interface Row extends SaleLine {
  key: string;
  /** 인치 — 화면에서만 쓴다 (저장할 때는 뺀다) */
  rimInch?: number | null;
  /**
   * ⭐ 타이어 규격 — 화면 표시용 (사장님 지시 2026-08-18: "타이어를 선택하면
   *    사이즈는 작업내역에 안들어가서 사이즈를 알 수 없음").
   *    저장 데이터에는 안 넣는다 — 내역·출력 화면이 상품에서 규격을 따로 붙이므로
   *    설명에 넣으면 두 번 찍힌다.
   */
  spec?: string | null;
}

/**
 * 서비스 = 무상 (사장님 요청 2026-08-07 — 단골 무상 점검·가벼운 서비스)
 * ⭐ 결제수단을 여러 개 고를 수 있다 (사장님 요청 2026-08-10) —
 *    카드·현금·계좌이체·지역화폐는 섞어서, 외상·서비스는 단독으로만.
 */
const PAYMENTS = [...SPLITTABLE, ...EXCLUSIVE] as readonly string[];

export function SaleForm({
  owner = false,
  initialVehicle = null,
}: {
  owner?: boolean;
  /** ⭐ 차량 상세에서 물고 온 차 (2026-09-05) — `/sale?vehicle=` */
  initialVehicle?: VehicleHit | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, confirmDialog] = useConfirm(); // 배치3 — 브라우저 confirm() 대체 시트

  const [vehicle, setVehicle] = useState<VehicleHit | null>(initialVehicle);
  /** ⭐ 거래처 판매 (사장님 요청 2026-08-05) — MARS 에 등록하지 않는다 */
  const [supplierSale, setSupplierSale] = useState<string | null>(null);
  const [walkIn, setWalkIn] = useState({ name: "", phone: "", plateNo: "" });
  const [mileage, setMileage] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  /**
   * ⭐ 결제수단 여러 개 + 수단별 금액 (사장님 요청 2026-08-10).
   *    금액은 숫자만 담은 글자로 든다. 수단이 1개면 금액은 어차피 전액이라
   *    저장 때 무시된다 — 2개 이상일 때만 분할로 저장된다.
   */
  const [payMethods, setPayMethods] = useState<string[]>(["카드"]);
  const [payAmounts, setPayAmounts] = useState<Record<string, string>>({});
  /**
   * ⭐ 본사청구 (2026-09-10) — 손님 차에 시공했지만 **돈은 제조사가 준다**
   *    (미쉐린 데미지 프리 쿠폰 · OE 타이어 AS). 저장은 「외상 + 청구처」라
   *    MARS 소매 등록은 그대로 되고, 받을 돈은 그 제조사 앞으로 쌓인다.
   */
  const [claimParty, setClaimParty] = useState<string | null>(null);
  const [claimKind, setClaimKind] = useState("데미지쿠폰");
  /**
   * ⭐ 복합결제 스위치 (사장님 요청 2026-08-10 — "두개를 누르는게 활성화되니까 좀 불편").
   *    꺼져 있으면 예전처럼 하나만 골라진다(누르면 바뀜). 켰을 때만 2개 이상 + 금액 분배.
   */
  const [combo, setCombo] = useState(false);
  /** ⭐ 예약 (사장님 요청 2026-09-01) — 선금 받고 나중에 시공. 재고는 시공 완료 때 뺀다 */
  const [reserve, setReserve] = useState(false);
  /** 복합결제 수단별 「받은 날」 — 비면 작업일. 예약금·잔금이 다른 날일 때 쓴다 */
  const [payDates, setPayDates] = useState<Record<string, string>>({});
  /** 이 차량·손님에게 걸린 예약 — 고르는 순간 배너로 알려 준다 */
  const [openResv, setOpenResv] = useState<OpenReservation[]>([]);
  const [memo, setMemo] = useState("");
  /** 실제로 정비한 날 — 기본은 오늘이지만 고칠 수 있다 */
  const today = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD
  const [workDate, setWorkDate] = useState(today);
  const [done, setDone] = useState<{ quoteNo: string; shortages: string[]; reserved?: boolean } | null>(null);
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

  /* ---- 분할 결제 (사장님 요청 2026-08-10) ---- */
  const splitPay = (SPLITTABLE as readonly string[]);
  const exclusivePay = (EXCLUSIVE as readonly string[]);
  const paySum = payMethods.reduce((s, m) => s + Number(payAmounts[m] || "0"), 0);
  const payKey = payMethods.join("|");
  /** 복합결제에서 수단이 1개면 금액은 전액 — 품목이 바뀌어 합계가 달라져도 따라간다 */
  useEffect(() => {
    if (combo && payMethods.length === 1 && splitPay.includes(payMethods[0])) {
      setPayAmounts({ [payMethods[0]]: String(total) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, payKey, combo]);

  /** 복합결제 켜고 끄기 — 끄면 첫 수단 하나만 남긴다 */
  const toggleCombo = () => {
    setError(null);
    setCombo((on) => {
      if (on) {
        setPayMethods((prev) => {
          const first = prev.find((m) => splitPay.includes(m)) ?? "카드";
          return [first];
        });
        setPayAmounts({});
        return false;
      }
      // 켜는 순간 — 외상·서비스가 골라져 있었으면 카드부터 시작한다
      setPayMethods((prev) => (prev.every((m) => splitPay.includes(m)) && prev.length ? prev : ["카드"]));
      return true;
    });
  };

  /** 본사청구 켜기·끄기 — 결제수단은 「외상」으로 굳는다 (받을 돈이 맞으므로) */
  const toggleClaim = () => {
    setError(null);
    setClaimParty((prev) => {
      if (prev) return null;
      setCombo(false);
      setPayMethods(["외상"]);
      setPayAmounts({});
      return "미쉐린";
    });
  };

  const togglePay = (p: string) => {
    setError(null);
    setClaimParty(null); // 다른 수단을 고르면 본사청구는 해제
    if (exclusivePay.includes(p)) {
      // 외상·서비스는 단독 — MARS·대기열 처리가 결제수단 하나를 전제한다
      setCombo(false);
      setPayMethods([p]);
      setPayAmounts({});
      return;
    }
    /** 복합결제가 꺼져 있으면 예전처럼 하나만 — 누르면 바뀐다 (사장님 요청 2026-08-10) */
    if (!combo) {
      setPayMethods([p]);
      setPayAmounts({});
      return;
    }
    setPayMethods((prev) => {
      const cur = prev.filter((m) => splitPay.includes(m));
      if (cur.includes(p)) {
        const next = cur.filter((m) => m !== p);
        if (next.length === 0) return prev; // 마지막 하나는 못 끈다
        setPayAmounts((a) => {
          const rest = { ...a };
          delete rest[p];
          return next.length === 1 ? { [next[0]]: String(total) } : rest;
        });
        return next;
      }
      /**
       * ⭐ 새 수단을 고르는 순간 **나머지 금액이 자동으로** 들어간다 (사장님 요청 2026-08-10).
       *    "합계가 10000원이면 카드를 골라 2000원을 입력하고 현금을 고르는 순간 자동으로 8000원"
       */
      setPayAmounts((a) => {
        const used = cur.reduce((s, m) => s + Number(a[m] || "0"), 0);
        return cur.length === 0
          ? { [p]: String(total) }
          : { ...a, [p]: String(total - used) }; // 마이너스 판매면 나머지도 마이너스 (2026-08-21)
      });
      return cur.length === 0 ? [p] : [...cur, p];
    });
  };

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
          spec: p.spec ?? null,
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

  /**
   * ⭐ 임시 저장 (사장님 요청 2026-08-19) — 손님이 겹칠 때 쓰던 판을 접어 두고
   *    다른 손님을 먼저 등록한다. 담아둔 타이어와 같은 localStorage 방식.
   */
  const [drafts, setDrafts] = useState<ServerSaleDraft[]>([]);
  /**
   * ⭐ 지금 펼쳐서 작업 중인 임시저장 카드 (사장님 확정 2026-09-07).
   *    펼쳐도 카드는 남고, 다시 접으면 이 id 의 카드가 **갱신**되며,
   *    판매완료가 성공하는 그 순간에만 지워진다.
   */
  const [activeDraftId, setActiveDraftId] = useState<number | null>(null);
  /** 신규 손님 폼의 중간 입력 — 폼 내부 상태를 여기로 흘려받아 임시 저장에 함께 접는다 */
  const [newCust, setNewCust] = useState<NewCustomerDraft | null>(null);
  /** CustomerPick 을 통째로 다시 그리게 하는 열쇠 — 접기/펼치기 때 내부 상태(검색어·폼)를 리셋 */
  const [formEpoch, setFormEpoch] = useState(0);
  useEffect(() => {
    /* ⭐ 서버 보관으로 이사 (2026-09-07) — 이 기기 localStorage 에 남은 옛 접어둔
       판매를 한 번 서버로 올리고 비운다. 그 뒤 공유 목록을 불러온다 */
    void (async () => {
      const legacy = readLegacyDrafts();
      for (const d of legacy) await saveSaleDraft(d.label, d.state).catch(() => null);
      if (legacy.length > 0) clearLegacyDrafts();
      setDrafts(await listSaleDrafts().catch(() => []));
    })();
  }, []);

  // ⭐ 차량·손님이 정해지면 예약 걸린 건이 있는지 물어본다 (2026-09-01)
  useEffect(() => {
    if (!vehicle) return setOpenResv([]);
    let alive = true;
    void findOpenReservations({ vehicleId: vehicle.vehicleId, customerId: vehicle.customerId })
      .then((r) => alive && setOpenResv(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [vehicle]);

  const resetForm = () => {
    setRows([]);
    setVehicle(null);
    setSupplierSale(null);
    setWalkIn({ name: "", phone: "", plateNo: "" });
    setMileage("");
    setMemo("");
    setPayMethods(["카드"]);
    setPayAmounts({});
    setCombo(false);
    setWheels([]);
    setWorkDate(today);
    setNewCust(null);
    setActiveDraftId(null);
    setFormEpoch((e) => e + 1);
  };

  const stashDraft = () => {
    const who = supplierSale
      ? `거래처 ${supplierSale}${vehicle ? ` · ${vehicle.plateNo}` : ""}`
      : vehicle
        ? `${vehicle.plateNo}${vehicle.customerName ? ` ${vehicle.customerName}` : ""}`
        : newCust?.f.name || newCust?.f.plateNo
          ? `신규 ${newCust.f.name || newCust.f.plateNo} (등록 중)`
          : walkIn.name || walkIn.plateNo || "손님 미지정";
    const label = `${who} · ${rows.length}줄 · ${won(total)}원`;
    const draftId = activeDraftId; // resetForm 이 지우기 전에 붙잡는다
    void (async () => {
      /* ⭐ 펼쳐 둔 카드가 있으면 그 카드를 갱신 — "지워지지 않고 업데이트만" (사장님 확정) */
      await saveSaleDraft(
        label,
        {
          vehicle,
          supplierSale,
          walkIn,
          mileage,
          rows,
          payMethods,
          payAmounts,
          combo,
          memo,
          workDate,
          wheels,
          newCustomer: newCust,
          // ⭐ 2026-09-07 보강 — 접히지 않아 유실되던 두 칸
          payDates,
          reserve,
        },
        draftId,
      ).catch(() => null);
      setDrafts(await listSaleDrafts().catch(() => []));
    })();
    resetForm();
  };

  const restoreDraft = (d: ServerSaleDraft) => {
    const st = d.state;
    setVehicle((st.vehicle as VehicleHit | null) ?? null);
    setSupplierSale(st.supplierSale ?? null);
    setWalkIn(st.walkIn ?? { name: "", phone: "", plateNo: "" });
    setMileage(st.mileage ?? "");
    setRows((st.rows as Row[]) ?? []);
    setPayMethods(st.payMethods?.length ? st.payMethods : ["카드"]);
    setPayAmounts(st.payAmounts ?? {});
    setPayDates(st.payDates ?? {});
    setReserve(!!st.reserve);
    setCombo(!!st.combo);
    setMemo(st.memo ?? "");
    setWorkDate(st.workDate || today);
    setWheels(st.wheels ?? []);
    setNewCust((st.newCustomer as NewCustomerDraft | null) ?? null);
    setFormEpoch((e) => e + 1); // CustomerPick 을 다시 그려 신규 폼이 접힌 그대로 열리게
    /* ⭐ 펼쳐도 카드는 남는다 (사장님 확정 2026-09-07) — 지워지는 건 x 또는 판매완료뿐.
       대신 id 를 기억해, 다시 접으면 이 카드가 갱신되고 판매완료 때 지워진다 */
    setActiveDraftId(d.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /**
   * ⭐ 접어둔 판매 카드 — 담아둔 타이어(ComparePanel)와 같은 생김새 (사장님 요청 2026-08-19
   *    "타이어 담기처럼 오른쪽에 보기 좋게"). PC 는 오른쪽 열 맨 위, 폰은 본문 맨 위.
   */
  const draftsCard =
    drafts.length > 0 ? (
      <aside className="rounded-xl border border-amber-300 bg-white p-3 shadow-sm">
        <h2 className="text-sm font-bold text-amber-900">
          접어둔 판매 <span className="font-normal text-amber-600">{drafts.length}</span>
        </h2>
        {drafts.length > 0 && (
          <ul className="mt-1 divide-y divide-amber-100">
            {drafts.map((d) => (
              <li key={d.id} className="py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{d.label.split(" · ")[0]}</div>
                    <div className="tabular text-xs text-slate-500">
                      {d.label.split(" · ").slice(1).join(" · ")} · {d.savedAt}
                      {/* 공유 목록이라 누가 접어뒀는지 보인다 (2026-09-07) */}
                      {d.byName && <span className="text-slate-400"> · {d.byName}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="지우기"
                    onClick={async () => {
                      if (!(await ask({ title: "임시 저장을 지울까요?", body: d.label, tone: "danger", confirmLabel: "지우기" })))
                        return;
                      await removeSaleDraft(d.id).catch(() => null);
                      if (activeDraftId === d.id) setActiveDraftId(null);
                      setDrafts(await listSaleDrafts().catch(() => []));
                    }}
                    className="shrink-0 px-1 text-slate-300 active:text-slate-600"
                  >
                    ✕
                  </button>
                </div>
                {activeDraftId === d.id ? (
                  <p className="mt-1.5 rounded-lg bg-amber-100 py-2 text-center text-sm font-semibold text-amber-800">
                    지금 펼쳐서 작업 중 — 판매완료하면 지워집니다
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => restoreDraft(d)}
                    className="mt-1.5 w-full rounded-lg bg-amber-600 py-2 text-sm font-semibold text-white active:bg-amber-700"
                  >
                    펼치기
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </aside>
    ) : null;

  const submit = async () => {
    /**
     * ⭐ 고객 미등록 경고 (사장님 요청 2026-08-08).
     *    "고객 등록을 안하고 판매 확정을 누르면 한번 경고를 하며 고객등록을 하도록 유도"
     *    거래처 판매가 아닌데 차량을 고르지 않았으면 — 한 번 묻는다.
     */
    if (!supplierSale && !vehicle) {
      const ok = await ask({
        title: "고객·차량 없이 저장할까요?",
        body:
          "이대로 저장하면 비회원 판매로 남아 MARS 자동 입력이 안 되고, 다음 방문 때 이력이 이어지지 않습니다.\n\n고객·차량 탭의 「등록 안 된 손님입니다」로 등록하는 것을 권합니다.",
        confirmLabel: "이대로 저장",
        cancelLabel: "돌아가기",
      });
      if (!ok) return;
    }
    // 분할 결제는 금액 합이 판매 합계와 같아야 저장된다 (서버도 다시 검증한다)
    if (payMethods.length >= 2 && paySum !== total) {
      setError(
        `분할 금액 합계(${won(paySum)}원)가 판매 합계(${won(total)}원)와 ${won(Math.abs(total - paySum))}원 다릅니다 — 결제 칸에서 맞춰 주세요`,
      );
      return;
    }
    start(async () => {
      setError(null);
      const res = await saveSale({
        /**
         * ⭐ 거래처 판매에도 차량이 같이 간다 (2026-08-21 — 거래처와 이름이 같은 손님).
         *    전에는 거래처면 차량을 지웠다. 이제 거래처 장부에 모이면서 그 차 기록에도 남는다.
         */
        vehicleId: vehicle?.vehicleId ?? null,
        customerId: vehicle?.customerId ?? null,
        walkIn: supplierSale || vehicle ? null : walkIn.name || walkIn.phone || walkIn.plateNo ? walkIn : null,
        supplierName: supplierSale,
        // ⭐ 본사청구 (2026-09-10) — supplierName 과 달리 MARS 를 막지 않는다
        claimParty,
        claimKind: claimParty ? claimKind : null,
        lines: rows.map(({ key, rimInch, ...l }) => l),
        paymentMethod: payMethods.length === 1 ? payMethods[0] : "혼합",
        payments:
          payMethods.length >= 2
            ? payMethods.map((m) => ({ method: m, amount: Number(payAmounts[m] || "0"), paidOn: payDates[m] || null }))
            : null,
        reserve,
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
      /* ⭐ 판매완료 성공 — 펼쳐서 작업하던 임시저장 카드는 여기서만 자동으로 지워진다
         (사장님 확정 2026-09-07) */
      if (activeDraftId !== null) {
        const gone = activeDraftId;
        setActiveDraftId(null);
        void removeSaleDraft(gone)
          .then(() => listSaleDrafts())
          .then((r) => setDrafts(r))
          .catch(() => null);
      }
      setDone({ quoteNo: res.quoteNo, shortages: res.shortages, reserved: reserve });
      setRows([]);
      setVehicle(null);
      setSupplierSale(null);
      setWalkIn({ name: "", phone: "", plateNo: "" });
      setMileage("");
      setMemo("");
      setPayMethods(["카드"]);
      setPayAmounts({});
      setPayDates({});
      setReserve(false);
      setCombo(false);
      setWheels([]);
      wheelsTouched.current = false;
      router.refresh();
    });
  };

  if (done) {
    return (
      <section className="mt-5 rounded-card border-2 border-brand-500 bg-brand-50 p-5">
        <h2 className="text-lg font-bold text-brand-700">판매를 등록했습니다 — {done.quoteNo}</h2>
        <p className="mt-1 text-sm text-brand-700">
          {done.reserved
            ? "📌 예약으로 남았습니다 — 재고는 아직 안 빠졌고, 손님이 오시면 정비 내역에서 「시공 완료」를 눌러 주세요. 차량을 고르면 예약 배너가 뜹니다."
            : "재고가 빠졌고 정비 내역에 남았습니다. MARS 에 올릴 때는 정비 내역에서 카드를 체크하세요."}
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
            className="flex-1 rounded-control bg-brand-600 py-3 text-center font-semibold text-white transition-colors active:bg-brand-700"
          >
            정비 내역 보기
          </a>
          <button
            type="button"
            onClick={() => setDone(null)}
            className="flex-1 rounded-control border border-slate-300 bg-white py-3 font-semibold text-slate-700 transition-colors active:bg-slate-100"
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
      {/* 폰에서는 본문 맨 위 — PC 는 오른쪽 열에 나온다 */}
      {draftsCard && <div className="lg:hidden">{draftsCard}</div>}
      <CustomerPick
        key={formEpoch}
        vehicle={vehicle}
        onPick={setVehicle}
        walkIn={walkIn}
        onWalkIn={setWalkIn}
        supplier={supplierSale}
        onSupplier={setSupplierSale}
        newDraft={newCust}
        onNewDraft={setNewCust}
        // ⭐ 계기판 사진에서 읽은 주행거리 (2026-09-05) — 판매의 주행거리 칸으로
        onMileage={(km) => setMileage(String(km))}
      />

      {/* ⭐ 예약 배너 (2026-09-01) — 이 차·이 손님에게 걸린 예약이 있으면 바로 알려 준다 */}
      {openResv.length > 0 && (
        <div className="rounded-xl border-2 border-violet-400 bg-violet-50 p-3">
          <p className="text-sm font-bold text-violet-900">📌 이 손님, 예약 {openResv.length}건이 걸려 있습니다</p>
          <ul className="mt-1 space-y-0.5">
            {openResv.map((r) => (
              <li key={r.quoteId} className="tabular text-xs text-violet-900">
                {r.workDate.slice(5)} 예약 · {won(r.total)}원 · {r.summary}
                {r.memo && <span className="text-violet-600"> — {r.memo.slice(0, 40)}</span>}
              </li>
            ))}
          </ul>
          <a
            href={`/sales?vehicle=${vehicle?.vehicleId ?? ""}`}
            className="mt-1.5 inline-block text-xs font-semibold text-violet-800 underline underline-offset-4"
          >
            정비 내역에서 열기 → (시공하러 오셨으면 거기서 「시공 완료」)
          </a>
        </div>
      )}

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
        owner={owner}
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

      {/* ⭐ 정비에 쓴 부품 — 기본 0원(재고만 차감), 금액도 쓸 수 있다 (2026-08-24) */}
      <UsedPartsPick
        onAdd={(p) =>
          setRows((rs) => [
            ...rs,
            {
              key: `u-${p.productId}-${Date.now()}`,
              kind: "use",
              productId: p.productId,
              description: p.model,
              marsName: p.marsName,
              qty: 1,
              unitPrice: 0,
              listPrice: null,
              salesRate: null,
            },
          ])
        }
      />
    </div>

    {/* 오른쪽 — 결제만 고정(sticky). 스크롤해도 결제·메모가 늘 보인다 */}
    <div className="mt-4 space-y-4 lg:sticky lg:top-4 lg:mt-0">
      {/* ⭐ 접어둔 판매 — 담기 패널처럼 오른쪽에 (사장님 요청 2026-08-19) */}
      {draftsCard && <div className="hidden lg:block">{draftsCard}</div>}
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

        {/*
          ⭐ 복합결제는 스위치를 켰을 때만 (사장님 요청 2026-08-10 —
             "두개를 누르는게 활성화되니까 좀 불편하네"). 꺼져 있으면 하나만 골라진다.
        */}
        <div className="mt-2 flex flex-wrap gap-2">
          {PAYMENTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => togglePay(p)}
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                payMethods.includes(p) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white"
              }`}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            onClick={toggleCombo}
            className={`rounded-lg border border-dashed px-4 py-2 text-sm font-medium ${
              combo ? "border-indigo-700 bg-indigo-700 text-white" : "border-indigo-400 bg-white text-indigo-700"
            }`}
          >
            복합결제
          </button>
          {/* ⭐ 본사청구 (2026-09-10) — 데미지 쿠폰·OE AS. 돈은 제조사가 준다 */}
          <button
            type="button"
            onClick={toggleClaim}
            className={`rounded-lg border border-dashed px-4 py-2 text-sm font-medium ${
              claimParty ? "border-sky-700 bg-sky-700 text-white" : "border-sky-400 bg-white text-sky-700"
            }`}
          >
            본사청구
          </button>
          {/* ⭐ 예약 (2026-09-01) — 선금·구두 예약. 재고는 시공 완료 때 */}
          <button
            type="button"
            onClick={() => setReserve((v) => !v)}
            className={`rounded-lg border border-dashed px-4 py-2 text-sm font-medium ${
              reserve ? "border-violet-700 bg-violet-700 text-white" : "border-violet-400 bg-white text-violet-700"
            }`}
          >
            📌 예약
          </button>
        </div>
        {claimParty && (
          <div className="mt-1.5 rounded-lg bg-sky-50 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-sky-900">청구처</span>
              {["미쉐린", "금호", "콘티넨탈"].map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setClaimParty(b)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
                    claimParty === b ? "border-sky-700 bg-sky-700 text-white" : "border-sky-300 bg-white text-sky-800"
                  }`}
                >
                  {b}
                </button>
              ))}
              <input
                value={["미쉐린", "금호", "콘티넨탈"].includes(claimParty) ? "" : claimParty}
                onChange={(e) => setClaimParty(e.target.value || "미쉐린")}
                placeholder="직접 입력"
                className="w-24 rounded-lg border border-sky-300 px-2 py-1 text-xs outline-none focus:border-sky-700"
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-sky-900">사유</span>
              {["데미지쿠폰", "OE AS", "기타"].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setClaimKind(k)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
                    claimKind === k ? "border-sky-700 bg-sky-700 text-white" : "border-sky-300 bg-white text-sky-800"
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-tight text-sky-900">
              손님은 <strong>0원</strong>이지만 <strong>{claimParty}에 청구할 금액</strong>을 단가로 넣어 주세요 — 재고가
              빠지고 마진도 제대로 잡힙니다. 받을 돈은 「{claimParty}」 앞으로 쌓이고, 본사 입금이 오면 수금으로
              정리됩니다. MARS 에는 평소처럼 올라갑니다.
            </p>
          </div>
        )}
        {reserve && (
          <p className="mt-1.5 rounded-lg bg-violet-50 px-2 py-1.5 text-xs text-violet-900">
            <strong>예약으로 저장</strong> — 오늘 받은 돈은 오늘 매출로 남고, <strong>재고는 안 빠집니다</strong>
            (시공하러 오시면 정비 내역에서 「시공 완료」). 재고가 없어도, 돈을 안 받았어도(0원) 담을 수 있습니다.
            MARS 는 시공 완료 뒤에 올립니다.
          </p>
        )}
        {combo && (
          <p className="mt-1.5 text-xs text-indigo-700">
            복합결제 — 수단을 2개 이상 고르세요. 새 수단을 고르면 나머지 금액이 자동으로 들어갑니다.
          </p>
        )}

        {/* 수단별 금액 — 복합결제일 때만 */}
        {combo && payMethods.every((m) => splitPay.includes(m)) && (
          <div className="mt-2 space-y-1.5">
            {payMethods.map((m) => (
              <label key={m} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-sm text-slate-600">{m}</span>
                <input
                  value={showSigned(payAmounts[m] ?? "")}
                  onChange={(e) => setPayAmounts((a) => ({ ...a, [m]: signedStr(e.target.value) }))}
                  inputMode="numeric"
                  className="tabular min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-right text-sm"
                />
                <span className="shrink-0 text-xs text-slate-400">원</span>
                {/* ⭐ 받은 날 (2026-09-01) — 비면 작업일. 예약금을 먼저 받은 날짜를 적으면 카드 일마감이 그 날로 맞는다 */}
                <input
                  type="date"
                  value={payDates[m] ?? ""}
                  onChange={(e) => setPayDates((d) => ({ ...d, [m]: e.target.value }))}
                  title="받은 날 (비면 작업일)"
                  className="tabular w-32 shrink-0 rounded-lg border border-slate-200 px-1.5 py-2 text-xs text-slate-600"
                />
              </label>
            ))}
            {payMethods.length >= 2 && paySum !== total && (
              <p className="rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-700">
                합계 {won(total)}원과 <strong>{won(Math.abs(total - paySum))}원 차이</strong> — 저장 전에 맞춰 주세요
              </p>
            )}
            {payMethods.length === 1 && payAmounts[payMethods[0]] !== undefined && Number(payAmounts[payMethods[0]]) !== total && (
              <p className="text-xs text-slate-400">
                수단이 1개면 전액 {won(total)}원으로 저장됩니다 — 나눠 받으려면 수단을 하나 더 고르세요 (나머지가 자동으로 들어갑니다)
              </p>
            )}
          </div>
        )}
        {/* ⭐ 마이너스 판매 (사장님 요청 2026-08-21 — 카드 취소·환불) */}
        {total < 0 && (
          <p className="mt-1.5 rounded-lg bg-rose-50 px-2 py-1.5 text-xs text-rose-900">
            <strong>마이너스 판매(환불·카드 취소)</strong>로 저장됩니다 — 돌려준 돈의 수단을 고르세요.
            재고는 되돌리지 않고(타이어 반품은 재고 화면에서), MARS 에는 올라가지 않습니다.
          </p>
        )}
        {payMethods[0] === "외상" && (
          <p className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
            외상은 <strong>MARS 자동 입력에서 빠집니다.</strong> 여기 기록만 남고, MARS 는 직접 처리해 주세요.
          </p>
        )}
        {payMethods[0] === "서비스" && (
          <p className="mt-1.5 rounded-lg bg-brand-50 px-2 py-1.5 text-xs text-brand-700">
            서비스(무상)는 <strong>MARS 에 등록하지 않습니다</strong> — 우리 기록에만 남습니다.
            단가를 0원으로 바꿔서 등록하세요.
          </p>
        )}
        {payMethods.includes("지역화폐") && (
          <p className="mt-1.5 rounded-lg bg-sky-50 px-2 py-1.5 text-xs text-sky-900">
            지역화폐는 MARS 에 <strong>현금으로</strong> 들어갑니다.
          </p>
        )}
        {/* ⭐ 간편결제 (사장님 요청 2026-08-29) — 어느 페이인지는 여기서 안 고른다.
            토스 포스 매출리포트 「매입사」 칸에 이미 적혀 오고, 카드 일마감이 그걸 보여준다 */}
        {payMethods.includes("간편결제") && (
          <p className="mt-1.5 rounded-lg bg-violet-50 px-2 py-1.5 text-xs text-violet-900">
            간편결제(QR·네이버페이·카카오페이·토스페이)는 <strong>여신협회 승인내역에 안 잡힙니다</strong> —
            카드 일마감은 토스 포스 자료로 맞춥니다. 어느 페이였는지는 고르지 않으셔도 됩니다.
            MARS 에는 카드로 들어갑니다.
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
            disabled={pending || (rows.length === 0 && !vehicle && !supplierSale && !newCust)}
            onClick={stashDraft}
            className="shrink-0 rounded-control border border-slate-300 bg-white px-4 py-3.5 font-bold text-slate-700 transition-colors active:bg-slate-100 disabled:opacity-40"
          >
            임시 저장
          </button>
          <button
            type="button"
            disabled={pending || rows.length === 0}
            onClick={submit}
            className="shrink-0 rounded-control bg-brand-600 px-6 py-3.5 text-lg font-bold text-white transition-colors active:bg-brand-700 disabled:opacity-40"
          >
            {pending ? "저장 중…" : "판매 확정"}
          </button>
        </div>
      </div>
      {confirmDialog}
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
  /** 단가 칸 초안 — '-' 를 치는 순간 숫자로 굳히면 '-' 가 사라진다 (마이너스 결제, 2026-08-21) */
  const [unitDraft, setUnitDraft] = useState<string | null>(null);
  const priceChange = (n: number): Partial<Row> => ({
    unitPrice: n,
    salesRate:
      row.listPrice && row.listPrice > 0
        ? Math.round(Math.max(0, Math.min(0.999, 1 - n / row.listPrice)) * 10000) / 10000
        : (row.salesRate ?? null),
  });
  return (
    <li className={`rounded-lg p-2 ${row.kind === "use" ? "bg-sky-50" : "bg-slate-50"}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {/* ⭐ 부품 (2026-08-11) — 기본 0원(재고만 차감), 금액을 쓰면 청구·MARS 포함 (2026-08-24) */}
            {row.kind === "use" && <span className="mr-1 rounded bg-sky-200 px-1.5 py-0.5 text-xs font-semibold text-sky-900">부품 사용</span>}
            {row.description}
            {row.spec && <span className="tabular ml-1 font-normal text-slate-500">{row.spec}</span>}
          </div>
          {row.marsNo && <div className="tabular text-xs text-slate-500">{row.marsNo}</div>}
        </div>
        <button type="button" onClick={onRemove} className="shrink-0 px-1.5 text-slate-400" aria-label="빼기">
          ✕
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={() => onChange({ qty: Math.max(1, row.qty - 1) })}>
          −
        </button>
        <span className="tabular w-8 text-center font-bold">{row.qty}</span>
        <button type="button" className={BTN} onClick={() => onChange({ qty: row.qty + 1 })}>
          +
        </button>
        {/* ⭐ 부품(use) 줄도 단가·금액을 쓴다 — 기본 0원 (사장님 요청 2026-08-24) */}
        <>
            <label className="ml-auto flex items-center gap-1">
              <span className="text-xs text-slate-500">단가</span>
              <input
                value={unitDraft ?? won(row.unitPrice)}
                onFocus={() => setUnitDraft(won(row.unitPrice))}
                onChange={(e) => {
                  const s = signedStr(e.target.value);
                  setUnitDraft(showSigned(s));
                  onChange(priceChange(signedInt(s)));
                }}
                onBlur={() => setUnitDraft(null)}
                inputMode="numeric"
                className={`tabular h-9 w-24 rounded-lg border px-2 text-right ${
                  row.kind === "service" && row.unitPrice === 0 ? "border-amber-400 bg-amber-50" : "border-slate-300"
                }`}
              />
            </label>
            <label className="flex items-center gap-1">
              <span className="text-xs text-slate-500">금액</span>
              <AmountBox
                qty={row.qty}
                unitPrice={row.unitPrice}
                onUnit={(n) => onChange(priceChange(n))}
              />
            </label>
        </>
      </div>
      {/* ⭐ 「기타」처럼 건별로 정하는 공임은 0원으로 담긴다 — 실제로 0원인 채 저장된 판매가 있었다 (2026-08-31) */}
      {row.kind === "service" && row.unitPrice === 0 && (
        <p className="mt-1 text-right text-xs font-medium text-amber-700">금액을 적어 주세요 — 이 공임은 건별로 정합니다</p>
      )}
      {/* 0원이면 종전 그대로 소모 줄 — 금액을 쓰면 손님 청구·MARS 에 들어간다 */}
      {row.kind === "use" && (
        <p className="mt-1 text-right text-xs text-sky-800">
          {row.unitPrice === 0 ? "0원 — 재고만 차감 (손님 청구 없음)" : "금액이 있어 손님 청구에 들어갑니다"}
        </p>
      )}
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
      {/* ⭐ 줄별 메모 (사장님 지시 2026-08-07) — MARS 이 줄의 「설명 2」로 들어간다.
            금액 있는 부품 줄도 MARS 에 가므로 이제 모든 줄에 보인다 (2026-08-24) */}
      <input
        value={row.memo ?? ""}
        onChange={(e) => onChange({ memo: e.target.value })}
        placeholder="이 줄 메모 (선택) — MARS 설명 2"
        className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
      />
    </li>
  );
}

/* AmountBox 는 공용 부품으로 추출 (2026-09-03) — components/ui/amount-box.tsx 가 정본 */


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
    // ⭐ 타이어만 (사장님 지시 2026-08-14) — 부품 1,800여 종이 섞이면 상담 검색이 복잡해진다.
    //    부품은 아래 「정비에 쓴 부품」에서, 유상 부품(배터리 교체 등)은 공임·정비 항목으로.
    timer.current = setTimeout(
      () => void searchProducts(q, { all, itemType: "tire" }).then((r) => setHits(r.slice(0, 8))),
      250,
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, all]);

  return (
    <section className="rounded-2xl border border-slate-300 bg-white p-3">
      <h2 className="font-bold">타이어</h2>
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
                  {h.reservedQty > 0 && <span className="font-semibold text-violet-700"> · 📌 예약 {h.reservedQty}본</span>}
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
  owner = false,
}: {
  onAdd: (s: { id: number; marsNo: string | null; name: string; price: number | null }) => void;
  /** 사장님이면 목록 아래에 「새 공임 만들기」 길을 보여준다 (관리 화면이 사장님 전용) */
  owner?: boolean;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Awaited<ReturnType<typeof findServices>>>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * ⭐ 검색창은 늘 보이되, 목록은 **검색칸을 눌렀을 때만** (사장님 2026-08-09 2차 지시
   *    — "자주쓰는 공임내역이 평소에는 펼쳐져 있지 말고 검색입력칸을 클릭할때").
   *    blur 를 150ms 늦추는 것은 목록 항목을 누르는 순간 목록이 먼저 사라지지 않게 하기 위함.
   */
  const [focused, setFocused] = useState(false);
  const showList = focused || q.trim() !== "";

  useEffect(() => {
    if (!showList) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void findServices(q).then(setHits), 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, showList]);

  const list = useMemo(() => hits.slice(0, 12), [hits]);

  return (
    <section className="rounded-2xl border border-slate-300 bg-white p-3">
      <h2 className="font-bold">공임·정비 추가</h2>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 250)}
        placeholder="얼라인먼트 · 펑크수리 · 배터리…"
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2"
      />
      {showList && (
        /*
         * 🔴 mousedown 에서 preventDefault (사장님 버그 제보 2026-08-09).
         *    항목을 누르는 순간 입력칸이 blur 되어 목록이 먼저 사라지고 클릭이
         *    허공에 떨어졌다 — 검색어가 비어 있을 때만 나는 버그라 놓치기 쉬웠다
         *    (검색어가 있으면 blur 후에도 목록이 남아 증상이 없다).
         *    preventDefault 로 포커스를 안 뺏기면 blur 자체가 안 일어난다.
         */
        <ul
          className="mt-2 max-h-72 space-y-1 overflow-y-auto"
          onMouseDown={(e) => e.preventDefault()}
        >
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
          {/* ⭐ 목록에 없으면 즉석에서 만든다 (사장님 요청 2026-08-31) — 새 탭, 만들면 여기 검색에 바로 뜬다 */}
          {owner && (
            <li>
              <a
                href="/settings/services?new=1"
                target="_blank"
                className="block rounded-lg border border-dashed border-slate-400 px-3 py-2 text-center text-sm font-medium text-slate-600 active:bg-slate-100"
              >
                + 새 공임·정비 만들기 (목록에 없을 때)
              </a>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

/**
 * ⭐ 정비에 쓴 부품 담기 (사장님 확인 2026-08-11 — "판매 등록에서 함께 담기").
 *    오일필터·엔진오일(통)·배터리 등을 검색해 담으면 0원 소모 줄이 되어
 *    재고만 차감된다(기본 0원). ⭐ 담은 뒤 금액을 쓰면 청구·MARS 에 들어간다 (2026-08-24).
 *    검색·목록 동작은 위 ServicePick 과 같은 규칙 (blur 250ms · mousedown 방어).
 */
function UsedPartsPick({ onAdd }: { onAdd: (p: ProductHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focused, setFocused] = useState(false);
  const showList = focused || q.trim() !== "";

  useEffect(() => {
    if (!showList || q.trim() === "") {
      setHits([]);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      // ⭐ 서버에서부터 부품만 (2026-08-14 검색 분리) — 타이어는 위의 타이어 검색으로
      () => void searchProducts(q, { itemType: "part" }).then((r) => setHits(r.slice(0, 10))),
      250,
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, showList]);

  const list = useMemo(() => hits.slice(0, 12), [hits]);

  return (
    <section className="rounded-2xl border border-slate-300 bg-white p-3">
      <h2 className="font-bold">
        쓴 부품 담기 <span className="text-sm font-normal text-slate-500">— 기본 0원 (재고만 차감) · 금액도 쓸 수 있음</span>
      </h2>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 250)}
        placeholder="오일필터 · MBA-039 · 배터리 · 엔진오일…"
        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2"
      />
      {showList && q.trim() !== "" && (
        <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto" onMouseDown={(e) => e.preventDefault()}>
          {list.map((p) => (
            <li key={p.productId}>
              <button
                type="button"
                onClick={() => onAdd(p)}
                className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left active:bg-slate-100"
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  {p.model}
                  {p.partNo && <span className="tabular ml-1 text-xs text-slate-400">{p.partNo}</span>}
                </span>
                <span className="tabular shrink-0 text-xs text-slate-500">
                  {p.stockTracked ? `재고 ${p.stockQty}개` : "재고 미등록"}
                  {p.reservedQty > 0 && <span className="font-semibold text-violet-700"> · 📌 {p.reservedQty}</span>}
                </span>
              </button>
            </li>
          ))}
          {list.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-400">
              부품을 못 찾았습니다 —{" "}
              {/*
                ⭐ 새 부품이면 여기서 바로 만들러 간다 (사장님 질문 2026-08-14).
                   <a> 를 쓴다: 판매 등록 중이라 새 창으로 열어 담던 내용을 지키게.
              */}
              <a
                href={`/settings/products?tab=new&type=part&q=${encodeURIComponent(q.trim())}`}
                target="_blank"
                rel="noreferrer"
                className="text-slate-600 underline underline-offset-2"
              >
                새 부품으로 등록
              </a>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
