/**
 * ⭐ zip 판별 지킴이 (2026-08-31)
 *
 *   사고: xlsx 는 속이 zip 이라(PK 서명) 「zip 이면 토스 포스 zip 풀기」 판정이
 *   진짜 엑셀을 붙잡았다 — 신한 통장 .xlsx 업로드가 「zip 안에 엑셀 파일이 없습니다」로
 *   죽었다 (사장님 제보 "올려도 반응하지 않음"). 여태 통장·카드 파일이 전부
 *   구형 .xls(zip 아님)라 안 드러났던 것.
 *
 *   → isOfficeZip 이 「오피스 문서 zip」과 「엑셀을 담은 진짜 zip」을 갈라야 한다.
 *
 *   실행: npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { isOfficeZip, isZip, zipEntryNames } from "./zip-crypto";

/** 압축 없는(stored) zip 을 손으로 만든다 — 엔트리 이름만 중요하다 */
function fakeZip(entries: { name: string; data: string }[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const data = Buffer.from(e.data, "utf8");
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); // 로컬 헤더 서명
    h.writeUInt16LE(0x800, 6); // flags: utf8 이름
    h.writeUInt16LE(0, 8); // method: stored
    h.writeUInt32LE(data.length, 18); // compSize
    h.writeUInt32LE(data.length, 22); // size
    h.writeUInt16LE(name.length, 26);
    h.writeUInt16LE(0, 28);
    parts.push(h, name, data);
  }
  return Buffer.concat(parts);
}

describe("xlsx 는 zip 이지만 「토스 zip」이 아니다", () => {
  /** 진짜 xlsx — SheetJS 로 즉석에서 만든다 (신한 통장 파일과 같은 구조) */
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["거래일시", "잔액"]]), "sheet");
  const xlsx = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  test("진짜 xlsx — isZip 이면서 isOfficeZip", () => {
    assert.equal(isZip(xlsx), true); // 이게 바로 사고의 원인이었다
    assert.equal(isOfficeZip(xlsx), true); // 그래서 이걸로 갈라야 한다
    assert.ok(zipEntryNames(xlsx).includes("[Content_Types].xml"));
  });

  test("엑셀을 담은 진짜 zip (토스 포스 꼴) — isOfficeZip 아님", () => {
    const z = fakeZip([{ name: "매출리포트_260827.xlsx", data: "dummy" }]);
    assert.equal(isZip(z), true);
    assert.equal(isOfficeZip(z), false); // zip 풀기 가지로 가야 한다
  });

  test("엑셀이 아닌 파일 — isZip 아님", () => {
    assert.equal(isZip(Buffer.from("BIFF 나 CSV 같은 것")), false);
    assert.equal(isOfficeZip(Buffer.from("아무 글자")), false);
  });
});
