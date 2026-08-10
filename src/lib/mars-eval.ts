"use server";

/**
 * ⭐ MARS 입력 평가 리포트 설정 (사장님 요청 2026-08-10)
 *
 * 본사(미쉐린) 평가표가 MARS 등록 실적으로 점수를 매긴다 — 사진 근거:
 *   Ⅰ 타이어(MARS 데이터 입력) 45점 = 미쉐린 소매 등록 비율 30 + 타브랜드 등록 수량 15
 *   Ⅱ 비타이어 20점 = 경정비 3대 항목 보유 10 + 서비스 매출 SOA(MARS 등록 기준) 10
 * 리포트 화면은 /reports/mars. 여기는 그 화면의 설정 두 가지를 맡는다:
 *   · 정비사 열람 허용 (계정 관리에서 켠다 — 사장님 요청 "정비사 계정에서도 보이도록")
 *   · 분기별 미쉐린 타겟 수량 (평가표 Ⅰ-1 의 분모 — 본사가 정해 주는 숫자라 손으로 넣는다)
 */

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { getSession, isOwner } from "./auth";

const NOT_OWNER = { ok: false as const, error: "사장님 계정에서만 할 수 있습니다" };

const TECH_ACCESS_KEY = "mars_report_tech";

async function getSetting(key: string): Promise<string | null> {
  const [r] = await db.execute<{ value: string }>(sql`SELECT value FROM app_setting WHERE key = ${key}`);
  return r?.value ?? null;
}

async function putSetting(key: string, value: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO app_setting (key, value, updated_at) VALUES (${key}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `);
}

/** 정비사 열람이 켜져 있는가 — 계정 관리 화면과 /reports/mars 문지기가 같이 쓴다 */
export async function marsReportTechAllowed(): Promise<boolean> {
  return (await getSetting(TECH_ACCESS_KEY)) === "1";
}

/** 지금 로그인한 계정이 MARS 평가 리포트를 볼 수 있는가 */
export async function canViewMarsReport(): Promise<boolean> {
  const s = await getSession();
  if (!s) return false;
  if (s.role === "owner") return true;
  return marsReportTechAllowed();
}

/** 계정 관리의 토글 — 정비사 열람 켜고 끄기 */
export async function setMarsReportTechAccess(
  allowed: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isOwner())) return NOT_OWNER;
  await putSetting(TECH_ACCESS_KEY, allowed ? "1" : "0");
  try {
    revalidatePath("/settings/users");
    revalidatePath("/reports/mars");
  } catch {
    /* 요청 밖 */
  }
  return { ok: true };
}

/** 분기 타겟 수량 읽기 — 없으면 null (리포트가 「타겟을 넣어 주세요」로 안내) */
export async function getMarsQuarterTarget(year: number, quarter: number): Promise<number | null> {
  const v = await getSetting(`mars_target_${year}Q${quarter}`);
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 분기 타겟 수량 저장 — 본사가 알려주는 숫자를 사장님이 넣는다. 0 이하면 지운 것으로 본다 */
export async function setMarsQuarterTarget(
  year: number,
  quarter: number,
  qty: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isOwner())) return NOT_OWNER;
  if (!Number.isInteger(year) || year < 2020 || year > 2100 || ![1, 2, 3, 4].includes(quarter)) {
    return { ok: false, error: "분기가 올바르지 않습니다" };
  }
  const n = Math.round(Number(qty));
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return { ok: false, error: "수량이 올바르지 않습니다" };
  await putSetting(`mars_target_${year}Q${quarter}`, String(n));
  try {
    revalidatePath("/reports/mars");
  } catch {
    /* 요청 밖 */
  }
  return { ok: true };
}
