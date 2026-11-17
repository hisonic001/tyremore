"use server";

/**
 * ⭐ 올린 직후 자동 대조 (개편 4단계, 2026-09-12; 사장님 결정 2 「올린 직후 자동 — 단추 없음」)
 *
 *   화면(올리기)이 **큐가 끝난 뒤** 이걸 한 번 부른다. 왜 올리기와 같은 요청에 안 붙였나:
 *   파일 하나 반영이 이미 질의 ~37개이고 여기에 자동 대조 세 벌을 얹으면 100+ 가 된다.
 *   다중 파일이면 그게 연속이고, 연결 자리는 3개뿐이라 매장 앱이 멎는다(2026-08-05·08-11 전례).
 *   또 applyFinUpload 의 통짜 catch 가 자동 대조 실패를 「반영 못 했습니다」로 둔갑시킨다.
 *
 * 🔴 판정은 전부 기존 정본(depositSurePicks·exactPlan·sureTaxPicks) — 임계를 풀지 않는다.
 * 🔴 기록은 코어가 각자 bulk 한 줄씩 — 이 액션은 아무것도 안 남긴다(이중 기록 금지).
 */
import { getSession, hasPerm } from "@/lib/auth";
import { revalidateFinance } from "./fin-revalidate";
import { runAutoRecon } from "./auto-recon-run";
import type { AutoReconCounts } from "./auto-recon-pure";

export async function autoReconAfterUpload(
  source: string,
  yms: string[],
): Promise<{ ok: true; counts: AutoReconCounts; errors: string[] } | { ok: false; error: string }> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };
  const uid = (await getSession())?.uid ?? null;
  /* 실행 정본은 auto-recon-run.ts — PC 수집기의 회계 폴더 자동 업로드도 같은 것을 부른다 (D-41) */
  const r = await runAutoRecon(source, yms, uid);
  revalidateFinance();
  return { ok: true, ...r };
}
