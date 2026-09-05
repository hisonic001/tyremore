"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { cancelBlogJob, getBlogJob, type AgentStatus, type BlogJobRow } from "@/lib/blog-job";

/**
 * 원고 만들기 진행 상황 — 매장 PC 가 켜졌는지, 지금 뭘 만들고 있는지.
 *
 * 🔴 **여기서는 원고를 주문하지 않는다** (사장님 지시 2026-09-05).
 *    예전에는 「오늘 원고 만들기」 단추가 그날 시공에서 **2건을 프로그램이 골라** 만들었다.
 *    사장님은 **쓸 작업을 직접 고르고 싶어 하신다** — 그래서 고르는 화면
 *    (사진으로 원고 만들기 · 사진 없이 후기만으로)으로만 들어가게 한다.
 *    자동으로 고르는 길은 없앴다. 다시 만들지 말 것.
 *
 * 🔴 진행 로그를 보여준다 (MARS 화면과 반대 결정). MARS 는 70분짜리라 숨겼지만
 *    원고는 1~3분이고, 그 사이 화면이 멈춘 것처럼 보이면 버튼을 또 누르시게 된다.
 */
export function BlogJobStatus({
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
        <StatusPill tone={agent.alive && !agent.outdated ? "success" : agent.outdated ? "warn" : "neutral"}>
          {!agent.alive
            ? "매장 PC 꺼짐"
            : agent.outdated
              ? "대리인 옛 버전"
              : `매장 PC 켜짐${agent.host ? ` (${agent.host})` : ""}`}
        </StatusPill>
        {busy ? (
          <Button variant="secondary" pending={pending} onClick={stop}>
            중단
          </Button>
        ) : (
          /* 🔴 여기서 바로 만들지 않는다 — 어느 시공으로 쓸지는 사장님이 고르신다 */
          <Link
            href="/marketing/photos"
            className="rounded-control border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 active:bg-slate-50 lg:hover:bg-slate-50"
          >
            원고 만들기
          </Link>
        )}
      </div>

      {agent.alive && agent.outdated && (
        /* 🔴 옛 대리인은 새 주문을 조용히 엉뚱하게 처리한다 (2026-09-05 실제로 났다) */
        <Notice tone="warn" className="max-w-xs">
          매장 PC 의 대리인이 <strong>옛 버전</strong>입니다. 그 PC 에서 대리인 창을 닫고 다시
          켜 주세요 — 그 전에는 새 기능이 엉뚱하게 돕니다.
        </Notice>
      )}

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
