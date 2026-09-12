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
 *
 * ⚠️ 껍데기 (주 세션 0단계) — 갈래 B 가 채운다.
 */
import type { AutoReconCounts } from "./auto-recon-pure";

export async function autoReconAfterUpload(
  _source: string,
  _yms: string[],
): Promise<{ ok: true; counts: AutoReconCounts; errors: string[] } | { ok: false; error: string }> {
  throw new Error("todo: 갈래 B — autoReconAfterUpload");
}
