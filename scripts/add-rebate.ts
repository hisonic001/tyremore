/**
 * ⭐ 뒷마진(제조사 장려금) 표 — promo(프로모션 등록)·rebate_entry(확정 금액) (2026-09-09)
 *
 *   사장님: "타이어 회사들의 계절별 행사·리베이트가 마진에 반영되지 않음.
 *            기간별 프로모션은 기간이 지나면 사라져야 하고, 추가분은 내가 올려줌."
 *   두 전문가(매장 운영·세무) 합의: 앞마진(건별 스냅샷)은 불변, 뒷마진은 월별
 *   별도 층 — 추정(미확정)과 확정(크레딧 메모·상계 도착)을 분리해서 보여준다.
 *
 *   ⚠ settle_type='에누리'(다음 세금계산서 공급가액이 깎여 오는 것)는 이미 매입
 *     원가에 반영되므로 추정 계산에서 제외한다 — 이중 계상 방지 (세무 자문).
 *
 * 실행: npx tsx --env-file=.env.local scripts/add-rebate.ts   (멱등)
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS promo (
      id bigserial PRIMARY KEY,
      title text NOT NULL UNIQUE,
      brand text,
      kind text NOT NULL CHECK (kind IN ('매입타겟','판매기표가율','판매본당','품목매입율','본수타겟','수기전용')),
      params jsonb NOT NULL DEFAULT '{}',
      buy_from date, buy_to date,
      sell_from date, sell_to date,
      qualified boolean,
      settle_type text NOT NULL DEFAULT '장려금' CHECK (settle_type IN ('장려금','에누리')),
      active boolean NOT NULL DEFAULT true,
      memo text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rebate_entry (
      id bigserial PRIMARY KEY,
      ym text NOT NULL,
      promo_id bigint REFERENCES promo(id),
      title text NOT NULL,
      amount integer NOT NULL,
      status text NOT NULL DEFAULT '확정' CHECK (status IN ('확정','정산완료')),
      received_on date,
      memo text,
      created_by bigint,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  // 시드 — title UNIQUE 로 멱등. 2026-09-09 기준 알려진 프로그램 전부.
  const seeds: {
    title: string; brand: string | null; kind: string; params: Record<string, unknown>;
    buyFrom?: string; buyTo?: string; sellFrom?: string; sellTo?: string;
    qualified?: boolean | null; memo?: string;
  }[] = [
    {
      title: "미쉐린 타겟 보너스 3%",
      brand: "MI", kind: "매입타겟",
      params: { monthlyTarget: 37_500_000, rate: 0.03 },
      buyFrom: "2026-01-01", buyTo: "2026-12-31",
      memo: "월 매입 기표가(VAT제외) 3,750만 달성 시 3% — 익월 매출할인 적용 (2026 판매장려금 계약 별지2)",
    },
    {
      title: "미쉐린 퀄리티 오딧 보너스",
      brand: "MI", kind: "수기전용",
      params: {},
      buyFrom: "2026-01-01", buyTo: "2026-12-31",
      memo: "분기 평가점수별 1.5~4% (익익월 매출할인) — 점수 통보 후 확정 등록만",
    },
    {
      title: "미쉐린 MARS 차량점검 프로모션 2%",
      brand: "MI", kind: "판매기표가율",
      params: { rate: 0.02 },
      sellFrom: "2026-08-01", sellTo: "2026-10-31",
      memo: "MARS 매출 송장 + 차량점검보고서 등록 건 기표가 2% — 11월말 크레딧 메모 (승용, 경트럭·BFG 제외)",
    },
    {
      title: "미쉐린 멤버십 캠페인 (본당 1만/1.5만)",
      brand: "MI", kind: "판매본당",
      params: { le19: 10_000, ge20: 15_000 },
      sellFrom: "2026-10-01", sellTo: "2026-10-31",
      qualified: null,
      memo: "자격: 9월 매입 타겟 달성 대리점 (타겟액 별도 확인 필요) — 10월 멤버십 등록 판매분, 19인치 이하 1만·20인치 이상 1.5만",
    },
    {
      title: "미쉐린 9월 특판 15% (PRIMACY TOUR A/S 245/45R20)",
      brand: "MI", kind: "품목매입율",
      params: { cai: "851393", rate: 0.15, listPrice: 422_000 },
      buyFrom: "2026-09-01", buyTo: "2026-09-30",
      memo: "CAI 851393 9월 매입분 15% — 수량 제한 없음, 재고 소진 시 조기 종료",
    },
    {
      title: "금호 교환권 캠페인 (GT Pro·마제스티X·EDGE)",
      brand: "KM", kind: "판매본당",
      params: {
        groups: [
          { label: "GT Pro·마제스티X (2본당 3만원)", patterns: ["%GT PRO%", "%MAJESTY X%"], perQty: 2, amount: 30_000 },
          { label: "마제스티 EDGE (2본당 1만원)", patterns: ["%EDGE%"], perQty: 2, amount: 10_000 },
        ],
      },
      sellFrom: "2026-08-12", sellTo: "2026-09-26",
      memo: "연장 공지 기준 — SO(판매) 8/12~9/26, SI(매입) 조건 8/5~9/19. 상품권(교환권)으로 지급",
    },
    {
      title: "금호 9월 운영안 (볼륨·재고·페이백)",
      brand: "KM", kind: "수기전용",
      params: {},
      buyFrom: "2026-09-01", buyTo: "2026-09-30",
      memo: "볼륨 지원(230본~ 1~4%)·과다재고 3~5%·페이백(TA92 1.5만/TA91 1.2만/HP71 5천/HP51 6~8천, 익월 감가)·교체지원금(본당 1만, 월한도 200만) — 대부분 에누리·감가 형태라 자동 추정 없음, 도착분만 확정 등록 (이중 계상 방지)",
    },
    {
      title: "미쉐린 데미지 프리·AS 정산",
      brand: "MI", kind: "수기전용",
      params: {},
      sellFrom: "2026-01-01", sellTo: "2026-12-31",
      memo: "데미지 프리 쿠폰 무상 교체(본사가 타이어값 반환)·OE 타이어 AS 조치비 — ㈜트랜스코스모스 이름으로 입금됨. 도착하면 확정 등록 (2026-09-10 사장님 확인)",
    },
    {
      title: "콘티넨탈 RSP",
      brand: "CO", kind: "본수타겟",
      params: { monthlyQty: 50, monthlyBonus: 300_000 },
      sellFrom: "2026-01-01", sellTo: "2026-12-31",
      memo: "월 50본(연 600본) 타겟 — 달성 확정 전 추정 0원 원칙, 보너스는 구매금액 상계",
    },
  ];

  let added = 0;
  for (const s of seeds) {
    const r = await db.execute<{ id: number }>(sql`
      INSERT INTO promo (title, brand, kind, params, buy_from, buy_to, sell_from, sell_to, qualified, memo)
      VALUES (${s.title}, ${s.brand}, ${s.kind}, ${JSON.stringify(s.params)}::jsonb,
              ${s.buyFrom ?? null}, ${s.buyTo ?? null}, ${s.sellFrom ?? null}, ${s.sellTo ?? null},
              ${s.qualified ?? null}, ${s.memo ?? null})
      ON CONFLICT (title) DO NOTHING
      RETURNING id
    `);
    added += r.length;
  }
  /* 실증 검증 반영 (2026-09-09 저녁, 통장·계산서·인보이스 3방향 대조):
     - 멤버십 자격 타겟 = 계약서 월 타겟 3,750만 (사장님 확인) → 자동 판정 파라미터
     - 금호 볼륨·특판은 에누리 확정 (할인율 40~54% = 운영안 총지원율, 단가 선반영) */
  await db.execute(sql`
    UPDATE promo SET params = params || '{"qualifyYm":"2026-09","qualifyTarget":37500000}'::jsonb
    WHERE title = '미쉐린 멤버십 캠페인 (본당 1만/1.5만)'
  `);
  await db.execute(sql`
    UPDATE promo SET memo = '실증 확정: 볼륨·특판 지원은 인보이스 단가 선반영(에누리, 할인율 40~54% 실측) — 여기 넣으면 이중 계상. 페이백(익월 감가)·상품권·교체지원금 도착분만 확정 등록'
    WHERE title = '금호 9월 운영안 (볼륨·재고·페이백)'
  `);

  /* 9/4 트랜스코스모스 입금 252,340원 = 데미지 프리 쿠폰 사용건 정산 (사장님
     확인 2026-09-10). 원 시공이 앱 도입 전으로 보여 입금 확인월(9월) 귀속 */
  /* 🔴 9/4 데미지 쿠폰 정산 25.2만은 **뒷마진에서 뺀다** (사장님 지적 2026-09-10:
     "우리가 사놓은 물건을 쿠폰으로 내준 건데 마진이 낮은 것 아닌가"). 맞는 지적이다 —
     그 돈은 나간 타이어 원가를 돌려받은 것이라 대부분이 마진이 아니다(공급가 환산
     22.9만 vs EV6 19인치 미쉐린 원가 약 20만 → 실제 마진 1~3만). 원 시공이 앱 도입
     전이라 원가 스냅샷이 없어 순액을 못 내므로 아예 빼서 과대계상을 없앤다.
     통장 기록은 그대로 남는다. 앞으로는 판매 등록의 「본사청구」로 넣는다. */
  await db.execute(sql`
    DELETE FROM rebate_entry WHERE ym = '2026-09' AND title = '미쉐린 데미지 프리 쿠폰 정산'
  `);
  await db.execute(sql`
    UPDATE promo SET memo = '데미지 프리 쿠폰 무상 교체·OE 타이어 AS 는 이제 판매 등록의 「본사청구」로 넣습니다 — 재고·원가·마진이 자동으로 잡히고 받을 돈도 미쉐린 앞으로 쌓입니다. 여기(뒷마진)에는 넣지 마세요: 원가를 돌려받는 돈이라 전액을 마진으로 세면 부풀어 보입니다 (2026-09-10)'
    WHERE title = '미쉐린 데미지 프리·AS 정산'
  `);

  const [n] = await db.execute<{ p: number; e: number }>(
    sql`SELECT (SELECT count(*)::int FROM promo) p, (SELECT count(*)::int FROM rebate_entry) e`,
  );
  console.log(`promo ${n.p}건(새로 ${added}) · rebate_entry ${n.e}건 — 준비됨`);
  process.exit(0);
}
main();
