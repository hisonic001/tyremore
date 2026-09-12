"use client";

/**
 * ⭐ ⑥ 지급 대조 — 3층 화면 (개편 3단계, 2026-09-12)
 *
 *   「앱이 자동 대조한 것」(접힘) → 「짝 확실」(출금 = 인보이스 묶음 원단위 일치, 체크 기본 ON —
 *   confirmSureWithdrawals(ym, ids) **한 번**, 서버가 exactPlan 을 재검사하고 bulk 한 줄 남긴다)
 *   → 「확인해 주세요」(거래처는 알겠는데 금액이 딱 안 맞는 출금 — 제안 단추)
 *   → 「손이 필요한 것」(거래처 검색해서 지급 / 접기). 줄은 payables-ui 의 WithdrawalRow 그대로.
 */
import type { WeeklyPayableStep } from "@/lib/weekly-types";
import { confirmSureWithdrawals } from "@/lib/purchase-pay";
import { W, autoReconLabel } from "@/lib/fin-words";
import { won } from "@/components/fin/money";
import { AutoTier, CheckRunList, TierHead } from "@/components/fin/check-run-list";
import { PayBanner, WithdrawalRow, usePayCtx } from "@/app/finance/payables/payables-ui";

export function PayablesFlow({ step }: { step: WeeklyPayableStep }) {
  const ctx = usePayCtx({ remainBySup: new Map(Object.entries(step.remainBySup)) });
  const { ym } = step;

  return (
    <div className="mt-2">
      <PayBanner ctx={ctx} />

      <p className="tabular mt-3 text-sm text-slate-600">
        {W.payable} 잔액 전체 <strong className="text-red-600">{won(step.totalRemain)}원</strong>
      </p>

      {/* 1층 — 앱이 자동 대조한 것 (접힘) */}
      <AutoTier lines={step.auto} />

      {/* 2층 — 짝 확실: 출금 한 줄 = 거래처 인보이스 묶음, 원단위 일치·후보 유일 */}
      {step.sure.length > 0 && (
        <CheckRunList
          tone="sure"
          title={
            <>
              ⚡ {W.tierSure} <span className="tabular">{step.sure.length}</span>건 — 체크해서 한 번에
            </>
          }
          hint={`출금이 거래처 인보이스 합과 원단위까지 맞는 것입니다. 맞으면 그대로, 아니면 체크를 끄고 아래에서 직접 ${W.recon}하세요.`}
          items={step.sure.map((e) => ({
            key: String(e.cashTxnId),
            text: (
              <>
                <span className="tabular text-xs text-slate-500">{e.day}</span> 출금{" "}
                <span className="tabular font-bold text-red-600">−{won(e.amount)}원</span> →{" "}
                <span className="font-medium">{e.supplier}</span>
              </>
            ),
            sub: `← 인보이스 ${e.invoiceNos.length}장 (${e.invoiceNos.join(" · ")})`,
            errLabel: `${e.day} ${e.supplier} ${won(e.amount)}`,
          }))}
          bulk={async (keys) => {
            const r = await confirmSureWithdrawals(ym, keys.map(Number));
            if (!r.ok) return r;
            return {
              ok: true,
              msg:
                `${autoReconLabel(r.n)} 완료 — ${won(r.amount)}원` +
                (r.failed > 0 ? ` · ${r.failed}건은 실패` : "") +
                (r.skipped > 0 ? ` · ${r.skipped}건은 그새 바뀌어 건너뜀` : "") +
                ".",
            };
          }}
          buttonLabel={(n) => `체크한 ${n}건 ${W.recon}`}
          pending={ctx.pending}
        />
      )}

      {/* 3층 — 확인해 주세요: 제안 거래처 있음 */}
      <TierHead title={W.tierCheck} n={step.check.length} />
      {step.check.length > 0 && (
        <ul className="mt-2 space-y-1.5 text-sm">
          {step.check.map((row) => (
            <WithdrawalRow key={row.id} row={row} ctx={ctx} supplierNames={step.supplierNames} />
          ))}
        </ul>
      )}

      {/* 4층 — 손이 필요한 것: 제안 없음 → 거래처 검색 / 접기 */}
      <TierHead title={W.tierHand} n={step.hand.length} />
      {step.hand.length > 0 && (
        <ul className="mt-2 space-y-1.5 text-sm">
          {step.hand.map((row) => (
            <WithdrawalRow key={row.id} row={row} ctx={ctx} supplierNames={step.supplierNames} />
          ))}
        </ul>
      )}

      {/* WithdrawalRow 의 거래처 검색 입력이 찾는 목록 — 화면에 한 번 */}
      <datalist id="pay-supplier-names">
        {step.supplierNames.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {ctx.confirmDialog}
    </div>
  );
}
