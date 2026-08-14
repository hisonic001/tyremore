"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProduct } from "@/lib/stock";
import { searchProducts } from "@/lib/search-actions";
import { searchPartStock, type PartStockRow } from "@/lib/part-stock";
import type { ProductHit } from "@/lib/search";

const FIELD = "w-full rounded-xl border border-slate-300 px-4 py-3 text-lg outline-none focus:border-slate-900";

/**
 * ⭐ 부품 분류 — 재고 화면의 묶음이 되고, 부품몰 이관분과 같은 말을 쓴다.
 *    (사장님 질문 2026-08-14 — "새로운 부품이 생겼을때 어떻게 등록해야할지")
 */
const PART_CATEGORIES = [
  "배터리",
  "오일필터",
  "에어필터",
  "에어컨필터",
  "연료필터",
  "상용차필터",
  "브레이크패드",
  "오일·유류",
  "와이퍼",
  "기타",
];

export function NewProductForm({
  brands,
  initialPattern,
  initialType,
}: {
  brands: { code: string; nameKo: string }[];
  initialPattern: string;
  initialType?: "tire" | "part";
}) {
  const [itemType, setItemType] = useState<"tire" | "part">(initialType ?? "tire");

  return (
    <div className="mt-5">
      {/* ⭐ 유형부터 고른다 — 타이어와 부품은 필요한 값이 아주 다르다 */}
      <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
        {(["tire", "part"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setItemType(t)}
            className={`flex-1 rounded-lg py-2.5 text-center text-sm font-semibold ${
              itemType === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 active:bg-slate-200"
            }`}
          >
            {t === "tire" ? "타이어" : "부품 (배터리·필터·패드…)"}
          </button>
        ))}
      </div>

      {itemType === "tire" ? (
        <TireFields brands={brands} initialPattern={initialPattern} />
      ) : (
        <PartFields initialName={initialPattern} />
      )}
    </div>
  );
}

/* ============================================================
 * 부품 — 이름·분류·품번·적용차종·매입가
 * ========================================================== */
function PartFields({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initialName);
  const [category, setCategory] = useState("오일필터");
  const [partNo, setPartNo] = useState("");
  const [fitment, setFitment] = useState("");
  const [price, setPrice] = useState("");
  const [minQty, setMinQty] = useState("");

  /** 만들기 전에 먼저 찾아본다 — 부품이 갈라지면 재고가 두 곳으로 나뉜다 */
  const [similar, setSimilar] = useState<PartStockRow[]>([]);
  useEffect(() => {
    const term = `${partNo} ${name}`.trim();
    if (term.length < 2) {
      setSimilar([]);
      return;
    }
    const t = setTimeout(() => {
      void searchPartStock(partNo.trim() || name.trim()).then((r) => setSimilar(r.slice(0, 5)));
    }, 350);
    return () => clearTimeout(t);
  }, [name, partNo]);

  return (
    <div className="mt-4 space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">부품 이름</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="에너자이저 90R · 보쉬 에어컨필터"
          className={FIELD}
        />
        <p className="mt-1 text-xs text-slate-500">사장님이 부르는 이름 그대로. 검색에 이게 쓰입니다.</p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">분류</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={FIELD}>
          {PART_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">재고 화면에서 이 묶음으로 모여 보입니다.</p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">품번 (있으면)</label>
        <input
          value={partNo}
          onChange={(e) => setPartNo(e.target.value)}
          placeholder="26300-35505 · HK80L"
          className={FIELD}
        />
        <p className="mt-1 text-xs text-slate-500">
          같은 품번은 두 번 못 만듭니다 — 재고가 갈라지지 않게 막습니다.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">적용 차종</label>
        <input
          value={fitment}
          onChange={(e) => setFitment(e.target.value)}
          placeholder="아반떼 · 쏘나타 DN8 · 포터2"
          className={FIELD}
        />
        <p className="mt-1 text-xs text-slate-500">
          <strong>부품 검색의 전부입니다.</strong> 손님 차를 보고 찾을 때 이걸로 찾습니다 — 꼭 적으세요.
        </p>
      </div>

      {similar.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">비슷한 부품이 이미 있습니다</p>
          <p className="mt-0.5 text-xs text-amber-800">
            아래에 있는 것이면 새로 만들지 마세요 — 재고가 갈라집니다.
          </p>
          <ul className="mt-1.5 space-y-1">
            {similar.map((p) => (
              <li key={p.productId} className="rounded-lg bg-white px-2.5 py-1.5">
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="tabular text-xs text-slate-500">
                  {[p.partNo, p.qty > 0 ? `재고 ${p.qty}개` : null].filter(Boolean).join(" · ")}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-sm font-medium text-slate-700">매입가 (VAT 별도)</label>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
            placeholder="사 오는 값"
            inputMode="numeric"
            className={FIELD + " tabular"}
          />
          {price && <p className="tabular mt-1 text-sm text-slate-600">{Number(price).toLocaleString()}원</p>}
        </div>
        <div className="w-32">
          <label className="mb-1 block text-sm font-medium text-slate-700">기준 (선택)</label>
          <input
            value={minQty}
            onChange={(e) => setMinQty(e.target.value.replace(/\D/g, ""))}
            placeholder="재주문점"
            inputMode="numeric"
            className={FIELD + " tabular"}
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-slate-500">
        손님에게 받을 값은 안 넣습니다 — <strong>판매 등록할 때 그때그때 치시면 됩니다.</strong>
        기준을 정하면 재고가 그 이하일 때 「부족」이 뜹니다.
      </p>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>}

      <button
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await createProduct({
              itemType: "part",
              brandCode: "", // 부품은 타이어 브랜드를 안 붙인다
              pattern: name,
              width: null,
              aspectRatio: null,
              rimInch: null,
              category,
              partNo: partNo || null,
              fitment: fitment || null,
              purchasePrice: price ? Number(price) : null,
              minQty: minQty ? Number(minQty) : null,
            });
            if (!r.ok) setError(r.error);
            // 등록하면 바로 재고를 넣게 이어준다
            else router.push(`/stock/${r.productId}`);
          });
        }}
        className="w-full rounded-xl bg-slate-900 py-4 text-lg font-semibold text-white disabled:opacity-50"
      >
        {pending ? "등록 중…" : "등록하고 재고 넣기"}
      </button>
    </div>
  );
}

/* ============================================================
 * 타이어 — 브랜드·모델명·규격
 * ========================================================== */
function TireFields({
  brands,
  initialPattern,
}: {
  brands: { code: string; nameKo: string }[];
  initialPattern: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [brandCode, setBrandCode] = useState("MI"); // 미쉐린이 가맹 브랜드다
  const [pattern, setPattern] = useState(initialPattern);
  const [width, setWidth] = useState("");
  const [aspect, setAspect] = useState("");
  const [rim, setRim] = useState("");
  const [load, setLoad] = useState("");
  const [speed, setSpeed] = useState("");
  const [price, setPrice] = useState("");

  const spec = width && aspect && rim ? `${width}/${aspect}R${rim}` : null;

  /**
   * ⭐ 품목 정리 ③ (2026-08-05) — 규격을 다 치면 **같은 규격의 기존 상품**을 보여준다.
   *    중복의 뿌리가 「이미 있는데 또 만드는 것」이라, 만들기 전에 눈으로 확인시킨다.
   *    막지는 않는다 — 진짜 새 모델일 수 있다.
   */
  const [similar, setSimilar] = useState<ProductHit[]>([]);
  useEffect(() => {
    if (!width || !aspect || !rim) {
      setSimilar([]);
      return;
    }
    const t = setTimeout(() => {
      void searchProducts(`${width}${aspect}${rim}`, { all: true, brands: [brandCode], itemType: "tire" }).then((r) =>
        setSimilar(r.slice(0, 6)),
      );
    }, 350);
    return () => clearTimeout(t);
  }, [width, aspect, rim, brandCode]);

  return (
    <div className="mt-4 space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">브랜드</label>
        <select value={brandCode} onChange={(e) => setBrandCode(e.target.value)} className={FIELD}>
          {brands.map((b) => (
            <option key={b.code} value={b.code}>
              {b.nameKo}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">모델명</label>
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="PILOT SPORT 5"
          className={FIELD}
        />
        <p className="mt-1 text-xs text-slate-500">고객이 부르는 이름으로 넣으세요. 검색에 이게 쓰입니다.</p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">규격</label>
        <div className="flex items-center gap-2">
          <input value={width} onChange={(e) => setWidth(num(e.target.value, 3))} placeholder="225" inputMode="numeric" className={FIELD + " tabular text-center"} />
          <span className="text-xl text-slate-400">/</span>
          <input value={aspect} onChange={(e) => setAspect(num(e.target.value, 2))} placeholder="45" inputMode="numeric" className={FIELD + " tabular text-center"} />
          <span className="text-xl text-slate-400">R</span>
          <input value={rim} onChange={(e) => setRim(num(e.target.value, 2))} placeholder="17" inputMode="numeric" className={FIELD + " tabular text-center"} />
        </div>
        {spec && <p className="tabular mt-1 text-sm text-slate-600">→ {spec}</p>}
      </div>

      {similar.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">
            이 브랜드에 같은 규격 상품이 이미 {similar.length}개 있습니다
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            아래에 있는 것이면 새로 만들지 마세요 — 상품이 갈라지면 재고·이력이 나뉩니다.
          </p>
          <ul className="mt-1.5 space-y-1">
            {similar.map((p) => (
              <li key={p.productId} className="rounded-lg bg-white px-2.5 py-1.5">
                <div className="truncate text-sm font-medium">{p.model}</div>
                <div className="tabular text-xs text-slate-500">
                  {[p.cai, p.loadSpeed, p.stockQty > 0 ? `재고 ${p.stockQty}본` : null].filter(Boolean).join(" · ")}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-sm font-medium text-slate-700">하중지수</label>
          <input value={load} onChange={(e) => setLoad(e.target.value)} placeholder="94" className={FIELD + " tabular"} />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-sm font-medium text-slate-700">속도기호</label>
          <input value={speed} onChange={(e) => setSpeed(e.target.value.toUpperCase().slice(0, 2))} placeholder="Y" className={FIELD} />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">기표가 (정가)</label>
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
          placeholder="비워둬도 됩니다"
          inputMode="numeric"
          className={FIELD + " tabular"}
        />
        {price && <p className="tabular mt-1 text-sm text-slate-600">{Number(price).toLocaleString()}원</p>}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</p>}

      <button
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await createProduct({
              brandCode,
              pattern,
              width: width ? Number(width) : null,
              aspectRatio: aspect ? Number(aspect) : null,
              rimInch: rim ? Number(rim) : null,
              loadIndex: load || null,
              speedRating: speed || null,
              listPrice: price ? Number(price) : null,
            });
            if (!r.ok) setError(r.error);
            // 등록하면 바로 재고를 넣게 이어준다
            else router.push(`/stock/${r.productId}`);
          });
        }}
        className="w-full rounded-xl bg-slate-900 py-4 text-lg font-semibold text-white disabled:opacity-50"
      >
        {pending ? "등록 중…" : "등록하고 재고 넣기"}
      </button>
    </div>
  );
}

function num(v: string, len: number) {
  return v.replace(/\D/g, "").slice(0, len);
}
