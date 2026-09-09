"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { getVinScan } from "@/lib/vin-photo";
import { parseVin } from "@/lib/vin";

/**
 * ⭐ 판매 등록 「사진으로 차량 찾기·등록」 (사장님 제안 2026-09-05)
 *
 *   "차량번호 사진 + B필러 사진(혹은 차량등록증) + 주행거리, 세 장의 사진으로
 *    고객 조회와 새로운 고객 등록이 바로 가능하게."
 *
 * ⭐ 2026-09-06 업그레이드 (사장님 — "한 장씩 순서대로 찍는 것은 불편함"):
 *    찍기 버튼을 빼고 **앨범에서 여러 장(3~4장)을 한꺼번에** 고른다.
 *    사진 한 장 = 스캔 한 건은 그대로다(대리인이 사진 종류를 스스로 판단) —
 *    여러 장은 스캔 여러 건을 줄 세울 뿐이라 매장 PC 대리인 변경이 없다.
 *
 * 🔴 읽은 값은 자동 확정이 아니다 — 번호판은 검색창에 들어가 결과를 보여 주고,
 *    신규 등록 값은 폼에 미리 채워질 뿐 저장 전에 전부 고칠 수 있다.
 */
export interface PhotoInfo {
  plateNo?: string;
  /** 한글이 오독으로 버려졌을 때 살린 숫자 끝 4자리 — 되찾기 검색용 */
  plateTail?: string;
  /** 한글만 모를 때의 전체 꼴 「23?9549」 — 숫자가 다 맞는 등록 차 1대면 자동 선택 */
  plateMask?: string;
  vin?: string;
  carName?: string;
  modelCode?: string;
  year?: number;
  ownerName?: string;
  odoKm?: number;
  /** 차대번호에서 읽은 제조사 (parseVin 정본) */
  makerName?: string;
}

/** 한 번에 받는 사진 상한 — 번호판·차량카드(등록증)·계기판이면 3장, 여유 1장 */
const MAX_PHOTOS = 4;

interface PhotoJob {
  key: number;
  name: string;
  scanId: number | null;
  /** 보내는중 → 읽는중 → 완료 | 실패 */
  phase: "보내는중" | "읽는중" | "완료" | "실패";
  /** 완료: 읽은 것 요약 · 실패: 이유 */
  note: string;
  /** 믿기 어려워 버린 값·경고 — 숨기지 않는다 */
  extra: string[];
}

type ScanResult = NonNullable<Awaited<ReturnType<typeof getVinScan>>>["result"];

/** 읽은 결과에서 쓸 값과 화면 요약 줄을 만든다 */
function digest(r: NonNullable<ScanResult>): { info: PhotoInfo; line: string; extra: string[] } {
  const info: PhotoInfo = {};
  const parts: string[] = [];
  if (r.plateNo) {
    info.plateNo = r.plateNo;
    parts.push(`차량번호 ${r.plateNo}`);
  } else if (r.plateTail) {
    // 한글은 오독으로 버렸지만 숫자는 살렸다 — 숫자로 되찾는다 (2026-09-06)
    info.plateTail = r.plateTail;
    if (r.plateMask) info.plateMask = r.plateMask;
    parts.push(`차량번호 ${r.plateMask ?? `끝 4자리 ${r.plateTail}`} (한글 못 읽음)`);
  }
  if (r.vin) {
    info.vin = r.vin;
    parts.push(`차대번호 ${r.vin}`);
    const v = parseVin(r.vin);
    if (v.maker) info.makerName = v.maker.split(" ")[0];
    if (v.year && !r.year) info.year = v.year;
  }
  if (r.carName) {
    info.carName = r.carName;
    parts.push(`차명 ${r.carName}${r.modelCode ? `(${r.modelCode})` : ""}`);
  }
  if (r.modelCode) info.modelCode = r.modelCode;
  if (r.year) {
    info.year = r.year;
    parts.push(`연식 ${r.year}년`);
  }
  if (r.ownerName) {
    info.ownerName = r.ownerName;
    parts.push(`소유자 ${r.ownerName}`);
  }
  if (r.odoKm) {
    info.odoKm = r.odoKm;
    parts.push(`주행거리 ${r.odoKm.toLocaleString("ko-KR")}km`);
  }
  const extra = [
    ...r.warn.map((w) => `⚠️ ${w}`),
    ...(r.dropped.length ? [`버린 값: ${r.dropped.join(" · ")}`] : []),
  ];
  return { info, line: parts.join(" · ") || "읽어낸 것이 없습니다 — 더 가까이서 다시 찍어 보세요", extra };
}

/**
 * 보내기 전에 긴 변 2000px 로 줄인다 (2026-09-05 — 1600px 에서 키움).
 * 🔴 번호판 사진은 차 전체가 찍혀 번호판 영역이 작다 — 1600px 로 줄이면 가운데
 *    한글이 뭉개져 오독이 잦았다.
 * 🔴 결과는 **이진(Blob)** 이다 (2026-09-08) — 서버 액션의 100만 자 하드 한도
 *    («Maximum array nesting» 실사고) 때문에 /api/vin-scan 으로 파일째 올린다.
 *    품질 사다리: 2MB 넘으면 0.7 로 다시 굽고, 그래도 2.9MB 넘으면 잘라 말한다.
 */
async function shrink(file: File): Promise<{ blob: Blob; quality: number }> {
  /**
   * ⭐ 기종 함정 보강 (사장님 요청 2026-09-09 — 기종별 오류 검증):
   *    ① EXIF 회전 — 구형 브라우저는 세로 사진을 눕혀 그린다.
   *       createImageBitmap(from-image) 이 되면 그걸로 바로 잡는다.
   *    ② 아이폰 HEIC — 크롬/안드로이드는 못 연다. 실패 문구에 설정 팁을 넣는다.
   */
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      source = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () =>
          rej(
            new Error(
              /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
                ? "이 사진 형식(HEIC)을 이 폰 브라우저가 못 엽니다 — 아이폰이면 설정→카메라→포맷→「호환성 높음」으로 바꾸고 다시 찍어 주세요"
                : "사진을 열지 못했습니다",
            ),
          );
        i.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const max = 2000;
  const scale = Math.min(1, max / Math.max(source.width, source.height));
  const c = document.createElement("canvas");
  c.width = Math.round(source.width * scale);
  c.height = Math.round(source.height * scale);
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("사진을 줄이지 못했습니다");
  ctx.drawImage(source, 0, 0, c.width, c.height);
  if ("close" in source) source.close();
  const bake = (q: number) =>
    new Promise<Blob>((res, rej) =>
      c.toBlob((b) => (b ? res(b) : rej(new Error("사진을 줄이지 못했습니다"))), "image/jpeg", q),
    );
  let quality = 0.85;
  let out = await bake(quality);
  if (out.size > 2_000_000) {
    quality = 0.7;
    out = await bake(quality);
  }
  if (out.size > 2_900_000) throw new Error("사진이 너무 큽니다 — 조금 떨어져서 다시 찍어 주세요");
  return { blob: out, quality };
}

export function PhotoAssist({ onInfo }: { onInfo: (p: PhotoInfo) => void }) {
  const [pending, start] = useTransition();
  const [jobs, setJobs] = useState<PhotoJob[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  // 🔴 capture 를 붙이면 갤러리가 안 열린다 — 절대 붙이지 말 것 (photo-read 교훈)
  const galRef = useRef<HTMLInputElement>(null);
  const keySeq = useRef(0);

  const busy = jobs.some((j) => j.phase === "보내는중" || j.phase === "읽는중");

  /**
   * 🔴 3초마다 확인하되 **한 틱 안에서 순차로** — 동시 질의가 풀을 채운 전례
   *    (2026-08-07). 탭이 안 보이면 쉬고, 앞선 확인이 끝나기 전엔 다음 틱을 안 쏜다.
   */
  const inflight = useRef(false);
  useEffect(() => {
    if (!jobs.some((j) => j.phase === "읽는중")) return;
    const t = setInterval(() => {
      if (document.hidden || inflight.current) return;
      inflight.current = true;
      void (async () => {
        for (const j of jobs) {
          if (j.phase !== "읽는중" || j.scanId === null) continue;
          const scan = await getVinScan(j.scanId).catch(() => null);
          if (!scan) continue;
          if (scan.status === "완료" && scan.result) {
            const d = digest(scan.result);
            setJobs((prev) => prev.map((x) => (x.key === j.key ? { ...x, phase: "완료", note: d.line, extra: d.extra } : x)));
            if (Object.keys(d.info).length > 0) onInfo(d.info);
          } else if (scan.status === "실패") {
            setJobs((prev) =>
              prev.map((x) => (x.key === j.key ? { ...x, phase: "실패", note: scan.error ?? "사진을 읽지 못했습니다" } : x)),
            );
          }
        }
      })().finally(() => {
        inflight.current = false;
      });
    }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.map((j) => `${j.key}:${j.phase}`).join(",")]);

  function pick(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = [...list].slice(0, MAX_PHOTOS);
    if (list.length > MAX_PHOTOS) setMsg(`한 번에 ${MAX_PHOTOS}장까지 — 앞 ${MAX_PHOTOS}장만 읽습니다`);
    else setMsg(null);
    start(async () => {
      for (const file of files) {
        const key = ++keySeq.current;
        const name = `사진 ${key}`;
        setJobs((prev) => [...prev, { key, name, scanId: null, phase: "보내는중", note: "", extra: [] }]);
        /* ⭐ 시도 진단 meta (2026-09-09) — 기종별 오류 검증용 (기기 문자열·크기뿐) */
        const t0 = Date.now();
        const meta: Record<string, string | number> = {
          srcType: file.type || "(없음)",
          srcBytes: file.size,
        };
        try {
          const { blob, quality } = await shrink(file);
          meta.outBytes = blob.size;
          meta.quality = quality;
          meta.ms = Date.now() - t0;
          /* 🔴 서버 액션이 아니라 업로드 — 액션 인자 100만 자 한도를 피한다 (2026-09-08) */
          const fd = new FormData();
          fd.append("file", blob, "photo.jpg");
          fd.append("mode", "판매등록");
          fd.append("meta", JSON.stringify(meta));
          const res = await fetch("/api/vin-scan", { method: "POST", body: fd });
          const r = (await res.json().catch(() => null)) as
            | { ok: true; scanId: number }
            | { ok: false; error: string }
            | null;
          if (!r) throw new Error(`사진을 보내지 못했습니다 (HTTP ${res.status})`);
          if (!r.ok) {
            /* 매장 PC 꺼짐 등 — 남은 줄을 더 보내 봐야 같은 이유로 실패한다. 여기서 멈춘다 */
            setJobs((prev) => prev.filter((x) => x.key !== key));
            setMsg(r.error);
            return;
          }
          setJobs((prev) => prev.map((x) => (x.key === key ? { ...x, scanId: r.scanId, phase: "읽는중" } : x)));
        } catch (e) {
          const note = e instanceof Error ? e.message : "사진을 보내지 못했습니다";
          setJobs((prev) => prev.map((x) => (x.key === key ? { ...x, phase: "실패", note } : x)));
          /* ⭐ 폰 안에서 끝난 실패도 서버에 남긴다 (2026-09-09) — 없으면 기종별 검증 불가 */
          const fd = new FormData();
          fd.append("mode", "판매등록");
          fd.append("clientError", note);
          fd.append("meta", JSON.stringify({ ...meta, ms: Date.now() - t0 }));
          void fetch("/api/vin-scan", { method: "POST", body: fd }).catch(() => {});
        }
      }
      if (galRef.current) galRef.current.value = "";
    });
  }

  return (
    <div className="mt-2 rounded-control border border-slate-200 bg-slate-50 p-3">
      <p className="text-[13px] leading-snug text-slate-600">
        <strong>차량번호판 · B필러 카드(또는 등록증) · 계기판</strong>을 미리 찍어 두고,
        앨범에서 <strong>한꺼번에 골라</strong> 올리세요 — 등록된 차는 바로 찾고, 새 차는 정보가 미리 채워집니다.
      </p>
      <p className="mt-1 text-[12px] leading-snug text-slate-400">
        사진은 매장 PC 가 읽고 나면 바로 지웁니다. 등록증은 차량 정보 칸 위주로 — 주소·전화는 읽지 않습니다.
      </p>

      <input ref={galRef} type="file" accept="image/*" multiple onChange={(e) => pick(e.target.files)} className="hidden" />
      <div className="mt-2">
        <Button variant="secondary" pending={pending || busy} onClick={() => galRef.current?.click()}>
          <ImageIcon className="size-4" /> 앨범에서 사진 고르기 (한 번에 {MAX_PHOTOS}장까지)
        </Button>
      </div>

      {msg && (
        <Notice tone="error" className="mt-2">
          {msg}
        </Notice>
      )}

      {jobs.length > 0 && (
        <ul className="mt-2 space-y-1 text-[13px]">
          {jobs.map((j) => (
            <li key={j.key} className={j.phase === "실패" ? "text-red-700" : "text-slate-700"}>
              {j.phase === "보내는중" && `${j.name} — 보내는 중…`}
              {j.phase === "읽는중" && `${j.name} — 매장 PC 가 읽는 중… (보통 10~20초)`}
              {j.phase === "완료" && `✓ ${j.note}`}
              {j.phase === "실패" && `✗ ${j.name} — ${j.note}`}
              {j.extra.map((x, i) => (
                <p key={i} className="text-[12px] leading-snug text-amber-700">
                  {x}
                </p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
