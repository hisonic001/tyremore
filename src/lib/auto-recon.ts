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
import { confirmSureDepositsCore, markCardSettlementsCore } from "./deposit-core";
import { confirmSureTaxCore } from "./recon-core";
import { confirmSureWithdrawalsCore } from "./purchase-pay-core";
import { revalidateFinance } from "./fin-revalidate";
import { autoReconPlan, cleanYms, ZERO_COUNTS, type AutoReconCounts } from "./auto-recon-pure";

export async function autoReconAfterUpload(
  source: string,
  yms: string[],
): Promise<{ ok: true; counts: AutoReconCounts; errors: string[] } | { ok: false; error: string }> {
  if (!(await hasPerm("finance"))) return { ok: false, error: "돈 관리 권한이 없습니다 — 사장님이 설정→계정에서 켤 수 있습니다" };

  const counts: AutoReconCounts = { ...ZERO_COUNTS };
  const errors: string[] = [];

  /* 🔴 달은 형식·중복·개수(최대 3)를 순수 파일에서 거른다 — 화면이 보낸 값을 그대로 믿지 않는다 */
  const months = cleanYms(yms);
  /* 원천마다 「더 해야 할 것」이 다르다 — 법인카드·토스포스 등은 빈 표라 질의 0 */
  const steps = autoReconPlan(source);
  if (months.length === 0 || steps.length === 0) return { ok: true, counts, errors };

  const uid = (await getSession())?.uid ?? null;

  /* 🔴 순차 — 연결 자리 3개뿐이라 Promise.all 금지. 한 단계가 터져도 다음 단계·다음 달은 돈다 */
  for (const ym of months) {
    for (const step of steps) {
      try {
        if (step === "cardSettle") {
          counts.cardSettle += await markCardSettlementsCore(ym, uid);
        } else if (step === "deposits") {
          const r = await confirmSureDepositsCore(ym, uid);
          counts.deposits += r.tax + r.quote;
        } else if (step === "withdrawals") {
          /* 코어를 바로 부른다 — 권한은 이 액션 머리에서 이미 봤고, 코어가 FOR UPDATE 로 재검사한다 */
          const r = await confirmSureWithdrawalsCore(ym, uid);
          counts.withdrawals += r.n;
        } else {
          const direction = step === "tax:매입" ? "매입" : "매출";
          const r = await confirmSureTaxCore(ym, direction, uid, "자동");
          counts.tax += r.applied;
        }
      } catch (e) {
        errors.push(`${ym} ${step}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  revalidateFinance();
  return { ok: true, counts, errors };
}
