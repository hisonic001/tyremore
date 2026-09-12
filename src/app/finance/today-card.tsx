"use client";

/**
 * ⭐ 첫 화면 「오늘」 칸 — 카드 마감을 그 자리에서 (돈관리 개편 4단계, 2026-09-12)
 *
 *   사장님 결정 4: 「첫 화면 오늘 카드 줄에 **올리기 + 남은 건 대조 + 마감 전부**」.
 *   실측 근거 — 한 달 정리 클릭 245회 중 카드 일마감이 71%. 그 71%가 화면을 옮기지 않고 끝난다.
 *
 *   네 가지 중 하나만 나온다 (위 「카드 마감」 줄의 상태와 짝):
 *     ① POS 자료 없음        → 매출리포트 올리기 (미리보기 없이 바로)
 *     ② 남은 건 있음          → 남은 줄 최대 5개, 카드 화면과 **같은 부품·같은 단추**
 *     ③ 다 맞음, 마감 안 함   → [이 날 마감]
 *     ④ 마감됨               → 아무것도 (위 줄이 이미 「마감됨」이라고 말한다)
 *
 * 🔴 판정도 액션도 여기서 새로 만들지 않는다 — 줄·단추는 `card/pos-parts.tsx`, 서버 액션은
 *    `pos-actions.ts` 정본. 이 화면에만 있는 것(묶어 붙이기 체크·판매 골라서 대조 select)은
 *    슬롯을 비워 두었다 — 그건 카드 화면에서.
 */
import Link from "@/lib/link";
import type { PosDayData } from "@/lib/pos-close";
import type { TodayCard } from "@/lib/today-brief";
import { applyFinUpload } from "@/lib/fin-upload";
import { useConfirm } from "@/components/ui/confirm";
import {
  AppOnlyItem,
  PosCloseButton,
  PosOnlyItem,
  PosUploadInput,
  posDayHref,
  posUploadOkMsg,
  usePosAct,
} from "./card/pos-parts";

/** 첫 화면에 펼쳐 놓을 줄 수 — 넘치면 카드 화면으로 보낸다 (한 칸이 길어지면 첫 화면이 아니다) */
const INLINE_MAX = 5;

export function TodayCardInline({
  today,
  card,
  data,
}: {
  today: string;
  card: TodayCard;
  /** 무거운 조회(posDayData, 12~19질의)는 서버가 **조건부로만** 넘긴다 — 없으면 줄을 안 그린다 */
  data: PosDayData | null;
}) {
  const [ask, confirmDialog] = useConfirm();
  const { pending, msg, error, act } = usePosAct();

  // ④ 마감된 날은 아무것도 — 위 줄이 이미 「마감됨」이다
  if (card.closed) return null;

  /* 「남은 건」 = 사유 없는 것. posDayData 의 openN 과 같은 규칙(pos-close.ts:658) */
  const posOpen = data ? data.posOpen.filter((p) => !p.note) : [];
  const appOpen = data ? data.appOpen.filter((a) => !a.note) : [];
  const shownPos = posOpen.slice(0, INLINE_MAX);
  const shownApp = appOpen.slice(0, Math.max(0, INLINE_MAX - shownPos.length));
  const rest = posOpen.length + appOpen.length - shownPos.length - shownApp.length;

  return (
    <div className="pl-6">
      {error && <p className="mt-1 rounded-lg bg-red-50 p-1.5 text-xs text-red-700">⚠ {error}</p>}
      {msg && <p className="mt-1 rounded-lg bg-brand-50 p-1.5 text-xs text-brand-700">✓ {msg}</p>}

      {!card.hasPos ? (
        /* ① 올리기 — 토스포스는 ingest 가 파일에 든 날마다 자동 대조까지 이미 한다(fin-ingest.ts:406).
              그래서 올린 뒤 따로 부를 것이 없고, usePosAct 의 router.refresh() 로 숫자가 새로 온다. */
        <PosUploadInput compact pending={pending} onFile={(fd) => act(() => applyFinUpload(fd), posUploadOkMsg)} />
      ) : card.open > 0 && data ? (
        /* ② 남은 건 — 카드 화면과 같은 줄·같은 단추 (슬롯은 비움) */
        <>
          <ul className="mt-1 space-y-1.5">
            {shownPos.map((p) => (
              <PosOnlyItem key={p.id} p={p} day={data.day} pending={pending} act={act} />
            ))}
            {shownApp.map((a) => (
              <AppOnlyItem key={a.key} a={a} day={data.day} pending={pending} act={act} ask={ask} />
            ))}
          </ul>
          {rest > 0 && (
            <Link href={posDayHref(today)} className="mt-1 inline-block text-xs text-slate-500 underline underline-offset-2">
              나머지 {rest}건 → 카드 화면
            </Link>
          )}
        </>
      ) : card.open === 0 ? (
        /* ③ 다 맞음 — 마감 단추만 */
        <div className="mt-1">
          <PosCloseButton day={today} openN={0} closed={null} pending={pending} act={act} />
        </div>
      ) : null}
      {confirmDialog}
    </div>
  );
}
