/**
 * 판매 등록에서 화면과 서버가 함께 쓰는 값·타입.
 *
 * ⚠️ `sale.ts` 는 "use server" 라 **async 함수만** 내보낼 수 있다.
 *    상수를 거기 두면 빌드가 깨진다. 그래서 여기로 뺐다.
 */

/**
 * ⭐ MARS 차량 등록의 「차량 종류」 — 영문으로 받는다.
 * MARS-auto-register 의 vehicle_type_map 에서 확인한 값이다.
 */
export const FUEL_TYPES = [
  { value: "Fuel", label: "가솔린" },
  { value: "Diesel", label: "디젤" },
  { value: "Hybrid", label: "하이브리드" },
  { value: "BEV", label: "전기차" },
  { value: "LPG", label: "LPG" },
] as const;

/** 종이 「차량 점검 및 주문 보고서」의 「차량 형태」 */
export const BODY_TYPES = ["승용", "SUV", "소형트럭", "밴/소형버스", "기타"] as const;

export interface NewCustomerInput {
  name: string;
  phone: string;
  address: string;
  /** 🔴 손님이 종이에 표시하고 서명한 그대로. 프로그램이 정하지 않는다 */
  consentPrivacy: boolean;
  consentMarketing: boolean;
  michelinMember: boolean;
  /** 종이에 서명을 받았는가 — 안 받았으면 MARS 고객 생성을 하지 않는다 */
  signed: boolean;

  plateNo: string;
  makerName: string;
  model: string;
  year: string;
  fuelType: string;
  bodyType: string;
  mileage: string;
  vin: string;
}
