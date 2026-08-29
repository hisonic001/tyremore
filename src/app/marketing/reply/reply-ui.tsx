"use client";

import { useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipButton } from "@/components/ui/chip";
import { TextareaField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { draftReply } from "@/lib/review-reply";

export function ReplyForm() {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [reply, setReply] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const make = () =>
    start(async () => {
      setErr(null);
      const r = await draftReply({ rating, text });
      if (!r.ok) return setErr(r.error);
      setReply(r.reply);
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reply);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setErr("복사가 막혔습니다 — 답글을 길게 눌러 직접 복사해 주세요");
    }
  };

  return (
    <div className="mt-4 space-y-4">
      <section className="rounded-card border border-slate-200 bg-white p-4">
        <p className="text-[13px] font-medium text-slate-600">별점</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[5, 4, 3, 2, 1].map((n) => (
            <ChipButton key={n} active={rating === n} onClick={() => setRating(n)}>
              {"★".repeat(n)}
            </ChipButton>
          ))}
        </div>
        <div className="mt-3">
          <TextareaField
            label="리뷰 내용"
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="리뷰 글을 그대로 붙여넣으세요. 이름·전화번호로 보이는 글자는 보내기 전에 가립니다."
          />
        </div>
        <div className="mt-3">
          <Button pending={pending} disabled={text.trim().length < 5} onClick={make}>
            {pending ? "쓰는 중…" : reply ? "다시 쓰기" : "답글 초안 만들기"}
          </Button>
        </div>
        {err && <Notice tone="error">{err}</Notice>}
      </section>

      {reply && (
        <section className="rounded-card border-2 border-brand-500 bg-brand-50 p-4">
          <p className="text-[13px] font-medium text-brand-700">답글 초안 — 고쳐 쓰셔도 됩니다</p>
          <TextareaField className="mt-2" rows={4} value={reply} onChange={(e) => setReply(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">{reply.length}자</p>
          <div className="mt-3">
            <Button size="lg" onClick={copy}>
              {copied ? <Check className="size-5" /> : <Copy className="size-5" />}
              {copied ? "복사했습니다 — 플레이스 앱에 붙여넣으세요" : "답글 복사"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
