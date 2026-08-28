/**
 * ⭐ 지출 분류 상수 (ERP ⑥, 2026-08-25)
 *
 * 🔴 이 파일은 **순수 상수** — DB 를 건드리지 않는다. 화면(클라이언트)과 서버가
 *    같이 쓰므로 recon-data(DB 포함)에 두면 postgres 가 브라우저 번들에 끌려
 *    들어가 빌드가 깨진다 (2026-08-25 실사고 — 그래서 분리했다).
 */

/** 지출 분류 목록 — 화면 칩·검증·손익이 같은 목록을 쓴다 */
export const EXPENSE_CATS = [
  "매입대금",
  "카드대금",
  "내부이체",
  "주주거래",
  "지역화폐정산",
  "임차료",
  "인건비",
  "공과금",
  "세금·보험",
  "수수료",
  /**
   * ⭐ 밥값·접대 (2026-08-27, 전 기간 학습)
   *
   * 법인카드 미분류 222건을 훑어보니 식당 결제가 꾸준한 덩어리였다 —
   * 본죽엔비빔밥 10건 · 속초항생선구이 3건 · 갈비시대 2건 · 진대감 · 족발야시장 · 송도물회…
   * 「기타경비」에 섞어 두면 **밥값이 한 달에 얼마 나가는지 영영 못 본다.**
   * 세무에서도 접대비는 따로 보는 항목이라 나눠 두는 편이 뒤가 편하다.
   */
  "식대·접대",
  "기타경비",
  /**
   * ⭐ 받았던 돈을 돌려준 것 (사장님 결정 2026-08-27)
   *
   *   "박성준(제이)는 예약금 받아놓은 것을 돌려준것."
   *
   * 이건 **경비가 아니라 매출 취소**다. 07-21 에 들어온 500,000원이 「판매입금」으로
   * 7월 매출에 잡혀 있었는데 5일 뒤 돌려줬으니, 그대로 두면 매출이 부풀어 있다.
   * 「기타경비」로 몰면 매출은 여전히 부풀고 경비만 늘어 두 번 틀린다.
   */
  "예약금·환불",
] as const;

/** 손익의 「쓴 돈」에 들어가는 분류 — 매입대금·카드대금·내부이체·주주거래는 제외
 *  (주주거래 = 조준호·이현숙 등 내부 관계자와의 입출금 — 매출도 경비도 아니다)
 *  🔴 「예약금·환불」도 여기 없다 — 경비가 아니라 **번 돈에서 빼는** 것이다 (fin-pl.refunded) */
export const EXPENSE_IN_PL = ["임차료", "인건비", "공과금", "세금·보험", "수수료", "식대·접대", "기타경비"] as const;

/** 받았던 돈을 돌려준 분류 — 손익에서 「번 돈」을 깎는다 (fin-pl 이 이 값을 쓴다) */
export const REFUND_CAT = "예약금·환불";

/** 통장 「[적요] 내용」/카드 가맹점명 → 상대명 원문 (expense_rule 의 key) */
export const payerKeyOf = (source: string, description: string): string => {
  if (source !== "통장") return description.trim();
  const body = description.replace(/^\[[^\]]*\]\s*/, "").trim();
  // 🔴 2025 진행(2026-08-27): 「[현금]」「[CD입금]」처럼 적요가 머리표뿐이면 이름이 빈칸이 됐다 → 머리표를 이름으로
  return body || (description.match(/^\[([^\]]*)\]/)?.[1] ?? "").trim() || description.trim();
};

/**
 * payerKeyOf 와 같은 규칙의 SQL 조각 — `sql.raw(PAYER_KEY_SQL)` 로 쓴다.
 * 🔴 2026 감사 G6(2026-08-26): 같은 정규식을 세 곳이 손으로 복제했고 그중 하나(fin-expense)는
 *    백슬래시가 하나라 통장 줄에 0건 적용됐다 — 「상대별 묶어 붙이기 N건」이 거짓이던 원인.
 *    정규식은 여기 한 벌만. (일반 문자열이라 `\\[` 가 런타임에 `\[` 가 된다)
 */
export const PAYER_KEY_SQL: string =
  "CASE WHEN source = '통장' THEN COALESCE(NULLIF(trim(regexp_replace(description, '^\\[[^\\]]*\\] *', '')), ''), trim(substring(description from '^\\[([^\\]]*)\\]')), trim(description)) ELSE trim(description) END";

/**
 * 같은 규칙에 **컬럼 접두사**를 붙인다 — `payerKeySql("c.")` → `CASE WHEN c.source = ...`
 *
 * 조인이 들어간 질의(같은 상대의 다른 기록 찾기)에서는 접두사가 없으면 컬럼이 모호해진다.
 * 🔴 정규식을 안 쓴다 — 이 파일의 백슬래시는 이미 한 번 사고를 냈다(2026 감사 G6).
 *    `split/join` 이면 백슬래시가 낄 자리가 없다.
 */
export const payerKeySql = (prefix = ""): string =>
  prefix
    ? PAYER_KEY_SQL.split("source").join(prefix + "source").split("description").join(prefix + "description")
    : PAYER_KEY_SQL;


/* ==================================================================
 * 적요 규칙표 — 「적요가 이미 분류를 알려주고 있다」 (사장님 지시 2026-08-27)
 *
 *   "다른 달들의 지출들을 전부 학습해보고 지출 종류와 제안을 업데이트해줘."
 *
 * 2025-01~2026-08 지출 1,647건 28.4억을 전부 훑어 나온 결과다.
 * 미분류 564건 4.16억의 원인은 **분류 종류가 모자라서가 아니었다.**
 *   ① 사장님이 이미 분류한 상대가 규칙 사전에 안 들어가 있었다 (40상대, 분류 충돌 0건)
 *   ② 통장 적요 **머리표**가 이미 분류를 알려주는데 아무도 안 읽고 있었다
 *   ③ 같은 상대가 여러 이름으로 흩어져 있었다 (한화생명NNNN 15건 · 조판용/조판용급여/조판용 월급)
 *
 * 🔴 **근거 없는 규칙은 넣지 않는다.** 아래 `why` 는 전부 실데이터에서 센 숫자다.
 *    짐작으로 넣으면 사장님이 화면을 안 보고 ✓ 만 누르게 되고, 그때부터 손익이 조용히 틀린다.
 *
 * 🔴 **순서가 중요하다.** 「급여」 규칙보다 주주(조준호·이현숙)가 먼저 걸러져야 한다 —
 *    그래서 급여 규칙에 제외 조건을 못 박아 두었다. 순서에 기대지 않는다.
 * ================================================================== */

export interface DescRule {
  /** 화면·보고에 뜨는 이름 */
  name: string;
  category: (typeof EXPENSE_CATS)[number];
  /** SQL 조건 — `description` · `out_amount` 컬럼을 접두사 없이 쓴다 */
  cond: string;
  /** 이 원천에만 적용. 없으면 통장·카드 둘 다 */
  source?: "통장" | "법인카드";
  /** 왜 이 규칙인가 — 실데이터 근거 */
  why: string;
}

/** 주주 두 분 — 급여·이체가 「인건비」로 새지 않게 어디서든 먼저 뺀다 */
const NOT_SHAREHOLDER = "description NOT LIKE '%조준호%' AND description NOT LIKE '%이현숙%'";

export const DESC_RULES: DescRule[] = [
  /* ── 내부 계좌 사이 이동 ── */
  {
    name: "유동성 자금 이동",
    category: "내부이체",
    cond: "description LIKE '[유동CC]%'",
    source: "통장",
    why: "이 머리표 313건이 **전부** 내부이체로 분류돼 있었다 (예외 0건)",
  },

  /* ── 은행이 떼어 가는 것 ── */
  {
    name: "이체 수수료",
    category: "수수료",
    cond: "description LIKE '[BZ수수]%' AND out_amount <= 2000",
    source: "통장",
    why: "이 머리표 43건이 **전부 500원**이다 — 건당 이체 수수료",
  },

  /* ── 세금·4대보험 ── */
  {
    name: "세금 납부(공과 머리표)",
    category: "세금·보험",
    cond: "description LIKE '[BZ공과]%'",
    source: "통장",
    why: "분류된 7건이 전부 세금·보험이고, 미분류 11건도 전부 국세납부·세금납부·강원도지방세다",
  },
  {
    name: "보험료",
    category: "세금·보험",
    cond: "description LIKE '[FB보험]%' OR description LIKE '[보험료]%'",
    source: "통장",
    why: "이 두 머리표에서 분류된 6건이 전부 세금·보험",
  },
  {
    name: "국민연금",
    category: "세금·보험",
    cond: "description LIKE '[연금]%' OR description LIKE '%국민연금%'",
    why: "머리표 [연금] 분류분 2건 전부 세금·보험",
  },
  {
    name: "건강보험",
    category: "세금·보험",
    cond: "description LIKE '[의보]%' OR description LIKE '%국민건강%'",
    why: "머리표 [의보] 분류분 2건 전부 세금·보험",
  },
  {
    name: "생명보험료",
    category: "세금·보험",
    cond: "description LIKE '%한화생명%'",
    why: "15건이 매달 같은 날 1,011,600원 — 뒤 숫자(04027·05028…)는 회차라 이름이 매달 달라 규칙이 안 붙고 있었다",
  },
  {
    name: "국세·지방세",
    category: "세금·보험",
    cond: "description LIKE '%국세%' OR description LIKE '%지방세%' OR description LIKE '%법인세%' OR description LIKE '%세금납부%'",
    why: "미분류 [BZ공과] 11건의 실체이고, 2025-08 법인세 2,942,650원도 여기 걸린다",
  },

  /* ── 공과금 ── */
  {
    name: "전기요금",
    category: "공과금",
    cond: "description LIKE '[FB전기]%' OR description LIKE '%한국전력%' OR description LIKE '%전기세%' OR description LIKE '%전기요금%'",
    why: "머리표 [FB전기] 분류분 2건 전부 공과금 · 한국전력공사 5건 277만원이 미분류로 남아 있었다",
  },
  {
    name: "통신요금",
    category: "공과금",
    cond: "description LIKE '[통신]%'",
    source: "통장",
    why: "이 머리표 2건이 전부 공과금 (예외 0건)",
  },

  /* ── 카드 대금 ── */
  {
    name: "카드 대금",
    category: "카드대금",
    cond:
      "description LIKE '[카드결]%' OR description LIKE '%카드법인%' OR description LIKE '%법인결제%' " +
      "OR description LIKE '%카드결제%'",
    source: "통장",
    why: "머리표 [카드결] 분류분 13건이 전부 카드대금 · 신한카드법인 6건·우리카드결제 2건이 미분류였다",
  },

  /* ── 사람에게 나간 돈 ── */
  {
    name: "직원 급여",
    category: "인건비",
    cond:
      "(description LIKE '[BZ급여]%' OR description LIKE '%급여%' OR description LIKE '%월급%') AND " +
      NOT_SHAREHOLDER,
    source: "통장",
    why:
      "조판용(티스테)·조효진은 사장님이 이미 「인건비」로 붙이셨다(각 2건). " +
      "같은 사람의 나머지 건과 김학수·이반·압둘러 급여가 미분류로 남아 있었다. " +
      "🔴 조준호·이현숙(주주)은 조건에서 못 박아 뺐다 — 순서에 기대지 않는다",
  },

  /* ── 자리 ── */
  {
    name: "임대료",
    category: "임차료",
    cond: "description LIKE '%임대료%' OR description LIKE '%부동산임대%'",
    why: "부동산임대 945만원·창고임대료 160만원이 미분류였다. 「임차료」 분류는 있는데 붙은 게 0건이었다",
  },
];

/**
 * 규칙 조건에 컬럼 접두사를 붙인다 — `descRuleSql(r.cond, "c.")`
 * 🔴 정규식을 안 쓴다 (이 파일의 백슬래시는 2026 감사 G6 에서 한 번 사고를 냈다).
 */
export const descRuleSql = (cond: string, prefix = ""): string =>
  prefix
    ? cond.split("description").join(prefix + "description").split("out_amount").join(prefix + "out_amount")
    : cond;

/** 카드 정산 입금 적요 패턴 — SQL 3곳(fin-ingest·recon-data·카드 대사)이 이 한 벌을 쓴다.
 *  🔴 감사 L1(2026-08-25): 세 곳에 복제돼 있던 것을 정본화 — 카드사 추가는 여기서만. */
export const CARD_SETTLE_PATTERN_SQL =
  // 🔴 2026 감사 G10: 「[FB이체] 현대5816」 — '현' 뒤에 '대'가 와서 놓쳤다 → 현대?
  // 🔴 사장님 지적(2026-08-26): 「[FB자금] MAXRUN」은 온라인몰 맥스런의 판매 대금 정산 — 카드정산이 아니다
  /**
   * 🔴 2회차 수리 C1(2026-08-28): **카드사 수수료 환급**도 카드정산이다.
   *
   *    같은 성격의 입금 6건이 적요 **머리표**에 따라 두 분류로 갈려 있었다 (실측, 대부분 2025-03-31):
   *      · 「[매출표] SH수수료환급」 96,574 · 「[FB자금] 롯데수수료환급」 5,760  → 카드정산 (머리표가 걸림)
   *      · 「[타행PC] KB환급11694」 94,964 · 「[타행FB] 삼성환급946」 65,175
   *        「[타행PC] NH우대환급」 129,486 · 「[타행PC] 현대우대환급」 104,886 → 기타입금 (머리표가 안 걸림)
   *    카드사 이름 + (우대)환급 꼴을 함께 잡는다. 사장님 결정(2026-08-28): 「카드정산」으로 통일.
   *
   * 🔴 카드사 이름을 앞에 못 박았다 — '환급' 두 글자만 보면 「[국세] 속초세무서」 같은
   *    세무서 환급까지 끌려온다. 그건 「기타입금」이 맞다.
   */
  "((description LIKE '%FB자금%' OR description LIKE '%매출표%' " +
  "OR description ~ '\\] ?(KB|NH|하나|현대?|우|삼성|롯데|신한|비씨|BC|SHC)[0-9]' " +
  "OR description ~ '\\] ?(KB|NH|하나|현대|우리|삼성|롯데|신한|비씨|BC|SHC)[가-힣]{0,3}환급') " +
  "AND description NOT ILIKE '%MAXRUN%')";
