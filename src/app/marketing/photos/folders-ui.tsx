"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/lib/link";
import { CloudOff, Images, RefreshCw } from "lucide-react";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { requestScan, type FolderRow } from "@/lib/blog-photo";
import type { AgentStatus } from "@/lib/blog-job";

export function FoldersUI({ folders, agent }: { folders: FolderRow[]; agent: AgentStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  const scan = (folderId?: number, hydrate = false) =>
    start(async () => {
      setMsg(null);
      const r = await requestScan(folderId, hydrate);
      if (!r.ok) return setMsg({ tone: "error", text: r.error });
      setMsg({
        tone: "info",
        text: hydrate
          ? "매장 PC 가 그 폴더 사진을 내려받아 미리보기를 만들고 있습니다 (1~2분). 잠시 뒤 새로고침해 주세요."
          : "매장 PC 가 폴더를 훑고 있습니다. 잠시 뒤 새로고침해 주세요.",
      });
      setTimeout(() => router.refresh(), 8000);
    });

  /**
   * 🔴 「아직 안 올림」은 **폴더 이름이 아니라 올림 표시**로 본다 (2026-09-05, 사장님 지적).
   *    예전에는 이름 앞의 `(미업로드)` 만 봐서, 블로그에 다 올리셔도 계속 안 올림으로 떴다.
   *    이름은 사장님의 대기열 표시라 프로그램이 건드리지 않는다.
   */
  const pendingFolders = folders.filter((f) => f.isPending && !f.postedAt);

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-2">
        <StatusPill tone={agent.alive && !agent.outdated ? "success" : agent.outdated ? "warn" : "neutral"}>
          {!agent.alive
            ? "매장 PC 꺼짐"
            : agent.outdated
              ? "대리인 옛 버전"
              : `매장 PC 켜짐${agent.host ? ` (${agent.host})` : ""}`}
        </StatusPill>
        <Button variant="secondary" pending={pending} disabled={!agent.alive} onClick={() => scan()}>
          <RefreshCw className="size-4" /> 사진 다시 훑기
        </Button>
      </div>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {pendingFolders.length > 0 && (
        <p className="mt-3 rounded-card bg-amber-50 px-3 py-2 text-[13px] leading-snug text-amber-900">
          아직 안 올리신 것이 <strong>{pendingFolders.length}건</strong> 있습니다. 블로그에 올리신 뒤
          폴더를 열어 <strong>「블로그에 올렸음」</strong>을 눌러 주시면 여기서 사라집니다.
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {folders.map((f) => (
          <li key={f.id}>
            <Link
              href={`/marketing/photos/${f.id}`}
              className="flex items-start gap-3 rounded-card border border-slate-200 bg-white p-4 active:bg-slate-50 lg:hover:bg-slate-50"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                <Images className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold leading-snug">{f.label}</span>
                  {f.postedAt ? (
                    <StatusPill tone="success">올림 {f.postedAt}</StatusPill>
                  ) : (
                    f.isPending && <StatusPill tone="accent">아직 안 올림</StatusPill>
                  )}
                  {f.quoteId ? (
                    <StatusPill tone="info">시공 연결됨</StatusPill>
                  ) : (
                    <StatusPill tone="warn">시공 연결 안 됨</StatusPill>
                  )}
                  {f.draftCount > 0 && <StatusPill tone="neutral">원고 {f.draftCount}</StatusPill>}
                </span>
                <span className="mt-0.5 block text-[13px] leading-snug text-slate-500">
                  사진 {f.photoCount}장
                  {f.videoCount ? ` · 영상 ${f.videoCount}` : ""}
                  {f.mtime ? ` · ${f.mtime}` : ""}
                </span>
                {f.thumbCount < f.photoCount && (
                  <span className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                    <CloudOff className="size-3.5" />
                    구름에만 있는 사진 {f.photoCount - f.thumbCount}장 — 미리보기가 없습니다
                  </span>
                )}
              </span>
            </Link>
            {f.thumbCount < f.photoCount && (
              <div className="mt-1 flex justify-end">
                <Button
                  variant="ghost"
                  pending={pending}
                  disabled={!agent.alive}
                  onClick={() => scan(f.id, true)}
                >
                  이 폴더 사진 내려받기
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-6 text-xs leading-snug text-slate-400">
        원본 사진은 매장 PC 에만 있습니다. 앱으로는 작은 미리보기만 올라옵니다.
      </p>
    </div>
  );
}
