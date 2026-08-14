"use client";

import { useEffect, useRef } from "react";
import type { Mode } from "@/lib/search";
import type { Filter } from "./search-ui";

/** 검색 폼 id — 폼 밖에 있는 「조회」 버튼이 이 값으로 연결된다 */
export const SEARCH_FORM_ID = "tm-search";

/**
 * ⭐ 화면을 열면 커서가 검색칸에서 깜빡인다 (사장님 요청 2026-08-01)
 *
 * `autoFocus` 속성만으로는 부족하다. 검색 결과가 바뀔 때마다 서버 컴포넌트가
 * 다시 그려지는데, 그때는 브라우저가 자동 포커스를 다시 걸어주지 않는다.
 * 그래서 직접 건다 — 검색하고 나서도 바로 다음 검색어를 칠 수 있어야 한다.
 *
 * ⚠️ 폰에서는 포커스만 준다. 키보드를 강제로 올리면 화면 절반이 가려져
 *    결과를 못 보는 일이 생긴다.
 */
export function SearchBox({ mode, q, filter }: { mode: Mode; q: string; filter: Filter }) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    /**
     * ⚠️ **검색한 뒤에는 커서를 주지 않는다** (2026-08-01 사장님 지적).
     *    폰에서 포커스가 잡히면 글자판이 올라와 화면 절반을 가린다.
     *    결과를 보려고 검색했는데 결과가 안 보이면 아무 소용이 없다.
     *
     * ⚠️ 좁은 화면(폰)에서는 처음에도 자동 포커스를 걸지 않는다.
     *    PC·태블릿에서는 바로 칠 수 있는 편이 빠르다.
     */
    if (q.trim()) return;
    if (window.matchMedia("(max-width: 640px)").matches) return;

    el.focus({ preventScroll: true });
    const n = el.value.length;
    try {
      el.setSelectionRange(n, n);
    } catch {
      /* 일부 입력 타입은 지원하지 않는다 */
    }
  }, [q, mode]);

  return (
    <form id={SEARCH_FORM_ID} action="/" method="get" className="mt-3">
      <input type="hidden" name="mode" value={mode} />
      {mode === "product" && (
        <>
          {filter.brands.map((b) => (
            <input key={b} type="hidden" name="brand" value={b} />
          ))}
          {filter.seasons.map((s) => (
            <input key={s} type="hidden" name="season" value={s} />
          ))}
          {filter.runflat && <input type="hidden" name="rf" value="1" />}
          {filter.acoustic && <input type="hidden" name="ac" value="1" />}
          {filter.suv && <input type="hidden" name="suv" value="1" />}
          {filter.inStock && <input type="hidden" name="stock" value="1" />}
          {filter.parts && <input type="hidden" name="parts" value="1" />}
        </>
      )}
      <input
        ref={ref}
        name="q"
        defaultValue={q}
        autoComplete="off"
        placeholder={
          mode === "customer"
            ? "차량번호 · 전화 · 이름"
            : filter.parts
              ? "차종 · 품번 · 배터리 품명 (DF80L)"
              : "규격 2254517 · 모델명 · CAI"
        }
        aria-label="검색"
        className="w-full rounded-2xl border-2 border-slate-300 bg-white px-5 py-4 text-2xl
                   shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-900"
      />
    </form>
  );
}

/** 「조회」 버튼 — 엔터를 안 쳐도 눌러서 검색한다 */
export function SearchButton() {
  return (
    <button
      type="submit"
      form={SEARCH_FORM_ID}
      className="rounded-full bg-slate-900 px-6 py-2 text-sm font-semibold text-white active:bg-slate-700"
    >
      조회
    </button>
  );
}
