"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { writeWithForm } from "@/lib/blog-draft-actions";
import { getBlogJob, type AgentStatus, type BlogJobRow } from "@/lib/blog-job";
import { EMPTY_FORM, formHasMaterial, type BlogForm } from "@/lib/blog-form";
import { FormFields } from "../form-fields";
import type { BlogCandidate } from "@/lib/blog-draft";

export function WriteUI({ sales, agent }: { sales: BlogCandidate[]; agent: AgentStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sale, setSale] = useState<BlogCandidate | null>(null);
  const [f, setF] = useState<BlogForm>(EMPTY_FORM);
  const [job, setJob] = useState<BlogJobRow | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

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

      <FormFields f={f} setF={setF} />

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
