/**
 * ⭐ MARS 올리기 전 필수 정보 검사 (사장님 지시 2026-08-17)
 *
 *   "mars에는 사실 차대번호를 제외한 고객과 차량 정보가 없으면 입력이 안될것임.
 *    그렇기 때문에 하나라도 입력이 안되있으면 자동올리기 체크가 안되야 함.
 *    다만 우리 앱에서는 자유도가 중요하기에 지금처럼 입력되지 않아도 문제가
 *    없으면 좋겠어."
 *
 * 그래서 **판매 등록은 그대로 자유롭게** 두고, 검사는 MARS 올리기 문턱에서만 한다.
 * 차대번호(VIN)는 사장님 말씀대로 검사하지 않는다.
 *
 * 🔴 이미 MARS 에 있는 고객·차량은 만들 일이 없으므로 만들기 재료를 요구하지 않는다:
 *    · 고객 정보(전화·주소·서명)는 **MARS 연락처 번호(contactNo)가 없을 때만** —
 *      있으면 그 고객은 MARS 에 있고, 자동입력은 검색해서 쓰기만 한다.
 *    · 차량 정보(제조사·모델·연식·연료)는 **MARS 차량 번호(marsVehicleNo)가 없을 때만.**
 *    주행거리만은 언제나 필요하다 — 주문마다 들어가고, 없으면 MARS 가 전기를 막는다.
 *
 * 🔴 이 파일은 `"use server"` 가 아니다 (receivable-plan 과 같은 이유) — 순수 계산이라
 *    화면(체크박스 막기)·서버(queueForMars)·매장 PC(mars-fill)가 **같은 규칙**을 쓴다.
 *    규칙이 갈라지면 화면에선 되는데 실행에서 막히는 어긋남이 생긴다.
 */

export interface MarsReadyInput {
  /** 판매에 차량이 연결돼 있나 — MARS 는 차량 없이는 주문 자체가 안 된다 */
  hasVehicle: boolean;
  /** MARS 차량 번호(V583-…) — 있으면 차량 만들기 재료는 필요 없다 */
  marsVehicleNo: string | null;
  makerName: string | null;
  model: string | null;
  year: number | null;
  fuelType: string | null;
  /** 판매의 주행거리, 없으면 차량 최근값 (COALESCE 한 값) */
  mileage: number | null;
  /** MARS 연락처 번호(C583-…) — 있으면 고객 만들기 재료는 필요 없다 */
  contactNo: string | null;
  customerName: string | null;
  phone: string | null;
  address: string | null;
  /** 개인정보 동의 서명을 받았나 — 없으면 MARS 고객 등록을 하면 안 된다 */
  consentSigned: boolean;
}

/** 모자란 항목의 이름들. 비면 올릴 수 있다 */
export function marsMissing(x: MarsReadyInput): string[] {
  const out: string[] = [];
  if (!x.hasVehicle) {
    out.push("차량 연결");
  } else if (!x.marsVehicleNo) {
    if (!x.makerName) out.push("제조사");
    if (!x.model) out.push("모델");
    if (!x.year) out.push("연식");
    if (!x.fuelType) out.push("연료 종류");
  }
  if (x.mileage === null) out.push("주행거리");
  if (!x.contactNo) {
    if (!x.customerName?.trim()) out.push("고객 이름");
    else {
      if (!x.phone?.trim()) out.push("전화번호");
      if (!x.address?.trim()) out.push("주소");
      if (!x.consentSigned) out.push("개인정보 동의 서명");
    }
  }
  return out;
}
