"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import { BookOpen, Camera, CloudSun, Wrench } from "lucide-react";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { writeTopic } from "@/lib/blog-topic-actions";
import type { Topic } from "@/lib/blog-topics-core";
import type { AgentStatus } from "@/lib/blog-job";

const ICON = {
  밀린사진: Camera,
  안쓴시공: Wrench,
  정보성: BookOpen,
  계절: CloudSun,
} as const;

export function TopicsUI({ topics, agent }: { topics: Topic[]; agent: AgentStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  /** 정보성·계절 글은 시공이 없다 — 바로 만든다 */
  function make(t: Topic) {
    setBusy(t.key);
    start(async () => {
      setMsg(null);
      const r = await writeTopic({
        title: t.title,
        category: t.category,
        material: t.material ?? "",
      });
      setBusy(null);
      if (!r.ok) return setMsg({ tone: "error", text: r.error });
      setMsg({ tone: "info", text: "매장 PC 가 글을 쓰고 있습니다 (1~3분)" });
      setTimeout(() => router.push("/marketing/blog"), 1400);
    });
  }

  return (
    <div className="mt-4">
      <StatusPill tone={agent.alive ? "success" : "neutral"}>
        {agent.alive ? `매장 PC 켜짐${agent.host ? ` (${agent.host})` : ""}` : "매장 PC 꺼짐"}
      </StatusPill>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <ul className="mt-3 space-y-2">
        {topics.map((t) => {
          const Icon = ICON[t.kind];
          const direct = t.kind === "정보성" || t.kind === "계절";
          return (
            <li key={t.key} className="rounded-card border border-slate-200 bg-white p-4">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold leading-snug">{t.title}</span>
                    <StatusPill tone={t.kind === "밀린사진" ? "accent" : "info"}>{t.category}</StatusPill>
                  </div>
                  <p className="mt-1 text-[13px] leading-snug text-slate-500">{t.why}</p>
                  {t.material && (
                    <pre className="mt-1.5 whitespace-pre-wrap rounded-control bg-slate-50 p-2 font-sans text-[12px] leading-snug text-slate-600">
                      {t.material}
                    </pre>
                  )}
                </div>
              </div>

              <div className="mt-3 flex justify-end">
                {direct ? (
                  <Button
                    variant="secondary"
                    pending={pending && busy === t.key}
                    disabled={!agent.alive}
                    onClick={() => make(t)}
                  >
                    이걸로 원고 만들기
                  </Button>
                ) : (
                  <Link
                    href={t.href}
                    className="rounded-control border border-slate-300 px-3.5 py-2.5 text-sm font-medium text-slate-900 active:bg-slate-100"
                  >
                    이걸로 쓰러 가기
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-6 text-xs leading-snug text-slate-400">
        비중은 시공 사례 6 : 정보성 3 : 공지 1, 주 1~2편이 알맞습니다. 「차종별 순정 제원」은
        시공이 없어도 쓸 수 있어 비수기의 글감 창고입니다.
      </p>
    </div>
  );
}
