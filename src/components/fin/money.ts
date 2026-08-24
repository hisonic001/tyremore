/**
 * ⭐ 금액 표기 정본 (ERP 구조화 배치1, 2026-08-25) — 6개 파일에 복제돼 있던 won()을 수렴.
 * 🔴 순수 함수 — DB 없음. 서버·클라이언트("use client" *-ui.tsx) 공용.
 */
export const won = (n: number) => n.toLocaleString("ko-KR");
