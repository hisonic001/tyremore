"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Camera, Check, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { StatusPill } from "@/components/ui/badge";
import { getVinScan, requestVinScan, type ScanRow } from "@/lib/vin-photo";
import type { AgentStatus } from "@/lib/blog-job";

/**
 * ⭐ **사진으로 읽기** (2026-09-05, 사장님 제안)
 *
 * 🔴 차대번호를 **해독하지 않는다.** 17자리에서 차종을 알아내는 것은 불가능하다
 *    (4~9자리가 비공개 — 09-04). 대신 **B필러 차량 카드·자동차등록증에 적힌 차명을
 *    그대로 읽는다** (사장님 지적). 그래서 이 단추가 그동안 막혀 있던 벽을 돌아간다.
 *
 * 🔴 읽은 값을 **자동으로 넣지 않는다.** 사장님이 보고 「이대로 쓰기」를 누르셔야 들어간다.
 *    틀린 규격은 없는 것보다 나쁘다.
 */
export function PhotoRead({
  agent,
  onVin,
}: {
  agent: AgentStatus;
  /** 읽은 차대번호를 위 칸에 넣는다 */
  onVin: (vin: string) => void;
}) {
  const [pending, start] = useTransition();
  const [scanId, setScanId] = useState<number | null>(null);
  const [scan, setScan] = useState<ScanRow | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  /**
   * 🔴 **칸을 둘로 나눈다** (2026-09-05, 사장님 제보 — 「찍기는 되는데 고르기가 안 됨」).
   *    `capture="environment"` 를 붙이면 폰이 **카메라만 열고 갤러리를 막는다.**
   *    한 칸에 둘 다 담을 수 없어, 찍는 칸과 고르는 칸을 따로 둔다.
   */
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);

  const busy = scanId !== null && (scan === null || scan.status === "대기" || scan.status === "실행중");

  /**
   * 🔴 돌고 있을 때만 3초마다 확인한다. 앞선 확인이 끝나기 전에는 다음 것을 쏘지 않고,
   *    탭이 안 보이면 쉰다 (2026-08-07 풀러 마비 사건의 교훈).
   */
  const inflight = useRef(false);
  useEffect(() => {
    if (!busy || scanId === null) return;
    const t = setInterval(() => {
      if (document.hidden || inflight.current) return;
      inflight.current = true;
      void getVinScan(scanId)
        .then((next) => next && setScan(next))
        .finally(() => {
          inflight.current = false;
        });
    }, 3000);
    return () => clearInterval(t);
  }, [busy, scanId]);

  /**
   * 🔴 보내기 전에 **긴 변 1600px 로 줄인다.** 원본 3MB 를 그대로 올릴 이유가 없고,
   *    라벨 글자는 1600px 이면 충분히 읽힌다.
   */
  async function shrink(file: File): Promise<string> {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error("사진을 열지 못했습니다"));
        i.src = url;
      });
      const max = 1600;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("사진을 줄이지 못했습니다");
      ctx.drawImage(img, 0, 0, w, h);
      return c.toDataURL("image/jpeg", 0.85);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function pick(file: File | null) {
    if (!file) return;
    start(async () => {
      setMsg(null);
      setScan(null);
      setScanId(null);
      try {
        const dataUrl = await shrink(file);
        const r = await requestVinScan(dataUrl);
        if (!r.ok) return setMsg(r.error);
        setScanId(r.scanId);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "사진을 보내지 못했습니다");
      } finally {
        /* 같은 사진을 다시 고르실 수 있게 비운다 */
        if (camRef.current) camRef.current.value = "";
        if (galRef.current) galRef.current.value = "";
      }
    });
  }

  const read = scan?.status === "완료" ? scan.result : null;

  return (
    <section className="mt-3 rounded-card border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">사진으로 읽기</p>
          <p className="mt-0.5 text-[13px] leading-snug text-slate-500">
            운전석 <strong>B필러 차량 카드</strong>나 <strong>자동차등록증</strong>을 찍으면
            차명·형식·연식·차대번호를 읽어 드립니다.
          </p>
        </div>
        <StatusPill tone={agent.alive ? "success" : "neutral"}>
          {agent.alive ? "매장 PC 켜짐" : "매장 PC 꺼짐"}
        </StatusPill>
      </div>

      {/*
        🔴 정직하게 적어 둔다 — 사진 자체는 클로드에 간다. 읽지 말라고는 할 수 있어도
           보내는 것 자체를 막을 수는 없다. 그래서 어떻게 찍으실지를 알려 드린다.
      */}
      <p className="mt-2 text-[12px] leading-snug text-slate-400">
        등록증은 <strong>차량 정보 칸만</strong> 나오게 찍어 주세요. 이름·주소는 읽지 않고
        저장하지도 않으며, <strong>사진은 읽고 나면 바로 지웁니다.</strong>
      </p>

      {!agent.alive ? (
        <Notice tone="warn" className="mt-2">
          사진은 매장 PC 에서 읽습니다 — 클로드 구독이 그 PC 에 로그인되어 있기 때문입니다.
          그 PC 를 켜 두시면 폰에서 찍어도 됩니다.
          {agent.lastSeen ? ` (마지막 확인 ${agent.lastSeen})` : ""}
        </Notice>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {/* 찍는 칸 — capture 가 붙어야 폰에서 카메라가 바로 열린다 */}
          <input
            ref={camRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
            className="hidden"
          />
          {/* 고르는 칸 — 🔴 capture 를 붙이면 갤러리가 안 열린다. 절대 붙이지 말 것 */}
          <input
            ref={galRef}
            type="file"
            accept="image/*"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
            className="hidden"
          />
          <Button variant="secondary" pending={pending} onClick={() => camRef.current?.click()}>
            <Camera className="size-4" /> 사진 찍기
          </Button>
          <Button variant="secondary" pending={pending} onClick={() => galRef.current?.click()}>
            <ImageIcon className="size-4" /> 앨범에서 고르기
          </Button>
        </div>
      )}

      {busy && (
        <p className="mt-2 text-[13px] text-slate-500">
          매장 PC 가 사진을 읽고 있습니다 — 보통 10~20초 걸립니다.
        </p>
      )}

      {msg && (
        <Notice tone="error" className="mt-2">
          {msg}
        </Notice>
      )}

      {scan?.status === "실패" && (
        <Notice tone="error" className="mt-2">
          {scan.error ?? "사진을 읽지 못했습니다"}
        </Notice>
      )}

      {read && (
        <div className="mt-3 rounded-control bg-slate-50 p-3">
          <p className="text-sm font-semibold">
            읽은 것{read.source ? ` (${read.source})` : ""}
          </p>
          <dl className="mt-1 grid grid-cols-[6rem_1fr] gap-x-2 gap-y-0.5 text-[13px] leading-snug">
            {(
              [
                ["차대번호", read.vin],
                ["차명", read.carName],
                ["형식", read.modelCode],
                ["연식", read.year ? `${read.year}년` : null],
                ["앞 타이어", read.tireFront],
                ["뒤 타이어", read.tireRear],
                ["앞 공기압", read.psiFront ? `${read.psiFront} psi` : null],
                ["뒤 공기압", read.psiRear ? `${read.psiRear} psi` : null],
              ] as [string, string | null][]
            ).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500">{k}</dt>
                <dd className={v ? "font-medium text-slate-900" : "text-slate-400"}>{v ?? "못 읽음"}</dd>
              </div>
            ))}
          </dl>

          {/* 🔴 어긋난 것을 조용히 넘기지 않는다 — 어느 쪽이 맞는지는 사장님이 정하신다 */}
          {read.warn.length > 0 && (
            <Notice tone="warn" className="mt-2">
              {read.warn.join(" · ")}
            </Notice>
          )}

          {/* 버린 값도 숨기지 않는다 — 조용히 사라지면 「왜 안 나오지」 하게 된다 */}
          {read.dropped.length > 0 && (
            <p className="mt-2 text-[12px] leading-snug text-amber-700">
              믿기 어려워 버린 값: {read.dropped.join(" · ")}
            </p>
          )}
          {read.unread.length > 0 && (
            <p className="mt-1 text-[12px] leading-snug text-slate-400">
              못 읽은 것: {read.unread.join(", ")}
            </p>
          )}

          {read.vin ? (
            <>
              {/*
                🔴 **읽은 값이 맞다고 말하지 않는다** (2026-09-05, 실제로 겪은 것).
                   흐린 사진에서 `KNAPB8…` 을 `KNAPB6…` 로 읽었고, **두 번 읽어도 똑같이
                   틀렸다.** 17자리 모양은 맞아 검사도 통과한다. 그래서 기계가 할 수 있는
                   것은 여기까지고, **한 글자씩 맞춰 보는 것은 사장님 몫**이다.
                   그러니 크고 띄어서 보여 주고, 확인해 달라고 분명히 말한다.
              */}
              <p className="mt-2 rounded bg-white px-2 py-1.5 text-center font-mono text-[17px] font-bold tracking-[0.15em] text-slate-900">
                {read.vin.replace(/(.{3})(.{6})(.{8})/, "$1 $2 $3")}
              </p>
              <p className="mt-1 text-[12px] leading-snug text-amber-700">
                🔴 <strong>사진과 한 글자씩 맞춰 봐 주세요.</strong> 흐린 사진에서는 8을 6으로,
                0을 D로 잘못 읽는 일이 있습니다 — 한 글자만 달라도 다른 차입니다.
              </p>
              <Button className="mt-2" onClick={() => onVin(read.vin!)}>
                <Check className="size-4" /> 맞습니다 — 이 차대번호로 조회
              </Button>
            </>
          ) : (
            <p className="mt-2 text-[13px] text-slate-500">
              차대번호를 못 읽었습니다 — 더 가까이서 다시 찍어 보시거나 직접 입력해 주세요.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
