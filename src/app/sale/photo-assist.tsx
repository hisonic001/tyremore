"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Camera, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { getVinScan, requestVinScan, type ScanRow } from "@/lib/vin-photo";
import { parseVin } from "@/lib/vin";

/**
 * ⭐ 판매 등록 「사진으로 차량 찾기·등록」 (사장님 제안 2026-09-05)
 *
 *   "차량번호 사진 + B필러 사진(혹은 차량등록증) + 주행거리, 세 장의 사진으로
 *    고객 조회와 새로운 고객 등록이 바로 가능하게."
 *
 *   사진을 한 장씩 올리면 매장 PC 대리인이 읽는다(/carinfo 의 사진 읽기와 같은
 *   파이프라인, mode='판매등록' — 번호판·계기판·등록증 소유자 이름까지).
 *   읽은 값은 부모(CustomerPick)로 올려 보내고, 부모가 조회·프리필을 맡는다.
 *
 * 🔴 읽은 값은 자동 확정이 아니다 — 번호판은 검색창에 들어가 결과를 보여 주고,
 *    신규 등록 값은 폼에 미리 채워질 뿐 저장 전에 전부 고칠 수 있다.
 */
export interface PhotoInfo {
  plateNo?: string;
  vin?: string;
  carName?: string;
  modelCode?: string;
  year?: number;
  ownerName?: string;
  odoKm?: number;
  /** 차대번호에서 읽은 제조사 (parseVin 정본) */
  makerName?: string;
}

export function PhotoAssist({ onInfo }: { onInfo: (p: PhotoInfo) => void }) {
  const [pending, start] = useTransition();
  const [scanId, setScanId] = useState<number | null>(null);
  const [scan, setScan] = useState<ScanRow | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  /** 이 판에서 지금까지 읽은 것들 — 사장님이 뭐가 들어갔는지 본다 */
  const [gotLines, setGotLines] = useState<string[]>([]);
  // 🔴 카메라 칸(capture)과 갤러리 칸을 나눈다 — photo-read 와 같은 이유 (한 칸이면 갤러리가 막힌다)
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);

  const busy = scanId !== null && (scan === null || scan.status === "대기" || scan.status === "실행중");

  // 🔴 3초 폴링 — 앞선 확인이 끝나기 전에는 다음 것을 안 쏘고, 탭이 안 보이면 쉰다 (풀러 마비 교훈)
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

  // 완료되면 읽은 것을 부모로 올려 보낸다 — 한 번만
  const reported = useRef<number | null>(null);
  useEffect(() => {
    if (!scan || scan.status !== "완료" || !scan.result || reported.current === scan.id) return;
    reported.current = scan.id;
    const r = scan.result;
    const info: PhotoInfo = {};
    const lines: string[] = [];
    if (r.plateNo) {
      info.plateNo = r.plateNo;
      lines.push(`차량번호 ${r.plateNo}`);
    }
    if (r.vin) {
      info.vin = r.vin;
      lines.push(`차대번호 ${r.vin}`);
      const v = parseVin(r.vin);
      if (v.maker) info.makerName = v.maker.split(" ")[0];
      if (v.year && !r.year) info.year = v.year;
    }
    if (r.carName) {
      info.carName = r.carName;
      lines.push(`차명 ${r.carName}${r.modelCode ? `(${r.modelCode})` : ""}`);
    }
    if (r.modelCode) info.modelCode = r.modelCode;
    if (r.year) {
      info.year = r.year;
      lines.push(`연식 ${r.year}년`);
    }
    if (r.ownerName) {
      info.ownerName = r.ownerName;
      lines.push(`소유자 ${r.ownerName}`);
    }
    if (r.odoKm) {
      info.odoKm = r.odoKm;
      lines.push(`주행거리 ${r.odoKm.toLocaleString("ko-KR")}km`);
    }
    if (lines.length === 0) lines.push("이 사진에서는 읽어낸 것이 없습니다 — 더 가까이서 다시 찍어 보세요");
    setGotLines((prev) => [...prev, lines.join(" · ")]);
    if (Object.keys(info).length > 0) onInfo(info);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan]);

  /** 보내기 전에 긴 변 1600px 로 줄인다 — photo-read 와 같은 규칙 */
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
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("사진을 줄이지 못했습니다");
      ctx.drawImage(img, 0, 0, c.width, c.height);
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
        const r = await requestVinScan(dataUrl, "판매등록");
        if (!r.ok) return setMsg(r.error);
        setScanId(r.scanId);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "사진을 보내지 못했습니다");
      } finally {
        if (camRef.current) camRef.current.value = "";
        if (galRef.current) galRef.current.value = "";
      }
    });
  }

  const read = scan?.status === "완료" ? scan.result : null;

  return (
    <div className="mt-2 rounded-control border border-slate-200 bg-slate-50 p-3">
      <p className="text-[13px] leading-snug text-slate-600">
        <strong>차량번호판</strong> → <strong>B필러 카드(또는 등록증)</strong> → <strong>계기판</strong> 순서로
        한 장씩 찍으면, 등록된 차는 바로 찾고 새 차는 정보가 미리 채워집니다.
      </p>
      <p className="mt-1 text-[12px] leading-snug text-slate-400">
        사진은 매장 PC 가 읽고 나면 바로 지웁니다. 등록증은 차량 정보 칸 위주로 찍어 주세요 — 주소·전화는 읽지 않습니다.
      </p>

      <input ref={camRef} type="file" accept="image/*" capture="environment" onChange={(e) => pick(e.target.files?.[0] ?? null)} className="hidden" />
      {/* 🔴 capture 를 붙이면 갤러리가 안 열린다 — 절대 붙이지 말 것 (photo-read 교훈) */}
      <input ref={galRef} type="file" accept="image/*" onChange={(e) => pick(e.target.files?.[0] ?? null)} className="hidden" />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" pending={pending || busy} onClick={() => camRef.current?.click()}>
          <Camera className="size-4" /> 사진 찍기
        </Button>
        <Button variant="secondary" pending={pending || busy} onClick={() => galRef.current?.click()}>
          <ImageIcon className="size-4" /> 앨범에서 고르기
        </Button>
      </div>

      {busy && <p className="mt-2 text-[13px] text-slate-500">매장 PC 가 사진을 읽고 있습니다 — 보통 10~20초 걸립니다.</p>}
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

      {gotLines.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[13px] text-slate-700">
          {gotLines.map((l, i) => (
            <li key={i}>✓ {l}</li>
          ))}
        </ul>
      )}
      {read && read.warn.length > 0 && (
        <Notice tone="warn" className="mt-2">
          {read.warn.join(" · ")}
        </Notice>
      )}
      {read && read.dropped.length > 0 && (
        <p className="mt-1 text-[12px] leading-snug text-amber-700">믿기 어려워 버린 값: {read.dropped.join(" · ")}</p>
      )}
    </div>
  );
}
