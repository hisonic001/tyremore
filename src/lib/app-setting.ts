/**
 * ⭐ app_setting 공용 정본 (2026-09-12, 개편 3단계)
 *
 *   키 하나 = 값 하나(문자열). 전엔 mars-eval·invoice-deadline(+actions)·battery-price 가 제각각
 *   같은 SELECT/UPSERT 를 들고 있었다 — 5단계 「정리」(2026-09-13)에 네 곳 전부 여기로 모았다.
 *   값 형식은 부르는 쪽이 정한다(mars "1"/"0" · invoice_deadline_skip JSON 배열 · 배터리 이력 JSON).
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

/**
 * ⭐ 꺼 둔 「앱 기본 규칙」 이름들 (개편 4단계, 2026-09-12 — 사장님 결정 6)
 *
 *   DESC_RULES(expense-cats.ts)는 코드 상수라 표로 올리지 않는다(cond 가 SQL 조각이다).
 *   대신 **끈 것의 이름만** 여기 적어 두고, 자동 분류가 그 이름을 건너뛴다.
 *   끄면 다음 자료부터 안 붙는다 — 이미 붙은 분류는 그대로(사장님이 정한 것이 언제나 이긴다).
 */
export const DESC_RULES_OFF_KEY = "desc_rules_off";

export async function descRulesOff(): Promise<string[]> {
  const v = await getSetting(DESC_RULES_OFF_KEY);
  if (!v) return [];
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return []; // 값이 깨졌으면 「아무것도 안 껐다」로 본다 — 분류가 멈추는 것보다 낫다
  }
}

export async function setDescRulesOff(names: string[]): Promise<void> {
  await setSetting(DESC_RULES_OFF_KEY, JSON.stringify([...new Set(names)]));
}
