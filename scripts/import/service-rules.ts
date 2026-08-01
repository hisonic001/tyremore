/**
 * 서비스·공임 자동계산 규칙 — 이관 순서 3번 (docs/09 5장)
 *
 * MARS 「패스트핏 서비스 목록」 69건에 수량 규칙·인치 구간·국산수입을 지정한다.
 * 문서에서 "반나절 수작업"으로 잡았던 항목. 한 번 해두면 견적이 평생 자동 계산된다.
 *
 * ⚠️ 인치 구간이 교환과 밸런스에서 다르다.
 *      교환   : ≤17 / 18~20 / ≥21
 *      밸런스 : ≤17 / 17.1~20 / ≥21
 *    20인치 타이어는 교환이 "18인치 이상", 밸런스가 "20인치 이하"에 걸린다.
 *    사람이 고르면 반드시 틀린다. 그래서 규격에서 자동 판정한다.
 *
 * ⚠️ 휠밸런스는 per_2_units 다. 4본이면 ⌈4÷2⌉ = 2회 청구.
 *    이 규칙이 없으면 매번 절반만 청구하게 된다.
 */

export type QtyRule = "per_unit" | "per_2_units" | "per_job";

export interface ServiceRule {
  shortName?: string;
  qtyRule: QtyRule;
  rimMin?: number;
  rimMax?: number;
  forImported?: boolean; // 생략 = 공통
  isTireRelated?: boolean;
  autoSuggest?: boolean; // 타이어 견적에 기본 체크 상태로 뜬다
  isFavorite?: boolean; // 버튼으로 노출
}

/** MARS 서비스 번호 → 규칙. 여기 없는 번호는 per_job 기본값이 적용된다. */
export const SERVICE_RULES: Record<string, ServiceRule> = {
  // ── 타이어 장착 공임 (본당) ─────────────────────────────
  "S001/1180": { shortName: "장착", qtyRule: "per_unit", rimMax: 17, isTireRelated: true, autoSuggest: true },
  "S001/1181": { shortName: "장착", qtyRule: "per_unit", rimMin: 17.1, rimMax: 20.9, isTireRelated: true, autoSuggest: true },
  "S001/1182": { shortName: "장착", qtyRule: "per_unit", rimMin: 21, isTireRelated: true, autoSuggest: true },

  // ── 휠밸런스 (⭐ 2개당) ──────────────────────────────────
  "S001/1183": { shortName: "밸런스", qtyRule: "per_2_units", rimMax: 17, isTireRelated: true, autoSuggest: true },
  "S001/1184": { shortName: "밸런스", qtyRule: "per_2_units", rimMin: 17.1, rimMax: 20, isTireRelated: true, autoSuggest: true },
  "S001/1185": { shortName: "밸런스", qtyRule: "per_2_units", rimMin: 21, isTireRelated: true, autoSuggest: true },

  // ── 타이어 관련 (기본 체크는 아님) ───────────────────────
  "S001/1186": { shortName: "위치교환", qtyRule: "per_job", isTireRelated: true, isFavorite: true },
  "S001/1187": { shortName: "펑크(비상)", qtyRule: "per_unit", isTireRelated: true, isFavorite: true },
  "S001/1188": { shortName: "펑크(PRP)", qtyRule: "per_unit", isTireRelated: true, isFavorite: true },
  "S001/1193": { shortName: "공기압", qtyRule: "per_job", isTireRelated: true },
  "S001/1251": { shortName: "고속밸런스", qtyRule: "per_job", isTireRelated: true },
  "S001/1250": { shortName: "휠수리", qtyRule: "per_job", isTireRelated: true }, // 단가 0 → 건별
  "S001/1280": { shortName: "TPMS", qtyRule: "per_unit", isTireRelated: true }, // 단가 0 → 건별
  /** ⚠️ 150,000원의 단위(세트당/시즌당/연간)가 미확인이다. 2개월차 보관 기능 전에 확정할 것 */
  "S001/1194": { shortName: "보관료", qtyRule: "per_job", isTireRelated: true },

  // ── 얼라인먼트 (⭐ 국산/수입 자동 판정) ───────────────────
  "S001/1189": { shortName: "얼라인먼트", qtyRule: "per_job", forImported: false, isTireRelated: true, isFavorite: true },
  "S001/1190": { shortName: "얼라인먼트", qtyRule: "per_job", forImported: false, isTireRelated: true },
  "S001/1191": { shortName: "얼라인먼트", qtyRule: "per_job", forImported: true, isTireRelated: true, isFavorite: true },
  "S001/1192": { shortName: "얼라인먼트", qtyRule: "per_job", forImported: true, isTireRelated: true },

  // ── 제동 ────────────────────────────────────────────────
  "S001/1195": { shortName: "브레이크오일", qtyRule: "per_job", forImported: false },
  "S001/1196": { shortName: "브레이크오일", qtyRule: "per_job", forImported: true },
  "S001/1197": { shortName: "패드교환", qtyRule: "per_job", forImported: false, isFavorite: true },
  "S001/1198": { shortName: "패드교환", qtyRule: "per_job", forImported: true, isFavorite: true },
  "S001/1199": { shortName: "디스크교환", qtyRule: "per_job", forImported: false },
  "S001/1200": { shortName: "디스크교환", qtyRule: "per_job", forImported: true },
  "S001/1201": { shortName: "캘리퍼", qtyRule: "per_unit", forImported: false },
  "S001/1202": { shortName: "캘리퍼", qtyRule: "per_unit", forImported: true },
  "S001/1203": { shortName: "패드+디스크", qtyRule: "per_job", forImported: false },
  "S001/1204": { shortName: "패드+디스크", qtyRule: "per_job", forImported: true },
  "S001/1205": { shortName: "라이닝", qtyRule: "per_job" },
  "S001/1206": { shortName: "드럼교환", qtyRule: "per_job" },
  "S001/1207": { shortName: "드럼교환", qtyRule: "per_job" },
  "S001/1208": { shortName: "드럼(허브)", qtyRule: "per_job" },

  // ── 전장 ────────────────────────────────────────────────
  "S001/1209": { shortName: "배터리교환", qtyRule: "per_job", isFavorite: true },
  "S001/1210": { shortName: "배터리(트렁크)", qtyRule: "per_job" },
  "S001/1211": { shortName: "점화플러그", qtyRule: "per_job" },
  "S001/1212": { shortName: "점화코일", qtyRule: "per_job" },
  "S001/1213": { shortName: "점화(6기통+)", qtyRule: "per_job" },
  "S001/1226": { shortName: "일반전구", qtyRule: "per_unit" },
  "S001/1227": { shortName: "헤드라이트", qtyRule: "per_unit" },
  "S001/1228": { shortName: "HID/LED", qtyRule: "per_unit" },
  "S001/1224": { shortName: "스캔진단", qtyRule: "per_job", forImported: false },
  "S001/1225": { shortName: "스캔진단", qtyRule: "per_job", forImported: true },

  // ── 오일·필터 ───────────────────────────────────────────
  "S001/1220": { shortName: "엔진오일", qtyRule: "per_job", forImported: false, isFavorite: true },
  "S001/1221": { shortName: "엔진오일", qtyRule: "per_job", forImported: true, isFavorite: true },
  "S001/1214": { shortName: "연료필터", qtyRule: "per_job", forImported: false },
  "S001/1215": { shortName: "연료필터", qtyRule: "per_job", forImported: true },
  "S001/1230": { shortName: "에어컨필터", qtyRule: "per_job", forImported: false, isFavorite: true },
  "S001/1231": { shortName: "에어컨필터", qtyRule: "per_job", forImported: true },
  "S001/1229": { shortName: "부동액", qtyRule: "per_unit" }, // 1L당

  // ── 하체 (1개당) ────────────────────────────────────────
  "S001/1216": { shortName: "쇼바", qtyRule: "per_unit" },
  "S001/1217": { shortName: "로우암", qtyRule: "per_unit" },
  "S001/1218": { shortName: "타이로드", qtyRule: "per_unit" },
  "S001/1219": { shortName: "등속조인트", qtyRule: "per_unit" },

  // ── 벨트 ────────────────────────────────────────────────
  "S001/1222": { shortName: "외부벨트", qtyRule: "per_job", forImported: false },
  "S001/1223": { shortName: "외부벨트", qtyRule: "per_job", forImported: false },

  // ── 기타 ────────────────────────────────────────────────
  "S001/0000": { shortName: "서비스공임", qtyRule: "per_job" },
  "S001/1290": { shortName: "기타", qtyRule: "per_job" }, // 단가 0 → 건별
};

/**
 * 단가 0 은 "값이 없다"는 뜻이다. 0원짜리 서비스가 아니라 건별로 정하는 항목.
 * NULL 로 넣어야 화면에서 "금액 입력" 을 요구한다.
 */
export const ZERO_MEANS_NULL = true;

/**
 * 타이어 규격(인치)과 차량(국산/수입)에 맞는 부대비용을 고른다.
 * 견적 화면이 이 함수로 자동 체크 항목을 만든다 (docs/06 8장).
 */
export function pickServices<T extends { marsServiceNo: string | null; rimMin: number | null; rimMax: number | null; forImported: boolean | null; autoSuggest: boolean }>(
  all: T[],
  opts: { rimInch: number | null; isImported: boolean | null },
): T[] {
  return all.filter((s) => {
    if (!s.autoSuggest) return false;
    if (s.rimMin !== null && (opts.rimInch === null || opts.rimInch < s.rimMin)) return false;
    if (s.rimMax !== null && (opts.rimInch === null || opts.rimInch > s.rimMax)) return false;
    if (s.forImported !== null && opts.isImported !== null && s.forImported !== opts.isImported) return false;
    return true;
  });
}

/** 수량 규칙 → 청구 수량. 휠밸런스 4본 → 2 (⌈4÷2⌉) */
export function billableQty(rule: QtyRule, tireCount: number): number {
  switch (rule) {
    case "per_unit":
      return tireCount;
    case "per_2_units":
      return Math.ceil(tireCount / 2);
    case "per_job":
      return 1;
  }
}
