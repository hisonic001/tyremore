/**
 * ⭐ 배터리 단가표 정본 (2026-09-12) — 사장님 요청 "9월 인상된 단가표를 앱에서 보고, 원가도 반영"
 *
 *   사진 「2026-9월1일 싸군배터리 로케트,한국B-VAT별도」를 그대로 옮겨 적은 표.
 *   **묶음·순서·품명이 여기서 정본**이고, 화면(`battery-price.ts`)은 이 순서대로 그린다.
 *   값(`price`)은 스크립트가 `product.purchase_price` 에 넣는 데 쓴다 —
 *   화면에 보이는 「사 오는 값」은 **DB 의 지금 값**이다(나중에 매입가가 바뀌어도 화면이 진실을 말하게).
 *
 *   · price = null  → 사진에서 글자가 안 읽힌 칸. 화면 「확인 필요」, 스크립트는 **건너뛴다**(사장님 결정).
 *   · productId     → `part_no` 로는 못 찾는 것만 앱 상품 id 를 직접 고정.
 *   · 엑스프로 XP 는 **안 넣는다** (사장님 결정 2026-09-12, 2025-06 결정 유지).
 *
 * 🔴 다음에 단가가 또 오르면 **이 파일의 값과 PRICE_LIST_DATE 만 고치고** 스크립트를 다시 돌린다.
 *    화면·정본은 손댈 필요 없다. 지난 표는 `scripts/import-parts-260813.ts` 의 BATTERIES(2025-06-14).
 */

/** 사진 제목의 날짜 — 화면 머리에 그대로 띄운다 */
export const PRICE_LIST_DATE = "2026-09-01";
export const PRICE_LIST_SOURCE = "싸군배터리";

/**
 * 이번 반영의 「전 값 → 새 값」이 남는 자리 (app_setting 한 행, 새 표 없음 — 선례 `invoice_deadline_skip`).
 * 스크립트가 쓰고 화면이 읽어 「전 78,900」을 회색으로 보여 준다.
 */
export const PRICE_HISTORY_KEY = "battery_price_20260901";

export interface PriceHistory {
  appliedAt: string;
  listDate: string;
  rows: { partNo: string; productId: number; from: number | null; to: number }[];
}

export interface BatteryListRow {
  brand: string;
  series: string;
  /** 단가표 품명 = 앱 `product.part_no` (아래 productId 가 있는 것만 예외) */
  name: string;
  /** 공급가 VAT 별도. null = 사진에서 안 읽힘 */
  price: number | null;
  /** part_no 로 짝이 안 붙는 것 — 앱 product.id 고정 */
  productId?: number;
  /** 사람이 읽을 메모 (화면 물음표 옆) */
  note?: string;
}

export const BATTERY_PRICES: BatteryListRow[] = [
  // ── 델코 DF 일반
  { brand: "델코", series: "일반", name: "DF40L", price: 56500 },
  { brand: "델코", series: "일반", name: "DF40R", price: 56500 },
  { brand: "델코", series: "일반", name: "DF40AL", price: 58500 },
  { brand: "델코", series: "일반", name: "DF50L", price: 67200 },
  { brand: "델코", series: "일반", name: "DF60L", price: 80400 },
  { brand: "델코", series: "일반", name: "DF60R", price: 82100 },
  { brand: "델코", series: "일반", name: "DF80L", price: 86900 },
  { brand: "델코", series: "일반", name: "DF80R", price: 88400 },
  { brand: "델코", series: "일반", name: "DF90L", price: 91400 },
  { brand: "델코", series: "일반", name: "DF90R", price: 91400 },
  { brand: "델코", series: "일반", name: "DF100L", price: 104900 },
  { brand: "델코", series: "일반", name: "DF100R", price: 104900 },
  { brand: "델코", series: "일반", name: "DF100BR", price: 111000 },
  { brand: "델코", series: "일반", name: "DF100D", price: 123400 },
  { brand: "델코", series: "일반", name: "DF120L", price: 136700 },
  { brand: "델코", series: "일반", name: "DF120R", price: 136700 },
  { brand: "델코", series: "일반", name: "DF150L", price: 143900 },
  { brand: "델코", series: "일반", name: "DF170L", price: 162900 },
  { brand: "델코", series: "일반", name: "DF170R", price: 162900 },
  { brand: "델코", series: "일반", name: "DF200L", price: 185900 },
  { brand: "델코", series: "일반", name: "DF250L(75019)", price: 218700 },
  { brand: "델코", series: "일반", name: "DF250R(75018)", price: 218700 },
  // ── 델코 DIN
  { brand: "델코", series: "DIN", name: "DIN50L", price: 63100 },
  { brand: "델코", series: "DIN", name: "DIN60L", price: 79000 },
  { brand: "델코", series: "DIN", name: "DIN60HL", price: 79000 },
  { brand: "델코", series: "DIN", name: "DIN74L", price: 81800 },
  { brand: "델코", series: "DIN", name: "DIN74R", price: 85600 },
  { brand: "델코", series: "DIN", name: "DIN80L", price: 95600 },
  { brand: "델코", series: "DIN", name: "DIN90L", price: 104700 },
  { brand: "델코", series: "DIN", name: "DIN100L", price: 114500 },
  // ── 델코 전용
  { brand: "델코", series: "전용", name: "DF65-900", price: 118100 },
  { brand: "델코", series: "전용", name: "75B24LS", price: 82600 },
  { brand: "델코", series: "전용", name: "천화장사45L", price: 45900 },
  { brand: "델코", series: "전용", name: "DF택시80L", price: 80200 },
  // ── 델코 AGM
  { brand: "델코", series: "AGM", name: "LN2/60", price: 110400 },
  { brand: "델코", series: "AGM", name: "LN3/70", price: 131100 },
  { brand: "델코", series: "AGM", name: "LN4/80", price: 149700 },
  { brand: "델코", series: "AGM", name: "LN5/95", price: 187900 },
  { brand: "델코", series: "AGM", name: "LN6/105", price: 224300 },
  // ── 델코 딥사이클
  { brand: "델코", series: "딥사이클", name: "DC24", price: 103200 },
  { brand: "델코", series: "딥사이클", name: "DC27", price: 122800 },
  { brand: "델코", series: "딥사이클", name: "DC31", price: 140500 },

  // ── 로케트 GB 일반
  { brand: "로케트", series: "일반", name: "GB40L", price: 55600 },
  { brand: "로케트", series: "일반", name: "GB40R", price: 55600 },
  { brand: "로케트", series: "일반", name: "GB40AL", price: 55600 },
  { brand: "로케트", series: "일반", name: "GB50L", price: 65000 },
  { brand: "로케트", series: "일반", name: "GB60AL", price: 78400 },
  { brand: "로케트", series: "일반", name: "GB60R", price: 78400 },
  { brand: "로케트", series: "일반", name: "GB80L", price: 84500 },
  { brand: "로케트", series: "일반", name: "GB80R", price: 84500 },
  { brand: "로케트", series: "일반", name: "GB90L", price: 89800 },
  { brand: "로케트", series: "일반", name: "GB90R", price: 89800 },
  { brand: "로케트", series: "일반", name: "GB100L", price: 103600 },
  { brand: "로케트", series: "일반", name: "GB100R", price: 103600 },
  { brand: "로케트", series: "일반", name: "GB100BR", price: 107600 },
  { brand: "로케트", series: "일반", name: "GB120L", price: 134900 },
  { brand: "로케트", series: "일반", name: "GB120R", price: 134900 },
  { brand: "로케트", series: "일반", name: "GB150L", price: 148100 },
  { brand: "로케트", series: "일반", name: "GB170L/67019", price: 158400 },
  { brand: "로케트", series: "일반", name: "GB170R/67018", price: 159900 },
  { brand: "로케트", series: "일반", name: "GB200L", price: 184400 },
  // 🔴 앱에는 GB250L(id 44719, 230,000) 뿐 — 단자 방향이 다른 별개 물건일 수 있어 짝을 안 짓는다(보고만)
  { brand: "로케트", series: "일반", name: "GB250R", price: 211900 },
  // ── 로케트 DIN
  { brand: "로케트", series: "DIN", name: "DIN54459", price: null, note: "사진에서 값이 안 읽힘" },
  { brand: "로케트", series: "DIN", name: "DIN55457", price: null, note: "사진에서 값이 안 읽힘" },
  { brand: "로케트", series: "DIN", name: "DIN55066 L형", price: 60900 },
  { brand: "로케트", series: "DIN", name: "DIN55065 R형", price: 61400 },
  { brand: "로케트", series: "DIN", name: "DIN56219", price: 76800 },
  { brand: "로케트", series: "DIN", name: "DIN56318", price: null, note: "사진에서 값이 안 읽힘" },
  { brand: "로케트", series: "DIN", name: "DIN57820", price: 80100 },
  { brand: "로케트", series: "DIN", name: "DIN57219 R형", price: 83700 },
  { brand: "로케트", series: "DIN", name: "DIN59042", price: 103600 },
  { brand: "로케트", series: "DIN", name: "GB95R", price: 107400 },
  { brand: "로케트", series: "DIN", name: "DIN60044", price: 114000 },
  // ── 로케트 전용
  { brand: "로케트", series: "전용", name: "TILLER45L(농기계)", price: 45900 },
  { brand: "로케트", series: "전용", name: "12M24", price: 43200 },
  { brand: "로케트", series: "전용", name: "GB L6", price: 149200 },
  { brand: "로케트", series: "전용", name: "GB450L", price: 62200 },
  { brand: "로케트", series: "전용", name: "GB-NX100-S6L", price: 69000 },
  { brand: "로케트", series: "전용", name: "65-114", price: 110800 },
  { brand: "로케트", series: "전용", name: "FS200(선박용)", price: 169400 },
  // ── 로케트 AGM
  { brand: "로케트", series: "AGM", name: "RAGM60", price: 103600 },
  { brand: "로케트", series: "AGM", name: "RAGM70", price: 124300 },
  { brand: "로케트", series: "AGM", name: "RAGM80", price: 142500 },
  { brand: "로케트", series: "AGM", name: "RAGM95", price: 181200 },
  { brand: "로케트", series: "AGM", name: "RAGM105", price: 216900 },

  // ── 한국 HK 일반
  { brand: "한국", series: "일반", name: "HK40L", price: 48400 },
  { brand: "한국", series: "일반", name: "HK40R", price: 48400 },
  { brand: "한국", series: "일반", name: "HK40FL", price: 48400 },
  { brand: "한국", series: "일반", name: "HK50L", price: 58000 },
  { brand: "한국", series: "일반", name: "HK60L", price: 69700 },
  { brand: "한국", series: "일반", name: "HK60R", price: 69700 },
  { brand: "한국", series: "일반", name: "HK80L", price: 75800 },
  { brand: "한국", series: "일반", name: "HK80R", price: 75800 },
  { brand: "한국", series: "일반", name: "HK90L", price: 80400 },
  { brand: "한국", series: "일반", name: "HK90R", price: 80400 },
  { brand: "한국", series: "일반", name: "HK100L", price: 93400 },
  { brand: "한국", series: "일반", name: "HK100R", price: 93400 },
  { brand: "한국", series: "일반", name: "HK100BR", price: 93400 },
  { brand: "한국", series: "일반", name: "HK120L", price: 126400 },
  { brand: "한국", series: "일반", name: "HK120R", price: 126400 },
  { brand: "한국", series: "일반", name: "HK150L", price: 133800 },
  { brand: "한국", series: "일반", name: "HK170L", price: 150400 },
  { brand: "한국", series: "일반", name: "HK170R", price: 161300 },
  { brand: "한국", series: "일반", name: "HK200L", price: 173100 },
  // ── 한국 DIN
  { brand: "한국", series: "DIN", name: "HK44DL", price: 54900 },
  { brand: "한국", series: "DIN", name: "HK50DL", price: 54900 },
  { brand: "한국", series: "DIN", name: "HK54DL", price: null, note: "사진에서 값이 안 읽힘" },
  { brand: "한국", series: "DIN", name: "HK62DL", price: 70400 },
  { brand: "한국", series: "DIN", name: "HK74DL", price: 73300 },
  // 앱 품번이 「한국 HK80DL - MF58043」 — DIN 코드 58043 = 80AH (battery-cleanup-20260831.ts:16)
  { brand: "한국", series: "DIN", name: "HK80DL", price: 83500, productId: 46018 },
  { brand: "한국", series: "DIN", name: "HK90DL", price: 93000 },
  { brand: "한국", series: "DIN", name: "HK90DR", price: 93000 },
  // 앱 품번이 「한국 100L - MF60038」 — 60038 = 100AH
  { brand: "한국", series: "DIN", name: "HK100DL", price: 104800, productId: 46019 },
  // ── 한국 전용
  { brand: "한국", series: "전용", name: "AGM 46B24R", price: 95500 },
  { brand: "한국", series: "전용", name: "BX 50B24LS(농기계)", price: 56700 },
  { brand: "한국", series: "전용", name: "AX45L(농기계)", price: 39500 },
  { brand: "한국", series: "전용", name: "BX12N24", price: 37500 },
  { brand: "한국", series: "전용", name: "BX110L", price: 105700 },
  { brand: "한국", series: "전용", name: "TX80L(택시)", price: 72400 },
  { brand: "한국", series: "전용", name: "BX14", price: 37800 },
  { brand: "한국", series: "전용", name: "BX15", price: 40300 },

  // ── 아트라스 AGM
  { brand: "아트라스", series: "AGM", name: "AGM60DL", price: 101600 },
  { brand: "아트라스", series: "AGM", name: "AGM70DL", price: 118400 },
  { brand: "아트라스", series: "AGM", name: "AGM80DL", price: 135000 },
  { brand: "아트라스", series: "AGM", name: "AGM95DL", price: 171400 },
  { brand: "아트라스", series: "AGM", name: "AGM105DL", price: 213000 },
];

/** 화면 탭 순서 — 표에 나온 차례 그대로 */
export const BATTERY_BRANDS = ["델코", "로케트", "한국", "아트라스"] as const;
export type BatteryBrand = (typeof BATTERY_BRANDS)[number];
