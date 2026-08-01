"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Mode } from "@/lib/search";
import { SEASON_ORDER } from "@/lib/tire-attrs";

/** ⭐ 버튼 하나로 갈라진다 (사장님 요청 2026-08-01) */
export function ModeTabs({ mode, q }: { mode: Mode; q: string }) {
  const base = "flex-1 rounded-xl py-3 text-center text-lg font-semibold transition-colors";
  const on = "bg-slate-900 text-white";
  const off = "bg-white text-slate-500 border border-slate-300";
  return (
    <div className="flex gap-2">
      <Link href={`/?mode=customer&q=${encodeURIComponent(q)}`} className={`${base} ${mode === "customer" ? on : off}`}>
        고객 · 차량
      </Link>
      <Link href={`/?mode=product&q=${encodeURIComponent(q)}`} className={`${base} ${mode === "product" ? on : off}`}>
        타이어 · 재고
      </Link>
    </div>
  );
}

export interface Filter {
  brands: string[];
  seasons: string[];
  runflat: boolean;
  acoustic: boolean;
  suv: boolean;
  inStock: boolean;
}

const CHIP = "rounded-full border px-4 py-2 text-sm font-medium transition-colors";
const CHIP_ON = "border-slate-900 bg-slate-900 text-white";
const CHIP_OFF = "border-slate-300 bg-white text-slate-600";

/**
 * ⚠️ `useSearchParams()`를 쓰지 않는다.
 *    Suspense 경계를 요구해서 조건이 어긋나면 클라이언트 컴포넌트가 통째로 죽는다.
 *    필터가 눌리지 않는 사고로 이어진다. 서버가 넘겨준 값만으로 URL을 만든다.
 */
export function FilterPanel({
  brands,
  q,
  filter,
  count,
}: {
  brands: { code: string; name_ko: string; n: number }[];
  q: string;
  filter: Filter;
  count: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(count > 0);

  /** 현재 상태를 그대로 URL로 만든다 */
  function build(next: Partial<Filter>): string {
    const f = { ...filter, ...next };
    const p = new URLSearchParams();
    p.set("mode", "product");
    if (q) p.set("q", q);
    f.brands.forEach((b) => p.append("brand", b));
    f.seasons.forEach((s) => p.append("season", s));
    if (f.runflat) p.set("rf", "1");
    if (f.acoustic) p.set("ac", "1");
    if (f.suv) p.set("suv", "1");
    if (f.inStock) p.set("stock", "1");
    return `/?${p.toString()}`;
  }

  const toggleList = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const go = (next: Partial<Filter>) => router.push(build(next));

  return (
    <section className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`${CHIP} ${count > 0 ? CHIP_ON : CHIP_OFF}`}
        >
          필터 {count > 0 && `· ${count}`} {open ? "▲" : "▼"}
        </button>
        <button
          type="button"
          onClick={() => go({ inStock: !filter.inStock })}
          className={`${CHIP} ${filter.inStock ? CHIP_ON : CHIP_OFF}`}
        >
          재고 있는 것만
        </button>
        {count > 0 && (
          <Link
            href={`/?mode=product&q=${encodeURIComponent(q)}`}
            className="ml-auto text-sm text-slate-500 underline underline-offset-4"
          >
            초기화
          </Link>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">계절</h3>
            <div className="flex flex-wrap gap-2">
              {SEASON_ORDER.map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => go({ seasons: toggleList(filter.seasons, s) })}
                  className={`${CHIP} ${filter.seasons.includes(s) ? CHIP_ON : CHIP_OFF}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">세부사항</h3>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => go({ runflat: !filter.runflat })} className={`${CHIP} ${filter.runflat ? CHIP_ON : CHIP_OFF}`}>
                런플랫
              </button>
              <button type="button" onClick={() => go({ acoustic: !filter.acoustic })} className={`${CHIP} ${filter.acoustic ? CHIP_ON : CHIP_OFF}`}>
                흡음재
              </button>
              <button type="button" onClick={() => go({ suv: !filter.suv })} className={`${CHIP} ${filter.suv ? CHIP_ON : CHIP_OFF}`}>
                SUV
              </button>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">제조사</h3>
            <div className="flex flex-wrap gap-2">
              {brands.map((b) => (
                <button
                  type="button"
                  key={b.code}
                  onClick={() => go({ brands: toggleList(filter.brands, b.code) })}
                  className={`${CHIP} ${filter.brands.includes(b.code) ? CHIP_ON : CHIP_OFF}`}
                >
                  {b.name_ko}
                  <span className="ml-1.5 text-xs opacity-60">{b.n}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
