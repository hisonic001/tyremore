/**
 * ⭐ 「이번 주 정리」 6단계 정본 (돈관리 개편 1단계, 2026-09-11)
 *
 *   사장님 리듬(매일 저녁 5분 + 주 1회 정리)의 「주 1회」 쪽. 첫 화면 가운데 칸이 이 목록을
 *   보여 주고, 3단계에서 한 줄 흐름(/finance/weekly)이 같은 목록을 단계로 쓴다.
 *
 *   전에는 현황의 칩 6개(page.tsx 인라인)와 마감 체크리스트 9줄(month-close.closeChecklist)이
 *   **서로 다른 목록**이었다 — 미지급은 한쪽이 인라인 SQL, 한쪽이 payablesData 였다.
 *   이제 둘 다 같은 정본 함수(depositOpenCount·expenseOpen·taxOpenCounts·payableTotal…)를 쓴다.
 *
 * 🔴 "use server" 아님 — 조회 전용. 질의 순차(Promise.all 금지).
 */
import { kstToday, ymAdd } from "./ym";
import { uploadCoverage, coverageStatus } from "./upload-coverage";
import { posDaysSummary } from "./pos-close";
import { cardDaySums } from "./card-recon";
import { depositOpenCount, expenseOpen, payableTotal } from "./recon-data";
import { taxOpenCounts } from "./tax-recon";
/* 읽기 전용 파일에서 가져온다 — month-close.ts 가 이 파일을 쓰게 되어(마감 체크리스트 통일, 2026-09-12) 고리를 끊음 */
import { monthCloseStatusRead as monthCloseStatus } from "./month-close-status";

export type WeeklyStepKey = "upload" | "card" | "deposits" | "expenses" | "tax" | "payables" | "close";

export interface WeeklyStep {
  key: WeeklyStepKey;
  /** ① ② … 순서 */
  no: number;
  title: string;
  /** 「남은 16건」 「다 됨」 같은 한 마디 */
  status: string;
  href: string;
  /** 🟡 할 것이 있다 */
  warn: boolean;
  /** ⚪ 아직 때가 아니다 (지난달 마감은 달 초에만) */
  idle?: boolean;
  /** 남은 수 — 진행 막대용. 없으면 null */
  remain: number | null;
}

export interface WeeklySteps {
  ym: string;
  steps: WeeklyStep[];
  /** 끝난 단계 수 / 전체(idle 제외) */
  done: number;
  total: number;
}

export async function weeklySteps(ym: string): Promise<WeeklySteps> {
  const today = kstToday();
  const thisYm = today.slice(0, 7);
  const isThisMonth = ym === thisYm;

  const covSt = coverageStatus(await uploadCoverage(), ym);
  const posDays = await posDaysSummary(ym);
  const posToday = posDays.find((d) => d.day === today);
  const posOpenDays = posDays.filter((d) => !d.closed).length;
  const cardSum = await cardDaySums(ym);
  const depOpen = await depositOpenCount(ym);
  const exp = await expenseOpen(ym);
  const taxBy = await taxOpenCounts(ym);
  const taxOpen = taxBy.buy + taxBy.sell;
  const payable = await payableTotal();

  /* ⑥ 지난달 마감 — 달 초(1~10일)에 지난달이 아직 미마감이면 할 일, 아니면 ⚪ */
  const prevYm = ymAdd(thisYm, -1);
  const dayOfMonth = Number(today.slice(8, 10));
  const prevClose = await monthCloseStatus(prevYm);
  const closeDue = dayOfMonth <= 10 && !prevClose.closed;

  const cardWarn = isThisMonth
    ? !posToday || !posToday.closed
    : posOpenDays > 0 || !cardSum.assocLast || cardSum.diffDays > 0;
  const cardStatus = isThisMonth
    ? !posToday
      ? "오늘 POS 자료 없음"
      : posToday.closed
        ? posOpenDays > 0
          ? `오늘 마감 · 안 된 날 ${posOpenDays}일`
          : "오늘 마감"
        : `오늘 남은 ${posToday.open}건`
    : /* 지난 달 — 문구는 cardWarn 과 같은 순서로 판정한다 (2026-09-12: 전엔 POS 가 다 마감됐으면
         여신협회 자료가 없어도 「N일 다 됨」이라 적혀, 🟡 인데 「다 됨」이라는 거짓 글자가 마감 목록에 떴다) */
      posOpenDays > 0
      ? `안 된 날 ${posOpenDays}일`
      : !cardSum.assocLast
        ? "여신협회 자료 없음"
        : cardSum.diffDays > 0
          ? `차이 난 날 ${cardSum.diffDays}일`
          : posDays.length > 0
            ? `${posDays.length}일 다 됨`
            : "다 맞음";

  const steps: WeeklyStep[] = [
    {
      key: "upload",
      no: 1,
      title: "자료 올리기",
      status: covSt.ok ? "다 올라옴" : `빈 곳 ${covSt.lagging.length}`,
      href: `/finance/upload?ym=${ym}`,
      warn: !covSt.ok,
      remain: covSt.ok ? 0 : covSt.lagging.length,
    },
    {
      key: "card",
      no: 2,
      title: "카드 마감",
      status: cardStatus,
      href: `/finance/card?ym=${ym}${isThisMonth ? `&d=${today}` : ""}`,
      warn: cardWarn,
      remain: isThisMonth ? (posToday ? posToday.open + posOpenDays : null) : posOpenDays || cardSum.diffDays,
    },
    {
      key: "deposits",
      no: 3,
      title: "입금 대조",
      status: depOpen > 0 ? `남은 ${depOpen}건` : "다 됨",
      href: `/finance/deposits?ym=${ym}`,
      warn: depOpen > 0,
      remain: depOpen,
    },
    {
      key: "expenses",
      no: 4,
      title: "지출 분류",
      status: exp.n > 0 ? `남은 ${exp.n}건` : "다 됨",
      href: `/finance/expenses?ym=${ym}`,
      warn: exp.n > 0,
      remain: exp.n,
    },
    {
      key: "tax",
      no: 5,
      title: "계산서 대조",
      status: taxOpen > 0 ? `남은 ${taxOpen}장` : "다 됨",
      href: `/finance/tax?ym=${ym}`,
      warn: taxOpen > 0,
      remain: taxOpen,
    },
    {
      key: "payables",
      no: 6,
      title: "지급 대조",
      status: payable > 0 ? `미지급금 ${Math.round(payable / 10000).toLocaleString("ko-KR")}만` : "다 맞음",
      href: `/finance/payables?ym=${ym}`,
      warn: payable > 0,
      remain: payable > 0 ? 1 : 0,
    },
    {
      key: "close",
      no: 7,
      title: `${Number(prevYm.slice(5, 7))}월 마감`,
      status: prevClose.closed ? "마감됨" : closeDue ? "정리 끝나면" : "달 초에",
      href: `/finance/ledger?ym=${prevYm}`,
      warn: closeDue,
      idle: !closeDue && !prevClose.closed,
      remain: closeDue ? 1 : 0,
    },
  ];
  const live = steps.filter((s) => !s.idle);
  const done = live.filter((s) => !s.warn).length;
  return { ym, steps, done, total: live.length };
}
