/**
 * ⭐ 올린 직후 자동 대조 — 실행 정본 (권한 검사 없음) (2026-11-17, D-41 에서 auto-recon.ts 로부터 뗌)
 *
 *   화면(auto-recon.autoReconAfterUpload — 권한 「finance」를 본 뒤 여기로)과
 *   PC 수집기의 회계 폴더 자동 업로드(fin-auto-upload.ts)가 같은 것을 부른다.
 *   🔴 "use server" 파일에 두지 않는다 — 권한 없이 부를 수 있는 서버 액션이 되면 안 된다.
 *   🔴 판정은 전부 기존 정본(depositSurePicks·exactPlan·sureTaxPicks) — 임계를 풀지 않는다.
 */
import { confirmSureDepositsCore, markCardSettlementsCore } from "./deposit-core";
import { confirmSureTaxCore } from "./recon-core";
import { confirmSureWithdrawalsCore } from "./purchase-pay-core";
import { autoReconPlan, cleanYms, ZERO_COUNTS, type AutoReconCounts } from "./auto-recon-pure";

export async function runAutoRecon(
  source: string,
  yms: string[],
  uid: number | null,
): Promise<{ counts: AutoReconCounts; errors: string[] }> {
  const counts: AutoReconCounts = { ...ZERO_COUNTS };
  const errors: string[] = [];

  /* 🔴 달은 형식·중복·개수(최대 3)를 순수 파일에서 거른다 — 부른 쪽이 보낸 값을 그대로 믿지 않는다 */
  const months = cleanYms(yms);
  /* 원천마다 「더 해야 할 것」이 다르다 — 법인카드·토스포스 등은 빈 표라 질의 0 */
  const steps = autoReconPlan(source);
  if (months.length === 0 || steps.length === 0) return { counts, errors };

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
          /* 코어가 FOR UPDATE 로 재검사한다 */
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
  return { counts, errors };
}
