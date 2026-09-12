"use server";

/**
 * ⭐ 「이번 주 정리 끝 ✓」 (개편 3단계, 2026-09-12 — 계획서 §1·§3)
 *
 *   7단계 아래 단추 하나. app_setting.weekly_done_at = 오늘(KST) 만 적고 첫 화면으로 —
 *   첫 화면 「마지막 정리 M/D」가 이 값을 읽는다(app-setting.weeklyDoneAt).
 *   🔴 logActivity 없음 — 「이 단계 끝」·「정리 끝」은 돈을 바꾸지 않는다(새 verb 금지, 결정: 서버에 안 남김).
 *   🔴 form action 용 시그니처 — 인자 없음, void. 남은 단계가 있어도 막지 않는다(글자만 「N단계 남음」).
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { hasPerm } from "@/lib/auth";
import { setSetting, WEEKLY_DONE_KEY } from "./app-setting";
import { kstToday } from "./ym";

export async function markWeeklyDone(): Promise<void> {
  if (!(await hasPerm("finance"))) redirect("/"); // 권한 스위치 — 화면과 같은 처리
  await setSetting(WEEKLY_DONE_KEY, kstToday());
  revalidatePath("/finance");
  revalidatePath("/finance/weekly");
  redirect("/finance");
}
