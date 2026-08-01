"use client";

import { useEffect, useRef } from "react";

/**
 * ⭐ 바코드 전역 감지 (D-11 4번)
 *
 * 리더기는 **키보드처럼** 동작한다 — 스캔하면 글자가 아주 빠르게 들어오고 Enter 로 끝난다.
 * 그 특징(빠른 연속 입력 + Enter)을 보고 스캔인지 판정한다.
 *
 * ⭐ **커서 위치와 무관하게** 잡는다.
 *    현장에서는 장갑을 낀 채 화면을 보고 있다. 스캔하기 전에 입력칸을 먼저
 *    눌러야 한다면 아무도 안 쓴다.
 *
 * ⚠️ 사람이 타자를 칠 때는 발동하면 안 된다.
 *    글자 사이 간격이 30ms 를 넘으면 사람으로 본다 (사람 타자는 보통 100ms 이상).
 *    입력칸에 포커스가 있을 때는 그 칸이 알아서 받도록 비켜 준다.
 */
export function useScanner(onScan: (code: string) => void, enabled = true) {
  const buf = useRef("");
  const last = useRef(0);
  const cb = useRef(onScan);
  cb.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      // 사람이 입력칸에 치고 있으면 방해하지 않는다
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;

      const now = Date.now();
      if (now - last.current > 30) buf.current = "";
      last.current = now;

      if (e.key === "Enter") {
        const code = buf.current.trim();
        buf.current = "";
        if (code.length >= 5) {
          e.preventDefault();
          cb.current(code);
        }
        return;
      }
      // 바코드에는 영숫자와 하이픈만 온다
      if (e.key.length === 1 && /[0-9A-Za-z-]/.test(e.key)) buf.current += e.key;
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
