"use client";

import { useState, type ReactNode } from "react";
import { ChipButton } from "@/components/ui/chip";
import {
  composeSize,
  joinBrands,
  parseSizeParts,
  SIZE_ASPECTS,
  SIZE_RIMS,
  SIZE_WIDTHS,
  splitBrands,
  STORAGE_BRANDS,
  type SizeParts,
  type StorageDropInput,
} from "@/lib/tire-storage-pure";

/**
 * ⭐ 「맡긴 타이어」 한 세트 입력 — 등록·실사·고치기·판매 화면이 같이 쓴다 (D-42)
 *
 *   🔴 **치지 말고 고른다** (사장님 2026-11-17 — "일일이 미쉐린·한국을 쓰고 규격도 써야 해서 실사가 힘들다").
 *     종류: 버튼 · 브랜드: 버튼(섞인 세트는 여러 개) · 규격: 「이 차 규격」 바로 고르기 + 폭/편평비/인치 펼쳐 고르기
 *     · 본수: 펼쳐 고르기. 앞뒤 다른 규격처럼 칸 셋으로 안 되는 것만 「직접 입력」. DOT·메모는 「더보기」.
 */
const INPUT =
  "w-full rounded-control border border-slate-300 bg-white px-3 py-2.5 text-base placeholder:text-slate-400 focus:border-brand-500 focus:outline-none";
const SELECT = "tabular min-h-11 rounded-control border border-slate-300 bg-white px-2 text-base";
const MAIN_BRANDS = 6; // 버튼으로 늘 보이는 수 — 나머지는 「다른 브랜드」
const KNOWN = STORAGE_BRANDS as readonly string[];

export function emptyDrop(kind: StorageDropInput["kind"] = null, size = ""): StorageDropInput {
  return { kind, brand: "", size, qty: 4, dot: "", memo: "" };
}

function SmallChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 rounded-full px-3 text-sm font-medium transition-colors ${
        active ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700 active:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

export function DropFields({
  value,
  onChange,
  disabled,
  sizeHints = [],
}: {
  value: StorageDropInput;
  onChange: (v: StorageDropInput) => void;
  disabled?: boolean;
  /** 「이 차 규격」 바로 고르기 — 지난번 끼운 규격 · 오늘 판 타이어 · 메모에서 읽은 규격 */
  sizeHints?: string[];
}) {
  const set = (patch: Partial<StorageDropInput>) => onChange({ ...value, ...patch });
  const brands = splitBrands(value.brand);
  const extraBrand = brands.filter((b) => !KNOWN.includes(b));
  const [moreBrands, setMoreBrands] = useState(brands.some((b) => KNOWN.indexOf(b) >= MAIN_BRANDS) || extraBrand.length > 0);
  const parts = parseSizeParts(value.size);
  const [freeSize, setFreeSize] = useState(!!value.size && !parts);
  const [more, setMore] = useState(!!(value.dot || value.memo));
  const [draftParts, setDraftParts] = useState<Partial<SizeParts>>(parts ?? {});
  const p: Partial<SizeParts> = parts ?? draftParts;

  const toggleBrand = (b: string) => set({ brand: joinBrands(brands.includes(b) ? brands.filter((x) => x !== b) : [...brands, b]) });
  const setPart = (patch: Partial<SizeParts>) => {
    const next = { ...p, ...patch };
    setDraftParts(next);
    set({ size: next.w && next.r && next.a !== undefined ? composeSize(next as SizeParts) : "" });
  };

  return (
    <fieldset disabled={disabled} className="space-y-3">
      {/* 종류 · 본수 */}
      <div className="flex flex-wrap items-center gap-2">
        <ChipButton active={value.kind === "스노"} onClick={() => set({ kind: "스노" })}>
          ❄️ 스노
        </ChipButton>
        <ChipButton active={value.kind === "일반"} onClick={() => set({ kind: "일반" })}>
          ☀️ 일반
        </ChipButton>
        <select aria-label="본수" value={value.qty} onChange={(e) => set({ qty: Number(e.target.value) })} className={`${SELECT} ml-auto`}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <option key={n} value={n}>
              {n}본
            </option>
          ))}
        </select>
      </div>

      {/* 브랜드 — 여러 개 고를 수 있다 */}
      <div>
        <p className="mb-1 text-[13px] font-medium text-slate-600">
          브랜드 <span className="font-normal text-slate-400">· 섞였으면 여러 개</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {STORAGE_BRANDS.slice(0, moreBrands ? STORAGE_BRANDS.length : MAIN_BRANDS).map((b) => (
            <SmallChip key={b} active={brands.includes(b)} onClick={() => toggleBrand(b)}>
              {b}
            </SmallChip>
          ))}
          {!moreBrands && (
            <SmallChip active={false} onClick={() => setMoreBrands(true)}>
              다른 브랜드 ▾
            </SmallChip>
          )}
        </div>
        {moreBrands && (
          <input
            value={extraBrand.join(",")}
            onChange={(e) => set({ brand: joinBrands([...brands.filter((b) => KNOWN.includes(b)), ...splitBrands(e.target.value)]) })}
            placeholder="목록에 없는 브랜드만 적기 (선택)"
            maxLength={40}
            className={`${INPUT} mt-1.5`}
          />
        )}
      </div>

      {/* 규격 — 바로 고르기 + 펼쳐 고르기 */}
      <div>
        <p className="mb-1 text-[13px] font-medium text-slate-600">규격</p>
        {sizeHints.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {sizeHints.map((h) => (
              <SmallChip
                key={h}
                active={value.size === h}
                onClick={() => {
                  setFreeSize(false);
                  setDraftParts(parseSizeParts(h) ?? {});
                  set({ size: value.size === h ? "" : h });
                }}
              >
                <span className="tabular">{h}</span>
              </SmallChip>
            ))}
          </div>
        )}
        {freeSize ? (
          <input
            value={value.size ?? ""}
            onChange={(e) => set({ size: e.target.value })}
            placeholder="예: 245/40R20 앞 + 275/35R20 뒤"
            maxLength={60}
            className={`${INPUT} tabular`}
          />
        ) : (
          <div className="flex items-center gap-1">
            <select aria-label="폭" value={p.w ?? ""} onChange={(e) => setPart({ w: Number(e.target.value) || undefined })} className={SELECT}>
              <option value="">폭</option>
              {SIZE_WIDTHS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
            <span className="text-slate-400">/</span>
            <select
              aria-label="편평비"
              value={p.a === null ? "none" : (p.a ?? "")}
              onChange={(e) => setPart({ a: e.target.value === "none" ? null : Number(e.target.value) || undefined })}
              className={SELECT}
            >
              <option value="">편평비</option>
              {SIZE_ASPECTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
              <option value="none">없음(밴)</option>
            </select>
            <span className="text-slate-400">R</span>
            <select aria-label="인치" value={p.r ?? ""} onChange={(e) => setPart({ r: Number(e.target.value) || undefined })} className={SELECT}>
              <option value="">인치</option>
              {SIZE_RIMS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        )}
        <button type="button" onClick={() => setFreeSize((f) => !f)} className="mt-1 text-xs text-slate-500 underline underline-offset-2">
          {freeSize ? "펼쳐서 고르기" : "앞뒤 규격이 다르면 — 직접 입력"}
        </button>
      </div>

      {/* DOT · 메모 — 대부분 안 쓴다 */}
      {more ? (
        <div className="grid grid-cols-2 gap-2">
          <input value={value.dot ?? ""} onChange={(e) => set({ dot: e.target.value })} placeholder="DOT (선택)" maxLength={40} className={`${INPUT} tabular`} />
          <input value={value.memo ?? ""} onChange={(e) => set({ memo: e.target.value })} placeholder="메모 (휠 포함 등)" maxLength={300} className={INPUT} />
        </div>
      ) : (
        <button type="button" onClick={() => setMore(true)} className="text-xs text-slate-500 underline underline-offset-2">
          + DOT · 메모 (선택)
        </button>
      )}
    </fieldset>
  );
}
