"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, Film } from "lucide-react";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { FormFields } from "../../form-fields";
import { writeWithPhotos } from "@/lib/blog-draft-actions";
import { linkFolderToQuote, type FolderRow, type PhotoRow } from "@/lib/blog-photo";
import { EMPTY_FORM, formHasMaterial, type BlogForm } from "@/lib/blog-form";
import type { AgentStatus } from "@/lib/blog-job";
import type { BlogCandidate } from "@/lib/blog-draft";

/**
 * 🔴 AI 가 보는 사진은 **고르신 것 중 앞 12장까지** (사장님 결정 2026-09-02).
 *    사진 한 장이 글 한 쪽분의 양을 먹는다. 실제 발행 글이 12~16장을 쓰므로 12면 충분하고,
 *    73장짜리 폴더를 통째로 보내면 구독 사용량이 크고 글도 산만해진다.
 */
const AI_MAX = 12;

interface SaleSummary {
  quoteNo: string;
  workDate: string;
  car: string;
  mileage: number | null;
  tires: string;
}

export function PickerUI({
  folder, photos, sale, sales, agent,
}: {
  folder: FolderRow;
  photos: PhotoRow[];
  sale: SaleSummary | null;
  sales: BlogCandidate[];
  agent: AgentStatus;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  /** 고른 순서를 지킨다 — 그 순서가 곧 글의 사진 순서가 된다 */
  const [picked, setPicked] = useState<number[]>(() => photos.filter((p) => !p.isVideo && p.hasThumb).map((p) => p.id));
  const [f, setF] = useState<BlogForm>(EMPTY_FORM);
  const [msg, setMsg] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  const usable = photos.filter((p) => !p.isVideo);
  const toAi = picked.slice(0, AI_MAX);
  const ready = formHasMaterial(f) && !!sale;

  const toggle = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  function link(quoteId: number) {
    start(async () => {
      const r = await linkFolderToQuote(folder.id, quoteId);
      if (!r.ok) return setMsg({ tone: "error", text: r.error });
      router.refresh();
    });
  }

  function submit() {
    start(async () => {
      setMsg(null);
      const r = await writeWithPhotos(folder.id, picked, f);
      if (!r.ok) return setMsg({ tone: "error", text: r.error });
      setMsg({ tone: "info", text: "매장 PC 가 사진을 보고 원고를 쓰고 있습니다 (2~4분)" });
      setTimeout(() => router.push("/marketing/blog"), 1400);
    });
  }

  return (
    <div className="mt-3">
      {/* ---- 어느 시공인지 ---- */}
      {sale ? (
        <div className="rounded-card bg-slate-50 p-3">
          <p className="font-semibold leading-snug">{sale.car}</p>
          <p className="text-[13px] leading-snug text-slate-500">
            {sale.tires}
            {sale.mileage ? ` · ${sale.mileage.toLocaleString("ko-KR")}km` : ""} · {sale.workDate}
          </p>
        </div>
      ) : (
        <section className="rounded-card border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">어느 시공인지 골라 주세요</p>
          <p className="mt-0.5 text-[13px] leading-snug text-amber-800">
            폴더 이름에서 차량을 못 찾았습니다. 한 번만 고르시면 다음부터 안 묻습니다.
          </p>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {sales.map((s) => (
              <li key={s.quoteId}>
                <button
                  type="button"
                  onClick={() => link(s.quoteId)}
                  className="w-full rounded-control bg-white px-3 py-2 text-left text-[13px] leading-snug active:bg-slate-100"
                >
                  <span className="font-medium">{s.car}</span>
                  <span className="text-slate-500">
                    {" "}
                    · {s.tires} {s.qty}본 · {s.workDate}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- 사진 고르기 ---- */}
      <section className="mt-5">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">사진 고르기</p>
          <span className="text-[13px] text-slate-500">
            고른 것 {picked.length} · AI 가 볼 사진 {toAi.length}/{AI_MAX}
          </span>
        </div>
        <p className="mt-0.5 text-[13px] leading-snug text-red-700">
          번호판·얼굴이 그대로 보이거나, 종이·영수증이 찍힌 사진은 빼 주세요.
        </p>
        <p className="mt-0.5 text-[13px] leading-snug text-slate-500">
          누른 <strong>순서</strong>가 글에 들어가는 순서입니다. 앞 {AI_MAX}장만 AI 가 실제로 봅니다.
        </p>

        <div className="mt-2 flex gap-1.5">
          <Button variant="ghost" onClick={() => setPicked(usable.filter((p) => p.hasThumb).map((p) => p.id))}>
            전부 고르기
          </Button>
          <Button variant="ghost" onClick={() => setPicked([])}>
            전부 빼기
          </Button>
        </div>

        <ul className="mt-2 grid grid-cols-3 gap-1.5 lg:grid-cols-6">
          {photos.map((p) => {
            const n = picked.indexOf(p.id);
            const on = n >= 0;
            const inAi = on && n < AI_MAX;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={p.isVideo || !p.hasThumb}
                  onClick={() => toggle(p.id)}
                  className={`relative block aspect-square w-full overflow-hidden rounded-control border-2 ${
                    on ? "border-brand-600" : "border-transparent"
                  } ${p.isVideo || !p.hasThumb ? "cursor-not-allowed" : ""}`}
                >
                  {p.hasThumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/blog-photo/${p.id}/thumb`}
                      alt=""
                      loading="lazy"
                      className={`size-full object-cover ${on ? "" : "opacity-60"}`}
                    />
                  ) : (
                    <span className="flex size-full flex-col items-center justify-center gap-1 bg-slate-100 text-slate-400">
                      {p.isVideo ? <Film className="size-5" /> : <CloudOff className="size-5" />}
                      <span className="text-[10px]">{p.isVideo ? "영상" : "구름"}</span>
                    </span>
                  )}
                  {on && (
                    <span
                      className={`absolute left-1 top-1 flex size-6 items-center justify-center rounded-full text-xs font-bold text-white ${
                        inAi ? "bg-brand-600" : "bg-slate-500"
                      }`}
                    >
                      {n + 1}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {folder.thumbCount < folder.photoCount && (
          <p className="mt-2 flex items-center gap-1 text-[13px] text-amber-700">
            <CloudOff className="size-4" />
            구름에만 있는 사진 {folder.photoCount - folder.thumbCount}장은 못 고릅니다 — 폴더 목록에서
            「이 폴더 사진 내려받기」를 눌러 주세요.
          </p>
        )}
      </section>

      {/* ---- 작업 후기 ---- */}
      <FormFields f={f} setF={setF} />

      {!agent.alive && (
        <Notice tone="warn">매장 PC 가 꺼져 있습니다 — 켜신 뒤 눌러 주세요.</Notice>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <div className="sticky bottom-20 mt-6 xl:bottom-4">
        <Button className="w-full" pending={pending} disabled={!ready || !agent.alive} onClick={submit}>
          {!sale
            ? "먼저 시공을 골라 주세요"
            : ready
              ? `사진 ${toAi.length}장으로 원고 만들기`
              : "작업 후기를 하나만 눌러 주세요"}
        </Button>
      </div>
    </div>
  );
}
