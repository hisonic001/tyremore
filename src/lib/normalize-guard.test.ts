/**
 * ⭐ 고객 섞임 방지 정본 점검 (연동 사고 2026-09-09)
 *
 *   자리표시 264 「고객」(010-1234-5678)에 서로 다른 손님 6명의 차가 붙어
 *   한쪽 정보를 고치면 전부 함께 바뀌던 실사고. 방어의 판정 두 개가 정본:
 *     ① isPlaceholderPhone — 더미 전화는 「같은 손님 증거」가 아니다
 *     ② isPlaceholderCustomerName — 자리표시 이름 행에는 새 차를 못 단다
 *   여기 규칙이 무너지면 사고가 재발하므로 표로 못 박는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlaceholderCustomerName, isPlaceholderPhone } from "./normalize";

test("더미 전화 — 이관 자리표시·반복 숫자는 전부 걸린다", () => {
  for (const p of [
    "010-1234-5678", // 264 실사고 번호
    "01012345678",
    "010-1111-2222", // 이관 더미 184명
    "01023456789",
    "01000000000",
    "01011111111",
    "010-9999-9999",
    "01012121212", // 짝 반복
    "01034343434",
  ]) {
    assert.equal(isPlaceholderPhone(p), true, `${p} 는 더미여야 한다`);
  }
});

test("진짜 전화 — 실사용 번호는 안 걸린다", () => {
  for (const p of [
    "010-9248-4024", // 실데이터 꼴
    "01053743400",
    "010-7431-1234",
    "033-635-1234", // 지역번호
    "01012345670", // 12345678 과 한 끗 — 반복도 아님
    "", // 빈 값은 판정 대상 아님
    null,
  ]) {
    assert.equal(isPlaceholderPhone(p), false, `${p} 는 더미가 아니어야 한다`);
  }
});

test("자리표시 이름 — 「고객」류만 걸리고 실명은 안 걸린다", () => {
  for (const n of ["고객", " 고객 ", "김고객", "관광객", "비회원", "손님", "일반고객"]) {
    assert.equal(isPlaceholderCustomerName(n), true, `${n} 은 자리표시여야 한다`);
  }
  for (const n of ["박은지", "고객(아레떼 숙소)", "김철수", "고태환[한진택배]", "", null]) {
    assert.equal(isPlaceholderCustomerName(n), false, `${n} 은 자리표시가 아니어야 한다`);
  }
});
