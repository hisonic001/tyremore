"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProduct } from "@/lib/stock";

const FIELD = "w-full rounded-xl border border-slate-300 px-4 py-3 text-lg outline-none focus:border-slate-900";

export function NewProductForm({
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

  return (
    <div className="mt-5 space-y-4">
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
