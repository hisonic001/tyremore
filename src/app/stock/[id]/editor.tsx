"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDisplayName, setProductActive } from "@/lib/catalog";

/**
 * 🔴 수량·DOT 를 여기서 고치던 화면(DotRow · NewDotRow)은 걷어냈다 (사장님 지시 2026-08-03).
 *    "재고를 엑셀로 다운로드 & 업로드 하는 기능으로 수정."
 *    한 줄씩 ± 로 맞추는 대신 /stock 에서 엑셀로 한꺼번에 고친다.
 *    재고를 실제로 움직이는 곳은 이제 셋뿐이다 — 판매 등록 · 매입 입고 · 재고 엑셀.
 */

/**
 * 주문 사이트 표기 — 눌러서 복사한다.
 * 미쉐린 주문 화면과 나란히 놓고 대조하는 것을 전제로 만든 줄이다.
 */
export function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => {},
        );
      }}
      className="mt-2 flex w-full items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-left active:bg-slate-100"
    >
      <span className="shrink-0 text-xs text-slate-400">{label}</span>
      <span className="tabular min-w-0 flex-1 truncate text-sm text-slate-700">{value}</span>
      <span className="shrink-0 text-xs text-slate-400">{copied ? "복사됨 ✓" : "복사"}</span>
    </button>
  );
}

/**
 * ⭐ 표시 이름 직접 고치기 (2026-08-01)
 * MARS 원문에 `PILSP3` 같은 축약이 섞여 있어 자동으로는 못 편다.
 * 제목을 눌러 바로 고친다. MARS 원본은 그대로 남는다.
 */
export function NameEditor({
  productId,
  model,
  autoModel,
  isCustom,
}: {
  productId: number;
  model: string;
  autoModel: string;
  isCustom: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(model);

  const save = (v: string | null) =>
    start(async () => {
      await setDisplayName(productId, v);
      setEditing(false);
      router.refresh();
    });

  if (!editing) {
    return (
      <div className="mt-1.5">
        <button type="button" onClick={() => { setValue(model); setEditing(true); }} className="text-left">
          <h1 className="text-2xl font-bold leading-snug">
            {model}
            <span className="ml-2 align-middle text-sm font-normal text-slate-400">✏️</span>
          </h1>
        </button>
        {isCustom && <p className="text-xs text-slate-400">직접 정한 이름 · 원래 «{autoModel}»</p>}
      </div>
    );
  }

  return (
    <div className="mt-1.5">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        className="w-full rounded-xl border-2 border-slate-900 px-3 py-2 text-xl font-bold outline-none"
      />
      <p className="mt-1 text-xs text-slate-500">
        화면에만 쓰입니다. MARS 입력용 원본은 그대로 유지됩니다.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => save(value)}
          className="rounded-lg bg-slate-900 px-5 py-2 font-medium text-white disabled:opacity-50"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-4 py-2 text-slate-500">
          취소
        </button>
        {isCustom && (
          <button
            type="button"
            disabled={pending}
            onClick={() => save(null)}
            className="ml-auto rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600"
          >
            자동 이름으로 되돌리기
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 단종·미취급 상품을 검색 결과에서 치운다 (2026-08-01).
 * 지우지 않으므로 기표가·규격이 그대로 남고, 다시 받게 되면 되살리면 된다.
 */
export function HideToggle({
  productId,
  isActive,
  hasStock,
}: {
  productId: number;
  isActive: boolean;
  hasStock: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (!isActive) {
    return (
      <div className="mt-6 rounded-xl border border-slate-300 bg-slate-100 p-4">
        <p className="font-medium text-slate-700">이 상품은 검색에서 숨겨져 있습니다</p>
        <p className="mt-1 text-sm text-slate-500">
          기표가·규격은 그대로 남아 있습니다. 되살리면 바로 상담에 쓸 수 있습니다.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await setProductActive(productId, true);
              router.refresh();
            })
          }
          className="mt-3 w-full rounded-xl bg-slate-900 py-3 font-medium text-white disabled:opacity-50"
        >
          {pending ? "처리 중…" : "되살리기"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        disabled={pending || hasStock}
        onClick={() =>
          start(async () => {
            await setProductActive(productId, false);
            router.refresh();
          })
        }
        className="w-full rounded-xl border border-slate-300 py-3 text-slate-600 disabled:opacity-40"
      >
        {hasStock ? "재고가 있어 숨길 수 없습니다" : "검색에서 숨기기 (단종·미취급)"}
      </button>
    </div>
  );
}
