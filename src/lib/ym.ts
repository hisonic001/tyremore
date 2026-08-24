/**
 * ⭐ 달(YYYY-MM) 계산 공용 — 감사 L3(2026-08-25): 8곳에 복제돼 있던 것을 정본화.
 * 🔴 순수 계산 — DB 없음. 서버·클라이언트 공용.
 */

export const kstToday = (): string => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

/** "YYYY-MM" 에 달을 더한다 */
export function ymAdd(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** 달의 경계 — [start, nextStart) */
export function monthRange(ym: string): { start: string; nextStart: string } {
  return { start: `${ym}-01`, nextStart: `${ymAdd(ym, 1)}-01` };
}

/** ?ym= 쿼리 정리 — 형식이 틀리거나 미래면 이번 달 */
export function pickYm(raw: unknown): string {
  const thisYm = kstToday().slice(0, 7);
  return typeof raw === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) && raw <= thisYm ? raw : thisYm;
}
