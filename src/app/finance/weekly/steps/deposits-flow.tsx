"use client";

/**
 * ⭐ ③ 입금 대조 — 3층 화면 (개편 3단계, 2026-09-12)
 *
 *   「앱이 자동 대조한 것」(접힘) → 「짝 확실」(체크 기본 ON, confirmSureDeposits(ym, ids) **한 번**)
 *   → 「확인해 주세요」(정본이 낸 후보 1개짜리 — 카드 그대로, 실행은 카드 안 낱장 단추)
 *   → 「손이 필요한 것」(나머지 카드 + 이체 판매 목록).
 *   카드·목록은 deposits-ui 조각 그대로(DepositCard·TransferSalesList) — 판정·액션을 여기서 새로 만들지 않는다.
 *   밖으로 나가는 링크는 「정비 내역에 등록하러 →」 하나(?back=weekly 로 돌아온다) — TransferSalesList 와,
 *   짝을 못 찾은 입금 카드(5단계 부채 v, 2026-09-13)에.
 *   🔴 개편 5단계(2026-09-13): 기존 화면 /finance/deposits 도 이 조각을 그린다(standalone) — 같은 3층.
 */
import type { DepositSuggestion } from "@/lib/recon-data";
import type { WeeklyDepositStep } from "@/lib/weekly-types";
import { confirmSureDeposits } from "@/lib/fin-deposits";
import { W, autoReconLabel } from "@/lib/fin-words";
import { won } from "@/components/fin/money";
import { AutoTier, CheckRunList, TierHead } from "@/components/fin/check-run-list";
import {
  CardSettleBanner,
  DepositBanner,
  DepositCard,
  TransferSalesList,
  useDepositCtx,
} from "@/app/finance/deposits/deposits-ui";

/** 짝 확실 한 줄의 「무엇과」 — 정본 후보 중 유일한 것(묶음 · 계산서 1 · 판매 1)을 글자로. 판정 아님, 표시만 */
function sureWith(step: WeeklyDepositStep, s: DepositSuggestion): string | null {
  const b = step.bundles[s.dep.id];
  if (b) return `계산서 ${b.invoiceIds.length}장 합 (${b.parts.join(" + ")})`;
  const t = step.taxCands[s.dep.id];
  if (t && t.length === 1) return t[0].label;
  if (s.quotes.length === 1) return s.quotes[0].label;
  return null;
}

/**
 * @param standalone 기존 화면(/finance/deposits, 개편 5단계 2026-09-13)에서 그릴 때 true —
 *   정비 내역 링크에 `back=weekly` 를 안 붙인다(/sales 화이트리스트는 back=weekly 만 받는데, 거기서
 *   돌아올 곳은 흐름이 아니라 이 화면이다). 서버 조각이 넘기므로 함수가 아닌 값으로 받는다.
 */
export function DepositsFlow({ step, standalone = false }: { step: WeeklyDepositStep; standalone?: boolean }) {
  const ctx = useDepositCtx();
  const { ym } = step;
  const sureSet = new Set(step.sure);
  const sure = step.data.open.filter((s) => sureSet.has(s.dep.id));
  const saleHref = (d: string) =>
    `/sales?range=range&from=${d}&to=${d}` + (standalone ? "" : `&back=weekly&step=3&ym=${ym}`);
  const handN = step.hand.length + step.transfers.length;

  return (
    <div className="mt-2">
      <DepositBanner ctx={ctx} />
      <CardSettleBanner data={step.data} ym={ym} ctx={ctx} />

      {/* 1층 — 앱이 자동 대조한 것 (접힘) */}
      <AutoTier lines={step.auto} />

      {/* 2층 — 짝 확실: 체크 기본 ON, 서버가 sure 를 재계산해 맵에 있는 id 만 대조(계획서 §3) */}
      {sure.length > 0 && (
        <CheckRunList
          tone="sure"
          title={
            <>
              ✔ {W.tierSure} <span className="tabular">{sure.length}</span>건 — 체크해서 한 번에
            </>
          }
          hint={`앱이 짝을 확신하는 입금입니다. 맞으면 그대로, 아니면 체크를 끄고 아래에서 직접 ${W.recon}하세요.`}
          items={sure.map((s) => {
            const w = sureWith(step, s);
            return {
              key: String(s.dep.id),
              text: (
                <>
                  <span className="tabular text-xs text-slate-500">{s.dep.at}</span>{" "}
                  <span className="font-medium">{s.dep.description}</span> ·{" "}
                  <span className="tabular font-bold text-emerald-700">+{won(s.dep.amount)}원</span>
                </>
              ),
              sub: w ? `← ${w}` : undefined,
              errLabel: `${s.dep.at} ${s.dep.description} ${won(s.dep.amount)}`,
            };
          })}
          /* ⭐ 머리에 「이번 일괄은 규칙 학습 안 함」 하나 (개편 4단계, 2026-09-12 — 결정 7).
             기본은 학습 ON — 짝 확실은 앱이 확신하는 것이라 상대를 기억해 두는 게 맞다 */
          learnToggle
          bulk={async (keys, { learn }) => {
            const r = await confirmSureDeposits(ym, keys.map(Number), { learn });
            if (!r.ok) return r;
            return {
              ok: true,
              msg:
                `${autoReconLabel(r.tax + r.quote)} 완료 (계산서 ${r.tax} · 판매 ${r.quote})` +
                (r.failed > 0 ? ` · ${r.failed}건은 실패` : "") +
                (r.skipped > 0 ? ` · ${r.skipped}건은 그새 바뀌어 건너뜀` : "") +
                ".",
            };
          }}
          buttonLabel={(n) => `체크한 ${n}건 ${W.recon}`}
          pending={ctx.pending}
        />
      )}

      {/* 3층 — 확인해 주세요: 후보가 딱 1개인 입금, 카드 안 단추로 낱장 대조 */}
      <TierHead title={W.tierCheck} n={step.check.length} />
      {step.check.length > 0 && (
        <ul className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">
          {step.check.map((s) => (
            <DepositCard key={s.dep.id} s={s} ym={ym} sure={false} taxCands={step.taxCands} bundles={step.bundles} ctx={ctx} saleHref={saleHref} />
          ))}
        </ul>
      )}

      {/* 4층 — 손이 필요한 것: 후보 여럿·없음·미수금 후보 + 이체 판매 */}
      <TierHead title={W.tierHand} n={handN} />
      {step.hand.length > 0 && (
        <ul className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">
          {step.hand.map((s) => (
            <DepositCard key={s.dep.id} s={s} ym={ym} sure={false} taxCands={step.taxCands} bundles={step.bundles} ctx={ctx} saleHref={saleHref} />
          ))}
        </ul>
      )}
      <TransferSalesList transfers={step.transfers} ctx={ctx} saleHref={saleHref} />

      {ctx.confirmDialog}
    </div>
  );
}
