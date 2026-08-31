/**
 * ⭐ 비밀번호 걸린 zip 열기 — 토스 포스 매출리포트용 (2026-08-26)
 *
 *   토스 포스가 내려주는 zip 은 전통 PKWARE(ZipCrypto) 암호 + deflate 다(실측: flag 0x801,
 *   compress 8). 외부 zip 라이브러리 없이 Node 내장 zlib 만으로 푼다 —
 *   로컬 파일 헤더를 차례로 읽어 첫 .xlsx 엔트리를 찾고, 12바이트 암호 헤더로 비밀번호를
 *   검증한 뒤 본문을 복호·inflateRaw 한다. AES(compress 99) 는 지원하지 않는다.
 *
 * 🔴 비밀번호는 코드에 두지 않는다 — env POS_ZIP_PASSWORD (Vercel·.env.local).
 */
import { inflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32Byte = (crc: number, b: number) => (CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0;

class ZipCipher {
  private k0 = 0x12345678;
  private k1 = 0x23456789;
  private k2 = 0x34567890;
  constructor(password: Buffer) {
    for (const b of password) this.update(b);
  }
  private update(b: number) {
    this.k0 = crc32Byte(this.k0, b);
    this.k1 = (Math.imul(this.k1 + (this.k0 & 0xff), 134775813) + 1) >>> 0;
    this.k2 = crc32Byte(this.k2, this.k1 >>> 24);
  }
  decryptByte(c: number): number {
    const t = (this.k2 | 2) & 0xffff;
    const p = c ^ ((Math.imul(t, t ^ 1) >>> 8) & 0xff);
    this.update(p);
    return p;
  }
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/**
 * 첫 번째로 이름이 filter 에 맞는 엔트리를 풀어 돌려준다. 암호가 안 걸린 zip 도 된다.
 * 비밀번호가 틀리면 "비밀번호가 다릅니다" 에러.
 */
export function extractFirst(zip: Buffer, password: string | null, filter: (name: string) => boolean): ZipEntry | null {
  let off = 0;
  while (off + 30 <= zip.length) {
    const sig = zip.readUInt32LE(off);
    if (sig !== 0x04034b50) break; // 로컬 헤더 끝 (central directory 시작)
    const flags = zip.readUInt16LE(off + 6);
    const method = zip.readUInt16LE(off + 8);
    const crc = zip.readUInt32LE(off + 14);
    const compSize = zip.readUInt32LE(off + 18);
    const nameLen = zip.readUInt16LE(off + 26);
    const extraLen = zip.readUInt16LE(off + 28);
    const name = zip.subarray(off + 30, off + 30 + nameLen).toString(flags & 0x800 ? "utf8" : "latin1");
    const dataStart = off + 30 + nameLen + extraLen;
    const encrypted = (flags & 1) !== 0;
    const hasDescriptor = (flags & 8) !== 0;
    let compSizeReal = compSize;
    if (hasDescriptor && compSize === 0) {
      // 데이터 디스크립터 형식 — 다음 시그니처를 찾아 길이를 정한다 (토스 파일은 아님, 방어용)
      const next = zip.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), dataStart);
      const cd = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), dataStart);
      const end = [next, cd].filter((x) => x > 0).sort((a, b) => a - b)[0] ?? zip.length;
      compSizeReal = end - dataStart - 16; // 디스크립터 16바이트
    }
    const body = zip.subarray(dataStart, dataStart + compSizeReal);
    if (filter(name)) {
      if (method === 99) throw new Error("AES 로 잠긴 zip 은 아직 못 엽니다 — 압축을 풀어 xlsx 를 올려 주세요");
      if (method !== 0 && method !== 8) throw new Error(`지원하지 않는 압축 방식(${method})입니다`);
      let raw: Buffer;
      if (encrypted) {
        if (!password) throw new Error("비밀번호가 걸린 zip 입니다 — 설정(POS_ZIP_PASSWORD)이 필요합니다");
        const ciph = new ZipCipher(Buffer.from(password, "utf8"));
        const out = Buffer.alloc(body.length);
        for (let i = 0; i < body.length; i++) out[i] = ciph.decryptByte(body[i]);
        // 12바이트 헤더: 마지막 바이트 = CRC 상위 바이트 (디스크립터면 수정 시각 상위 바이트)
        const checkByte = hasDescriptor ? (zip.readUInt16LE(off + 10) >>> 8) & 0xff : (crc >>> 24) & 0xff;
        if (out[11] !== checkByte) throw new Error("zip 비밀번호가 다릅니다 — 설정(POS_ZIP_PASSWORD)을 확인해 주세요");
        raw = out.subarray(12);
      } else {
        raw = body;
      }
      const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
      return { name, data };
    }
    off = dataStart + compSizeReal + (hasDescriptor ? 16 : 0);
  }
  return null;
}

export const isZip = (buf: Buffer) => buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;

/** 엔트리 이름만 훑는다 (본문은 안 푼다) — 오피스 문서 판별용 */
export function zipEntryNames(zip: Buffer, cap = 50): string[] {
  const names: string[] = [];
  let off = 0;
  while (off + 30 <= zip.length && names.length < cap) {
    if (zip.readUInt32LE(off) !== 0x04034b50) break;
    const flags = zip.readUInt16LE(off + 6);
    const compSize = zip.readUInt32LE(off + 18);
    const nameLen = zip.readUInt16LE(off + 26);
    const extraLen = zip.readUInt16LE(off + 28);
    names.push(zip.subarray(off + 30, off + 30 + nameLen).toString(flags & 0x800 ? "utf8" : "latin1"));
    const dataStart = off + 30 + nameLen + extraLen;
    let compReal = compSize;
    const hasDescriptor = (flags & 8) !== 0;
    if (hasDescriptor && compSize === 0) {
      const next = zip.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), dataStart);
      const cd = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), dataStart);
      const end = [next, cd].filter((x) => x > 0).sort((a, b) => a - b)[0] ?? zip.length;
      compReal = end - dataStart - 16;
    }
    off = dataStart + compReal + (hasDescriptor ? 16 : 0);
  }
  return names;
}

/**
 * 🔴 이 zip 이 사실은 **엑셀 파일 그 자체**인가 (2026-08-31 사장님 제보로 발견)
 *
 *   xlsx 는 속이 zip 이다(PK 서명). 그래서 「zip 이면 토스 포스 zip 으로 풀기」 판정이
 *   진짜 xlsx 를 붙잡아 「zip 안에 엑셀 파일이 없습니다」로 끝냈다 — 신한 통장 .xlsx 가
 *   첫 사례였다 (여태 통장·카드 파일은 전부 구형 .xls = zip 아님이라 안 드러났다).
 *   오피스 문서 zip 은 안에 [Content_Types].xml 이 있다 — 그걸로 가른다.
 */
export const isOfficeZip = (buf: Buffer) =>
  isZip(buf) && zipEntryNames(buf).some((n) => n === "[Content_Types].xml" || n.startsWith("xl/"));
