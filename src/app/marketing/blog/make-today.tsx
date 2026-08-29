"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { makeTodayDrafts } from "@/lib/blog-draft-actions";

/** 「오늘 초안 만들기」 — 크론(21:00)을 기다리지 않고 지금. 한 건 30~60초 */
export function MakeTodayButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  return (
    <div className="flex flex-col items-end">
      <Button
        variant="secondary"
        pending={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await makeTodayDrafts();
            if (!r.ok) setMsg({ tone: "error", text: r.error });
            else {
              setMsg({
                tone: "success",
                text: `${r.made}건 만들었습니다${r.skipped?.length ? ` · 건너뜀 ${r.skipped.length}건` : ""}`,
              });
              router.refresh();
            }
          })
        }
      >
        {pending ? "만드는 중 (1분쯤)…" : "오늘 초안 만들기"}
      </Button>
      {msg && (
        <Notice tone={msg.tone} className="max-w-xs">
          {msg.text}
        </Notice>
      )}
    </div>
  );
}
