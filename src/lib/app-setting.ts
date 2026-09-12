/**
 * ⭐ app_setting 공용 정본 (2026-09-12, 개편 3단계)
 *
 *   키 하나 = 값 하나(문자열). 전엔 mars-eval·invoice-deadline·battery-price 가 제각각
 *   같은 UPSERT 를 들고 있었다 — 네 번째를 또 만들지 않으려고 여기로 모은다.
 *   (기존 세 곳은 이번엔 손대지 않는다 — 동작 변화 없이 diff 만 늘어서. 별건.)
 *
 * 🔴 "use server" 아님 — 액션은 각자 파일에서 권한을 본 뒤 이걸 부른다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

export async function getSetting(key: string): Promise<string | null> {
  const [r] = await db.execute<{ value: string }>(sql`SELECT value FROM app_setting WHERE key = ${key}`);
  return r?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO app_setting (key, value, updated_at) VALUES (${key}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `);
}

/** 「이번 주 정리 끝 ✓」 를 마지막으로 누른 날 (YYYY-MM-DD) — 첫 화면 「마지막 정리 M/D」 */
export const WEEKLY_DONE_KEY = "weekly_done_at";

export async function weeklyDoneAt(): Promise<string | null> {
  const v = await getSetting(WEEKLY_DONE_KEY);
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
