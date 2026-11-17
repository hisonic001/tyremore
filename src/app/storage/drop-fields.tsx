"use client";

import { ChipButton } from "@/components/ui/chip";
import type { StorageDropInput } from "@/lib/tire-storage-pure";

/**
 * ⭐ 「맡긴 타이어」 한 세트 입력 — 등록·실사·고치기·판매 화면이 같이 쓴다 (D-42)
 *   종류(스노/일반) 버튼 + 브랜드 · 규격 · 본수 · DOT · 메모.
 */
const INPUT =
  "w-full rounded-control border border-slate-300 bg-white px-3 py-2.5 text-base placeholder:text-slate-400 focus:border-brand-500 focus:outline-none";

export function emptyDrop(kind: StorageDropInput["kind"] = null, size = ""): StorageDropInput {
  return { kind, brand: "", size, qty: 4, dot: "", memo: "" };
}

export function DropFields({
  value,
  onChange,
  disabled,
}: {
  value: StorageDropInput;
  onChange: (v: StorageDropInput) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<StorageDropInput>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <ChipButton active={value.kind === "스노"} onClick={() => set({ kind: "스노" })} disabled={disabled}>
          ❄️ 스노
        </ChipButton>
        <ChipButton active={value.kind === "일반"} onClick={() => set({ kind: "일반" })} disabled={disabled}>
          ☀️ 일반
        </ChipButton>
        <label className="ml-auto flex items-center gap-1.5 text-sm text-slate-600">
          본수
          <select
            value={value.qty}
            onChange={(e) => set({ qty: Number(e.target.value) })}
            disabled={disabled}
            className="tabular rounded-control border border-slate-300 bg-white px-2 py-2.5 text-base"
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n}본
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          value={value.brand ?? ""}
          onChange={(e) => set({ brand: e.target.value })}
          placeholder="브랜드 (예: 미쉐린)"
          maxLength={40}
          disabled={disabled}
          className={INPUT}
        />
        <input
          value={value.size ?? ""}
          onChange={(e) => set({ size: e.target.value })}
          placeholder="규격 (예: 225/45R18)"
          maxLength={60}
          disabled={disabled}
          className={`${INPUT} tabular`}
        />
        <input
          value={value.dot ?? ""}
          onChange={(e) => set({ dot: e.target.value })}
          placeholder="DOT (선택)"
          maxLength={40}
          disabled={disabled}
          className={`${INPUT} tabular`}
        />
        <input
          value={value.memo ?? ""}
          onChange={(e) => set({ memo: e.target.value })}
          placeholder="메모 (휠 포함 등)"
          maxLength={300}
          disabled={disabled}
          className={INPUT}
        />
      </div>
    </div>
  );
}
