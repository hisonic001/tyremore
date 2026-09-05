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
import { preparePublishImages, regenerateDraft, saveOwnerNote, setDraftStatus } from "@/lib/blog-draft-actions";

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
/** 사진 화질 관련 — 화면이 「끌어도 되는지」를 정확히 말하기 위해 필요한 것들 */
interface PhotoInfo {
  /** 발행용(1280px)이 준비된 사진 id */
  ready: number[];
  /** 이 폴더의 영상 — 끌 수 없다. 네이버 「동영상」 단추로만 올라간다 */
  videos: { fileName: string; mb: number }[];
  /** 사진 폴더 이름 — 매장 PC 에서 원본을 직접 끌고 싶으실 때 */
  folder: string | null;
}

export function DraftEditor({ draft, photos }: { draft: Draft; photos: PhotoInfo }) {
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

  /**
   * 🔴 사진 화질 (2026-09-05). 준비된 사진만 「끌어도 되는」 사진이다.
   *    준비 안 된 것을 준비된 척 보이면, 사장님이 160px 을 그대로 블로그에 올리시게 된다.
   */
  const readySet = useMemo(() => new Set(photos.ready), [photos.ready]);
  const readyCount = draft.photoPlan?.filter((p) => readySet.has(p.photoId)).length ?? 0;
  const allReady = !!draft.photoPlan?.length && readyCount === draft.photoPlan.length;

  const prepPhotos = () =>
    start(async () => {
      const r = await preparePublishImages(draft.id);
      if (!r.ok) return setMsg(r.error);
      setMsg("매장 PC 에 요청했습니다 — 잠시 뒤 화면을 새로 고치면 큰 사진으로 바뀝니다.");
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
            본문의 <strong>[사진 A-00 - …]</strong> 자리에 이 순서대로 넣으시면 됩니다.
          </p>

          {/*
            🔴 화질 안내가 이 화면의 핵심이다 (2026-09-05).
               브라우저는 끌 때 화면에 보이는 크기가 아니라 **그림 파일 자체**를 넘긴다.
               그래서 준비 전에는 목록용 160px 이 그대로 블로그에 올라간다 —
               사장님이 지적하신 그 화질이다. 어느 쪽인지 반드시 말해 준다.
          */}
          {allReady ? (
            <p className="mt-1 text-[13px] font-medium leading-snug text-brand-700">
              끌어다 놓으시면 됩니다 — 블로그용 큰 사진(가로 1280)입니다.
            </p>
          ) : (
            <div className="mt-2 rounded-control bg-amber-50 p-2.5">
              <p className="text-[13px] leading-snug text-amber-900">
                지금 이 사진들은 <strong>목록용 작은 그림(가로 160)</strong>입니다. 이대로 끌어다 붙이면
                블로그에도 그 화질로 올라갑니다.
                {readyCount > 0 && ` (${readyCount}장만 준비돼 있습니다)`}
              </p>
              <Button
                className="mt-2"
                variant="secondary"
                pending={pending}
                onClick={prepPhotos}
              >
                사진 고화질로 준비
              </Button>
            </div>
          )}

          <ul className="mt-2 grid grid-cols-3 gap-1.5 lg:grid-cols-6">
            {draft.photoPlan.map((p) => {
              const big = readySet.has(p.photoId);
              return (
                <li key={p.slot} className="text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    /* 🔴 준비됐으면 **큰 사진을 건다.** 화면엔 작게 보여도 끌면 1280px 이 넘어간다 */
                    src={`/api/blog-photo/${p.photoId}/${big ? "publish" : "thumb"}`}
                    alt={p.caption}
                    loading="lazy"
                    className={`aspect-square w-full rounded-control object-cover ${
                      big ? "" : "opacity-70"
                    }`}
                  />
                  <span className="mt-0.5 block font-mono text-[10px] text-slate-400">{p.slot}</span>
                  <span className="block text-[11px] leading-tight text-slate-500">{p.caption}</span>
                </li>
              );
            })}
          </ul>

          {/*
            🔴 영상은 사진과 길이 아주 다르다 (사장님 질문 2026-09-05).
               네이버는 영상을 **자기 「동영상」 단추로만** 받는다 — 웹에서 끌어다 붙이는 길이
               아예 없다. 그래서 끌 수 있는 그림처럼 보이게 만들지 않는다.
               어느 영상을 쓸지도 고르지 않는다 — 안을 못 보면서 고르는 척하면 안 된다.
          */}
          {photos.videos.length > 0 && (
            <div className="mt-3 rounded-control border border-slate-200 p-2.5">
              <p className="text-[13px] font-medium text-slate-700">🎬 영상 {photos.videos.length}개</p>
              <p className="mt-0.5 text-[13px] leading-snug text-slate-500">
                이건 <strong>끌어다 놓지 마세요.</strong> 네이버 글쓰기의 <strong>「동영상」</strong> 단추로
                <strong> _블로그</strong> 폴더의 <strong>V-</strong> 파일을 올려 주세요. 어느 것을 쓸지는
                사장님이 보고 고르시면 됩니다.
              </p>
              <p className="mt-1 font-mono text-[11px] text-slate-400">
                {photos.videos.map((v, i) => `V-${String(i).padStart(2, "0")} (${v.mb}MB)`).join(" · ")}
              </p>
            </div>
          )}

          {photos.folder && (
            <p className="mt-2 text-[12px] leading-snug text-slate-400">
              원본 그대로 올리시려면 매장 PC 의 사진 폴더 안{" "}
              <span className="font-mono text-slate-500">{photos.folder}\_블로그</span> 에서 바로 끄셔도
              됩니다. (네이버가 어차피 966px 로 줄이므로 화질 차이는 거의 없습니다.)
            </p>
          )}
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
