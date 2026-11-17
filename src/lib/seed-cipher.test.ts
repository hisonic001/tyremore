/**
 * ⭐ SEED 해독이 홈택스 원본(CryptoJS SEED)과 같은가 (2026-11-17)
 *   고정값은 원본 라이브러리로 **가짜 문장**을 암호화해 만들었다 — 실제 계산서는 넣지 않는다.
 *   (실물 메일 첨부 1건으로도 바이트 단위 일치를 확인했다 — 6,819바이트, 2026-11-17)
 *   실행: npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { seedCbcDecrypt } from "./seed-cipher";

const PT = "타이어모어 시험 문장 — SEED CBC PKCS7 0123456789 abcdefghijklmnopqrstuvwxyz";
const CT =
  "HnIAAtptW4i9T8oHenM1QPi/O+VDZdWx4lIDMhu2gsu7ZfxsdmIhOH+OSumqC0nO1emhVcbsIIaGF8m4c89HzlKe1LTAJd+wSnaihg9HhyEbIoOZS3nfB/IYuoLVI5p8";
const key = new Uint8Array(createHash("md5").update("1234567890").digest());
const iv = new Uint8Array(16);

describe("seedCbcDecrypt", () => {
  test("원본 CryptoJS 로 잠근 문장을 그대로 푼다", () => {
    assert.equal(Buffer.from(key).toString("hex"), "e807f1fcf82d132f9bb018ca6738a19f");
    const out = seedCbcDecrypt(new Uint8Array(Buffer.from(CT, "base64")), key, iv);
    assert.ok(out);
    assert.equal(Buffer.from(out).toString("utf8"), PT);
  });
  test("열쇠가 틀리면 null (덧붙임 검사) — 쓰레기를 돌려주지 않는다", () => {
    const wrong = new Uint8Array(createHash("md5").update("0000000000").digest());
    assert.equal(seedCbcDecrypt(new Uint8Array(Buffer.from(CT, "base64")), wrong, iv), null);
  });
  test("길이가 16의 배수가 아니면 null", () => {
    assert.equal(seedCbcDecrypt(new Uint8Array(15), key, iv), null);
  });
});
