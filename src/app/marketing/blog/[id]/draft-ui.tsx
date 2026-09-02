"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { TextareaField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
// 🔴 클라이언트는 core 만 — blog-draft.ts 는 DB 를 물고 있다
import { OWNER_SLOT, composeForCopy } from "@/lib/blog-draft-core";
import { regenerateDraft, saveOwnerNote, setDraftStatus } from "@/lib/blog-draft-actions";

const MIN_NOTE = 15;

interface Draft {
  id: number;
  status: string;
  titles: string[];
  body: string;
  tags: string[];
  ownerNote: string | null;
  facts: string;
  warn: string | null;
  /** 'auto' | '폼' | '사진' — 폼·사진으로 만든 글은 한마디를 강요하지 않는다 */
  source: string;
  /** 사진 배치 계획 (C단계) — 순서대로 미리보기를 보여 준다 */
  photoPlan: { photoId: number; slot: string; caption: string }[] | null;
}

/**
 * 초안 상세 — 제목 고르기 · 사장님 한마디(필수) · 복사 · 다르게 한 번 더 · 올림 표시
 *
 * 🔴 한마디가 15자 미만이면 복사 버튼이 안 켜진다. AI 글의 균일한 결을 깨는 유일한 장치라
 *    (SEO 전문가 리뷰) 편의로 풀지 않는다.
 */
export function DraftEditor({ draft }: { draft: Draft }) {
  const router = useRouter();
  const [ask, confirmDialog] = useConfirm();
  const [titleIdx, setTitleIdx] = useState(0);
  const [note, setNote] = useState(draft.ownerNote ?? "");
  const [saved, setSaved] = useState(draft.ownerNote ?? "");
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /**
   * 🔴 한마디 게이트는 **시공 기록만으로 만든 글에만** 건다 (2026-09-02).
   *    폼·사진으로 만든 글은 이미 사장님 육성(왜 오셨나·뭘 봤나)이 본문에 들어 있어
   *    또 15자를 받으면 손이 두 번 간다.
   */
  const needNote = draft.source === "auto";
  const noteOk = !needNote || note.trim().length >= MIN_NOTE;
  const [before, after] = useMemo(() => {
    const i = draft.body.indexOf(OWNER_SLOT);
    return i < 0 ? [draft.body, ""] : [draft.body.slice(0, i), draft.body.slice(i + OWNER_SLOT.length)];
  }, [draft.body]);

  const copy = () =>
    start(async () => {
      setMsg(null);
      if (note !== saved) {
        const r = await saveOwnerNote(draft.id, note);
        if (!r.ok) return setMsg(r.error);
        setSaved(note);
      }
      const text = composeForCopy({ ...draft, ownerNote: note }, titleIdx);
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch {
        setMsg("복사가 막혔습니다 — 본문을 길게 눌러 직접 복사해 주세요");
      }
    });

  /**
   * 「다르게 한 번 더」 — 매장 PC 에 주문만 넣는다. 1~3분 뒤 목록 맨 위에 새 원고가 생긴다.
   * (예전에는 여기서 바로 만들어 새 글로 넘어갔지만, 이제 만드는 곳이 매장 PC 다)
   */
  const regen = () =>
    start(async () => {
      setMsg(null);
      const r = await regenerateDraft(draft.id);
      if (!r.ok) return setMsg(r.error);
      setMsg("매장 PC 에 요청했습니다 — 1~3분 뒤 목록 맨 위에 새 원고가 생깁니다.");
      router.refresh();
    });

  const mark = async (status: "발행" | "버림") => {
    if (
      status === "버림" &&
      !(await ask({ title: "이 초안을 버릴까요?", body: "목록에서 사라집니다. 같은 시공으로 다시 만들 수는 있습니다.", tone: "danger", confirmLabel: "버리기" }))
    )
      return;
    start(async () => {
      const r = await setDraftStatus(draft.id, status);
      if (!r.ok) return setMsg(r.error);
      router.push("/marketing/blog");
    });
  };

  return (
    <div className="space-y-4 pb-28">
      {draft.warn && <Notice tone="warn">{draft.warn}</Notice>}

      <section className="rounded-card border border-slate-200 bg-white p-4">
        <h2 className="text-[13px] font-medium text-slate-600">제목 — 하나 고르세요</h2>
        <ul className="mt-2 space-y-1.5">
          {draft.titles.map((t, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => setTitleIdx(i)}
                className={`w-full rounded-control border px-3 py-2.5 text-left text-[15px] leading-snug ${
                  i === titleIdx ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-800"
                }`}
              >
                {t}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-card border border-slate-200 bg-white p-4">
        <h2 className="text-[13px] font-medium text-slate-600">본문</h2>
        <pre className="mt-2 whitespace-pre-wrap font-sans text-[15px] leading-relaxed text-slate-800">{before}</pre>
        {needNote && (
          <div className="my-2 rounded-control border-2 border-dashed border-accent-400 bg-amber-50 p-3">
            <TextareaField
              label="사장님 한마디 — 이 차에서 실제로 본 것 (필수)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="예: 앞쪽 안쪽만 유난히 닳아 있어서 얼라인먼트를 같이 봤습니다. 속초처럼 굽은 길 많은 데선 이 마모가 흔합니다."
            />
            <p className={`mt-1 text-xs ${noteOk ? "text-brand-700" : "text-amber-800"}`}>
              {noteOk ? "좋습니다 — 이 문단이 글을 사장님 글로 만듭니다" : `${MIN_NOTE}자 이상 써야 복사가 켜집니다 (${note.trim().length}자)`}
            </p>
          </div>
        )}
        <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed text-slate-800">{after}</pre>
        <p className="mt-3 text-sm text-slate-500">{draft.tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ")}</p>
      </section>

      {draft.photoPlan && draft.photoPlan.length > 0 && (
        <section className="rounded-card border border-slate-200 bg-white p-4">
          <h2 className="text-[13px] font-medium text-slate-600">
            사진 순서 — {draft.photoPlan.length}장
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-slate-500">
            본문의 <strong>[사진 A-00 - …]</strong> 자리에 이 순서대로 넣으시면 됩니다. 사진 폴더 안
            <strong> _블로그</strong> 폴더에 같은 이름으로 복사해 뒀습니다 — 폰의 OneDrive 앱에서도 보입니다.
          </p>
          <ul className="mt-2 grid grid-cols-3 gap-1.5 lg:grid-cols-6">
            {draft.photoPlan.map((p) => (
              <li key={p.slot} className="text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/blog-photo/${p.photoId}/thumb`}
                  alt={p.caption}
                  loading="lazy"
                  className="aspect-square w-full rounded-control object-cover"
                />
                <span className="mt-0.5 block font-mono text-[10px] text-slate-400">{p.slot}</span>
                <span className="block text-[11px] leading-tight text-slate-500">{p.caption}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="rounded-card border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <summary className="cursor-pointer font-medium">이 글에 넣은 시공 사실</summary>
        <pre className="mt-2 whitespace-pre-wrap font-sans text-[13px]">{draft.facts}</pre>
        <p className="mt-2 text-xs text-slate-400">번호판·이름·전화·정확한 날짜는 애초에 안 보냈습니다.</p>
      </details>

      {msg && <Notice tone="error">{msg}</Notice>}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" pending={pending} onClick={regen}>
          다르게 한 번 더
        </Button>
        {draft.status !== "발행" && (
          <Button variant="secondary" pending={pending} onClick={() => mark("발행")}>
            블로그에 올렸음
          </Button>
        )}
        <Button variant="ghost" pending={pending} onClick={() => mark("버림")}>
          버리기
        </Button>
      </div>

      {/* 복사는 늘 보이게 — 폰에서 스크롤 끝까지 안 가도 된다 */}
      <div className="fixed inset-x-0 bottom-14 z-30 border-t border-slate-200 bg-white/95 p-3 backdrop-blur lg:bottom-0">
        <div className="mx-auto max-w-2xl">
          <Button size="lg" pending={pending} disabled={!noteOk} onClick={copy}>
            {copied ? <Check className="size-5" /> : <Copy className="size-5" />}
            {copied ? "복사했습니다 — 블로그 앱에 붙여넣으세요" : "제목+본문+태그 복사"}
          </Button>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
