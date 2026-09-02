"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { makeTodayDrafts } from "@/lib/blog-draft-actions";
import { cancelBlogJob, getBlogJob, type AgentStatus, type BlogJobRow } from "@/lib/blog-job";

/**
 * 「오늘 원고 만들기」 — 버튼은 **주문만** 남기고, 글은 매장 PC 가 만든다.
 *
 * 🔴 진행 로그를 보여준다 (MARS 화면과 반대 결정). MARS 는 70분짜리라 숨겼지만
 *    원고는 1~3분이고, 그 사이 화면이 멈춘 것처럼 보이면 버튼을 또 누르시게 된다.
 */
export function MakeTodayButton({
  agent,
  job: initialJob,
}: {
  agent: AgentStatus;
  job: BlogJobRow | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [job, setJob] = useState<BlogJobRow | null>(initialJob);
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  const busy = job !== null && (job.status === "대기" || job.status === "실행중");

  /**
   * 🔴 돌고 있을 때만 3초마다 확인한다. 앞선 확인이 끝나기 전에는 다음 것을 쏘지 않고,
   *    탭이 안 보이면 쉰다 (2026-08-07 풀러 마비 사건의 교훈 — 겹쳐 쏘면 좀비 질의가 쌓인다).
   */
  const inflight = useRef(false);
  const jobId = job?.id ?? null;
  useEffect(() => {
    if (!busy || jobId === null) return;
    const t = setInterval(() => {
      if (document.hidden || inflight.current) return;
      inflight.current = true;
      void getBlogJob(jobId)
        .then((next) => {
          if (!next) return;
          setJob(next);
          if (next.status === "완료") {
            setMsg({ tone: "success", text: `원고 ${next.draftIds?.length ?? 0}건이 나왔습니다.` });
            router.refresh();
          } else if (next.status === "실패") {
            setMsg({ tone: "error", text: next.error ?? "원고를 만들지 못했습니다" });
          }
        })
        .finally(() => {
          inflight.current = false;
        });
    }, 3000);
    return () => clearInterval(t);
  }, [busy, jobId, router]);

  function order() {
    start(async () => {
      setMsg(null);
      const r = await makeTodayDrafts();
      if (!r.ok) {
        setMsg({ tone: "error", text: r.error });
        return;
      }
      if (r.existing) setMsg({ tone: "info", text: "이미 만드는 중입니다 — 곧 끝납니다." });
      setJob(r.jobId ? await getBlogJob(r.jobId) : null);
    });
  }

  function stop() {
    const id = job?.id;
    if (id === undefined) return;
    start(async () => {
      const r = await cancelBlogJob(id);
      if (!r.ok) {
        setMsg({ tone: "error", text: r.error });
        return;
      }
      setJob(await getBlogJob(id));
    });
  }

  // 로그는 꼬리만 — 화면이 길어지면 사장님이 버튼을 못 찾는다
  const tail = (job?.log ?? "").split("\n").filter(Boolean).slice(-8);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <StatusPill tone={agent.alive ? "success" : "neutral"}>
          {agent.alive ? `매장 PC 켜짐${agent.host ? ` (${agent.host})` : ""}` : "매장 PC 꺼짐"}
        </StatusPill>
        {busy ? (
          <Button variant="secondary" pending={pending} onClick={stop}>
            중단
          </Button>
        ) : (
          <Button variant="secondary" pending={pending} onClick={order}>
            오늘 원고 만들기
          </Button>
        )}
      </div>

      {!agent.alive && (
        <Notice tone="warn" className="max-w-xs">
          글은 매장 PC 에서 만들어집니다 — 클로드 구독이 그 PC 에 로그인되어 있기 때문입니다. 그
          PC 를 켜 두시면 폰에서 눌러도 됩니다.
          {agent.lastSeen ? ` (마지막 확인 ${agent.lastSeen})` : ""}
        </Notice>
      )}

      {busy && (
        <div className="w-full max-w-sm rounded-xl bg-slate-50 p-3 text-left">
          <p className="text-sm font-semibold text-slate-700">
            {job?.status === "대기" ? "매장 PC 가 곧 집어 갑니다…" : "만드는 중입니다 (1~3분)"}
          </p>
          {tail.length > 0 && (
            <pre className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-500">
              {tail.join("\n")}
            </pre>
          )}
        </div>
      )}

      {msg && (
        <Notice tone={msg.tone} className="max-w-xs">
          {msg.text}
        </Notice>
      )}
    </div>
  );
}
