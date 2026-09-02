"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { TextareaField } from "@/components/ui/field";
import { writeWithForm } from "@/lib/blog-draft-actions";
import { getBlogJob, type AgentStatus, type BlogJobRow } from "@/lib/blog-job";
import { EMPTY_FORM, FINDINGS, formHasMaterial, REASONS, WHYS, type BlogForm } from "@/lib/blog-form";
import type { BlogCandidate } from "@/lib/blog-draft";

/** 누르는 칩 — 장갑 낀 손도 눌리게 44px 이상 (design-refresh 규칙) */
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
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
  hint: string;
  options: readonly string[];
  picked: string[];
  toggle: (v: string) => void;
}) {
  return (
    <section className="mt-5">
      <p className="font-semibold">{title}</p>
      <p className="mt-0.5 text-[13px] leading-snug text-slate-500">{hint}</p>
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

/** 숫자 한 칸 — 넣으면 글이 좋아지고 안 넣어도 된다 */
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

export function WriteUI({ sales, agent }: { sales: BlogCandidate[]; agent: AgentStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sale, setSale] = useState<BlogCandidate | null>(null);
  const [f, setF] = useState<BlogForm>(EMPTY_FORM);
  const [job, setJob] = useState<BlogJobRow | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  const toggle = (key: "reasons" | "findings" | "whys") => (v: string) =>
    setF((p) => ({ ...p, [key]: p[key].includes(v) ? p[key].filter((x) => x !== v) : [...p[key], v] }));
  const set = (k: keyof BlogForm) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const ready = formHasMaterial(f);
  const busy = job !== null && (job.status === "대기" || job.status === "실행중");

  function submit() {
    if (!sale) return;
    start(async () => {
      setMsg(null);
      const r = await writeWithForm(sale.quoteId, f);
      if (!r.ok) {
        setMsg({ tone: "error", text: r.error });
        return;
      }
      const next = r.jobId ? await getBlogJob(r.jobId) : null;
      setJob(next);
      setMsg({ tone: "info", text: "매장 PC 가 원고를 만들고 있습니다 (1~3분)" });
      // 진행은 블로그 목록 화면이 보여준다 — 여기서 또 폴링하지 않는다 (질의 아끼기)
      setTimeout(() => router.push("/marketing/blog"), 1200);
    });
  }

  /* ---------- 1단계: 시공 고르기 ---------- */
  if (!sale) {
    return (
      <div className="mt-4">
        <p className="text-sm font-semibold text-slate-700">어느 시공으로 쓸까요?</p>
        <ul className="mt-2 space-y-2">
          {sales.map((s) => (
            <li key={s.quoteId}>
              <button
                type="button"
                onClick={() => setSale(s)}
                className="flex w-full items-start gap-3 rounded-card border border-slate-200 bg-white p-4 text-left active:bg-slate-50 lg:hover:bg-slate-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-snug">{s.car}</span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-slate-500">
                    {s.tires} {s.qty}본
                    {s.mileage ? ` · ${s.mileage.toLocaleString("ko-KR")}km` : ""}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-400">
                    {s.workDate} · {s.quoteNo}
                  </span>
                </span>
                {s.hasDraft && <StatusPill tone="neutral">원고 있음</StatusPill>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  /* ---------- 2단계: 후기 채우기 ---------- */
  return (
    <div className="mt-4">
      <div className="flex items-start justify-between gap-2 rounded-card bg-slate-50 p-3">
        <div className="min-w-0">
          <p className="font-semibold leading-snug">{sale.car}</p>
          <p className="text-[13px] leading-snug text-slate-500">
            {sale.tires} {sale.qty}본
            {sale.mileage ? ` · ${sale.mileage.toLocaleString("ko-KR")}km` : ""}
          </p>
        </div>
        <Button variant="ghost" onClick={() => setSale(null)}>
          바꾸기
        </Button>
      </div>

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

      <Group
        title="왜 이 제품을 권하셨나요?"
        hint=""
        options={WHYS}
        picked={f.whys}
        toggle={toggle("whys")}
      />

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

      {!agent.alive && (
        <Notice tone="warn">
          매장 PC 가 꺼져 있습니다 — 글은 그 PC 에서 만들어집니다. 켜신 뒤 눌러 주세요.
        </Notice>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <div className="sticky bottom-20 mt-6 xl:bottom-4">
        <Button
          className="w-full"
          pending={pending || busy}
          disabled={!ready || !agent.alive}
          onClick={submit}
        >
          {ready ? "원고 만들기" : "위에서 하나만 눌러 주세요"}
        </Button>
      </div>
    </div>
  );
}
