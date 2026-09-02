"use client";

import type { ReactNode } from "react";
import { TextareaField } from "@/components/ui/field";
import { FINDINGS, REASONS, WHYS, type BlogForm } from "@/lib/blog-form";

/**
 * 작업 후기 폼 부품 — 「원고 만들기」와 「사진으로 만들기」가 같이 쓴다 (2026-09-02).
 * 🔴 빈 칸이 아니라 **칩**이다. 결제 끝나고 기름 묻은 손으로 채우실 수 있어야 한다.
 */

/** 장갑 낀 손도 눌리게 44px 이상 (design-refresh 규칙) */
export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 rounded-full px-3.5 text-[13px] font-medium transition-colors ${
        on
          ? "bg-slate-900 text-white"
          : "border border-slate-300 bg-white text-slate-600 active:bg-slate-100 lg:hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function Group({
  title, hint, options, picked, toggle,
}: {
  title: string;
  hint?: string;
  options: readonly string[];
  picked: string[];
  toggle: (v: string) => void;
}) {
  return (
    <section className="mt-5">
      <p className="font-semibold">{title}</p>
      {hint && <p className="mt-0.5 text-[13px] leading-snug text-slate-500">{hint}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Chip key={o} on={picked.includes(o)} onClick={() => toggle(o)}>
            {o}
          </Chip>
        ))}
      </div>
    </section>
  );
}

function Num({
  label, unit, value, onChange, hint,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-[13px] text-slate-600">{label}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hint}
        className="min-h-11 w-24 rounded-control border border-slate-300 px-3 text-[15px]"
      />
      <span className="text-[13px] text-slate-500">{unit}</span>
    </label>
  );
}

export function FormFields({ f, setF }: { f: BlogForm; setF: (fn: (p: BlogForm) => BlogForm) => void }) {
  const toggle = (key: "reasons" | "findings" | "whys") => (v: string) =>
    setF((p) => ({ ...p, [key]: p[key].includes(v) ? p[key].filter((x) => x !== v) : [...p[key], v] }));
  const set = (k: keyof BlogForm) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <>
      <Group
        title="왜 오셨나요?"
        hint="누르기만 하면 됩니다. 여러 개 골라도 됩니다."
        options={REASONS}
        picked={f.reasons}
        toggle={toggle("reasons")}
      />
      <TextareaField
        label="덧붙일 말 (선택)"
        rows={2}
        value={f.reasonNote ?? ""}
        onChange={(e) => set("reasonNote")(e.target.value)}
        placeholder="예: 이번이 두 번째 방문이었습니다"
      />

      <Group
        title="점검해 보니 어땠나요?"
        hint="이게 글의 핵심입니다 — 여기가 비면 뻔한 글이 됩니다."
        options={FINDINGS}
        picked={f.findings}
        toggle={toggle("findings")}
      />
      <TextareaField
        label="덧붙일 말 (선택)"
        rows={2}
        value={f.findingNote ?? ""}
        onChange={(e) => set("findingNote")(e.target.value)}
        placeholder="예: 전륜 안쪽만 유독 닳아 있었습니다"
      />

      <Group title="왜 이 제품을 권하셨나요?" options={WHYS} picked={f.whys} toggle={toggle("whys")} />

      <section className="mt-5 rounded-card border border-slate-200 p-3">
        <p className="font-semibold">측정한 값 (선택)</p>
        <p className="mt-0.5 text-[13px] leading-snug text-slate-500">
          숫자가 들어가면 글이 눈에 띄게 믿음직해집니다. 아는 것만 넣으세요.
        </p>
        <div className="mt-2 space-y-2">
          <Num label="남은 홈" unit="mm" value={f.treadMm ?? ""} onChange={set("treadMm")} hint="3.5" />
          <Num label="휠 너트 조임" unit="Nm" value={f.torqueNm ?? ""} onChange={set("torqueNm")} hint="175" />
          <Num label="공기압" unit="psi" value={f.psi ?? ""} onChange={set("psi")} hint="42" />
          <Num label="밸런스 웨이트" unit="g" value={f.balanceG ?? ""} onChange={set("balanceG")} hint="40" />
          <Num label="배터리" unit="CCA" value={f.batteryCca ?? ""} onChange={set("batteryCca")} hint="500" />
        </div>
        <TextareaField
          label="얼라인먼트 수치 (선택)"
          rows={2}
          value={f.alignNote ?? ""}
          onChange={(e) => set("alignNote")(e.target.value)}
          placeholder="예: 전륜 토우·캠버가 기준치를 벗어나 안쪽으로 틀어져 있었음"
        />
      </section>

      <TextareaField
        label="블로그에 꼭 넣을 말 (선택)"
        rows={2}
        value={f.extra ?? ""}
        onChange={(e) => set("extra")(e.target.value)}
        placeholder="예: 여행 중 오신 분이라 언제든 들르시라고 써 주세요"
      />
    </>
  );
}
