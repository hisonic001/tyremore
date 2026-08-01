/**
 * 시드 데이터 — 이관 순서 1·2번 (docs/09 5장)
 *
 * 값은 추측하지 않고 실데이터에서 뽑았다 (2026-08-01).
 *   · 제조사 코드 18종  ← 상품 10,691건의 실제 분포
 *   · 차량 제조사 47종  ← 차량 2,574대의 실제 표기
 */

/* ============================================================
 * brand — MARS 「제조사 코드」 18종 (건수는 상품 마스터 실측)
 * ========================================================== */
export const BRANDS: { code: string; nameKo: string; nameEn?: string; sortOrder: number }[] = [
  { code: "MI", nameKo: "미쉐린", nameEn: "Michelin", sortOrder: 1 }, // 4,153건 — 가맹 브랜드
  { code: "PI", nameKo: "피렐리", nameEn: "Pirelli", sortOrder: 2 }, // 1,535
  { code: "HK", nameKo: "한국타이어", nameEn: "Hankook", sortOrder: 3 }, // 1,399
  { code: "CO", nameKo: "콘티넨탈", nameEn: "Continental", sortOrder: 4 }, // 927
  { code: "KM", nameKo: "금호타이어", nameEn: "Kumho", sortOrder: 5 }, // 690
  { code: "NX", nameKo: "넥센타이어", nameEn: "Nexen", sortOrder: 6 }, // 669
  { code: "BS", nameKo: "브리지스톤", nameEn: "Bridgestone", sortOrder: 7 }, // 453
  { code: "GY", nameKo: "굿이어", nameEn: "Goodyear", sortOrder: 8 }, // 420
  { code: "BFG", nameKo: "비에프굿리치", nameEn: "BFGoodrich", sortOrder: 9 }, // 38
  { code: "GN", nameKo: "제네럴타이어", nameEn: "General Tire", sortOrder: 10 }, // 34 ⚠️ 확인
  // --- 타이어가 아닌 것 (경정비) ---
  { code: "DELKOR", nameKo: "델코", nameEn: "Delkor", sortOrder: 20 }, // 44 배터리
  { code: "VARTA SV", nameKo: "바르타", nameEn: "Varta", sortOrder: 21 }, // 7 배터리
  { code: "ACTION BAT", nameKo: "액션배터리", sortOrder: 22 }, // 1 ⚠️ 확인
  { code: "SHELL", nameKo: "쉘", nameEn: "Shell", sortOrder: 30 }, // 14 오일
  { code: "LM", nameKo: "리퀴몰리", nameEn: "Liqui Moly", sortOrder: 31 }, // 11 ⚠️ 확인
  { code: "TRW", nameKo: "TRW", nameEn: "TRW", sortOrder: 40 }, // 2 제동부품
  { code: "HYPERINT", nameKo: "하이퍼인터", sortOrder: 50 }, // 15 ⚠️ 확인
  { code: "MISC", nameKo: "기타", sortOrder: 900 }, // 279
];

/** ⚠️ 이름을 확신하지 못하는 코드 — 사장님 확인 후 고칠 것 */
export const BRANDS_TO_CONFIRM = ["GN", "LM", "HYPERINT", "ACTION BAT"];

/**
 * ⭐ MARS 「단가1」이 VAT를 뺀 값인 브랜드 (사장님 확인 2026-08-01)
 *
 * 미쉐린 2,057건은 전부 1,000원 단위로 떨어지는 VAT 미포함 정가다.
 * 1.1을 곱하면 전부 100원 단위로 깔끔하게 떨어진다 — 반올림 손실이 없다.
 *
 * ⚠️ 나머지 브랜드는 아직 확인받지 못했다. 화면(상품 정리)에서 켜면 된다.
 *    피렐리 1,535건도 전부 1,000원 단위라 같은 성격일 가능성이 높다.
 */
export const VAT_EXCLUDED_BRANDS = ["MI"];

/* ============================================================
 * vehicle_maker — 47종 표기를 30종 코드로 통합
 *
 * ⭐ is_imported 가 견적 금액을 바꾼다.
 *    얼라인먼트 60,000(국산) vs 80,000(수입) / 엔진오일 30,000 vs 50,000
 * ========================================================== */
export const VEHICLE_MAKERS: { code: string; nameKo: string; isImported: boolean; sortOrder: number }[] = [
  // --- 국산 (건수 순) ---
  { code: "HYUNDAI", nameKo: "현대", isImported: false, sortOrder: 1 }, // 956+53+17 = 1,026
  { code: "KIA", nameKo: "기아", isImported: false, sortOrder: 2 }, // 714+29+8 = 751
  { code: "GENESIS", nameKo: "제네시스", isImported: false, sortOrder: 3 }, // 126
  { code: "RENAULT_KR", nameKo: "르노코리아", isImported: false, sortOrder: 4 }, // 112+4+3+1 = 120
  { code: "CHEVROLET", nameKo: "쉐보레", isImported: false, sortOrder: 5 }, // 104+2 = 106
  { code: "KGM", nameKo: "KG모빌리티", isImported: false, sortOrder: 6 }, // 101+6+1 = 108
  // --- 수입 ---
  { code: "BENZ", nameKo: "벤츠", isImported: true, sortOrder: 10 }, // 81+3 = 84
  { code: "BMW", nameKo: "BMW", isImported: true, sortOrder: 11 }, // 74
  { code: "AUDI", nameKo: "아우디", isImported: true, sortOrder: 12 }, // 28+1 = 29
  { code: "TESLA", nameKo: "테슬라", isImported: true, sortOrder: 13 }, // 18+3 = 21
  { code: "TOYOTA", nameKo: "토요타", isImported: true, sortOrder: 14 }, // 16
  { code: "FORD", nameKo: "포드", isImported: true, sortOrder: 15 }, // 14+2 = 16
  { code: "LANDROVER", nameKo: "랜드로버", isImported: true, sortOrder: 16 }, // 10+1 = 11
  { code: "VOLVO", nameKo: "볼보", isImported: true, sortOrder: 17 }, // 10
  { code: "PORSCHE", nameKo: "포르쉐", isImported: true, sortOrder: 18 }, // 9
  { code: "VW", nameKo: "폭스바겐", isImported: true, sortOrder: 19 }, // 9+5 = 14
  { code: "MINI", nameKo: "미니", isImported: true, sortOrder: 20 }, // 8
  { code: "LEXUS", nameKo: "렉서스", isImported: true, sortOrder: 21 }, // 6+1 = 7
  { code: "JEEP", nameKo: "지프", isImported: true, sortOrder: 22 }, // 6
  { code: "HONDA", nameKo: "혼다", isImported: true, sortOrder: 23 }, // 4
  { code: "CADILLAC", nameKo: "캐딜락", isImported: true, sortOrder: 24 }, // 4
  { code: "JAGUAR", nameKo: "재규어", isImported: true, sortOrder: 25 }, // 4
  { code: "PEUGEOT", nameKo: "푸조", isImported: true, sortOrder: 26 }, // 3
  { code: "POLESTAR", nameKo: "폴스타", isImported: true, sortOrder: 27 }, // 2
  { code: "GMC", nameKo: "GMC", isImported: true, sortOrder: 28 }, // 2
  { code: "NISSAN", nameKo: "닛산", isImported: true, sortOrder: 29 }, // 1
  { code: "CHRYSLER", nameKo: "크라이슬러", isImported: true, sortOrder: 30 }, // 1
  { code: "MASERATI", nameKo: "마세라티", isImported: true, sortOrder: 31 }, // 1
  { code: "BENTLEY", nameKo: "벤틀리", isImported: true, sortOrder: 32 }, // 1
  { code: "DAIHATSU", nameKo: "다이하쓰", isImported: true, sortOrder: 33 }, // 1
  { code: "UNKNOWN", nameKo: "미상", isImported: false, sortOrder: 999 }, // 빈값 8건
];

/**
 * MARS 원문 표기 → 코드.
 * 이걸 안 하면 "현대"로 검색했을 때 956건만 나오고 70건이 사라진다.
 */
export const MAKER_ALIASES: Record<string, string> = {
  현대자동차: "HYUNDAI",
  현대: "HYUNDAI",
  HYUNDAI: "HYUNDAI",
  기아자동차: "KIA",
  기아: "KIA",
  KIA: "KIA",
  제네시스: "GENESIS",
  GENESIS: "GENESIS",
  "르노 (삼성) 코리아": "RENAULT_KR",
  르노삼성: "RENAULT_KR",
  르노: "RENAULT_KR",
  RENAULT: "RENAULT_KR",
  쉐보레: "CHEVROLET",
  한국GM: "CHEVROLET",
  CHEVROLET: "CHEVROLET",
  "KG모빌리티(쌍용)": "KGM",
  KG모빌리티: "KGM",
  쌍용: "KGM",
  "MERCEDES-BENZ": "BENZ",
  벤츠: "BENZ",
  BMW: "BMW",
  AUDI: "AUDI",
  아우디: "AUDI",
  TESLA: "TESLA",
  테슬라: "TESLA",
  TOYOTA: "TOYOTA",
  FORD: "FORD",
  포드: "FORD",
  "LAND ROVER": "LANDROVER",
  랜드로버: "LANDROVER",
  VOLVO: "VOLVO",
  PORSCHE: "PORSCHE",
  VOLKSWAGEN: "VW",
  VW: "VW",
  MINI: "MINI",
  LEXUS: "LEXUS",
  렉서스: "LEXUS",
  JEEP: "JEEP",
  HONDA: "HONDA",
  CADILLAC: "CADILLAC",
  JAGUAR: "JAGUAR",
  PEUGEOT: "PEUGEOT",
  Polestar: "POLESTAR",
  GMC: "GMC",
  NISSAN: "NISSAN",
  CHRYSLER: "CHRYSLER",
  MASERATI: "MASERATI",
  BENTLEY: "BENTLEY",
  DAIHATSU: "DAIHATSU",
};

/** 원문 표기를 코드로 바꾼다. 모르는 표기는 null → import_issue 로 보낸다 */
export function resolveMaker(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return "UNKNOWN";
  return MAKER_ALIASES[s] ?? MAKER_ALIASES[s.toUpperCase()] ?? null;
}
