/**
 * SEED-128 CBC 해독 (보안메일용) — 새 의존성 없이 (D-32 「새 의존성 금지」) (2026-11-17)
 *
 *   홈택스·카드사 보안메일은 CryptoJS 의 SEED 로 잠겨 온다. Node 내장 crypto(OpenSSL 3)에는
 *   SEED 가 없어서 홈택스가 공개한 CryptoJS 구현을 **연산 순서 그대로** 옮겼다.
 *   표(seed-tables.ts)는 원본 파일에서 숫자만 뽑아 자동 생성했다.
 *
 * 🔴 정답 확인: 홈택스 원본 라이브러리로 푼 결과와 바이트 단위로 같아야 한다
 *    (seed-cipher.test.ts — 원본 결과로 만든 고정 시험값).
 * 🔴 JS 숫자 연산(>>> · ^ 의 32비트 절삭)을 그대로 쓴다 — 「더 깔끔하게」 바꾸면 값이 틀어진다.
 */
import { SS, KC } from "./seed-tables";

const G = (i: number) => SS[3][(i >>> 24) & 255] ^ SS[2][(i >>> 16) & 255] ^ SS[1][(i >>> 8) & 255] ^ SS[0][i & 255];

/** 16바이트 열쇠(4워드, 빅엔디언) → 라운드 열쇠 16쌍 */
function roundKeys(key: readonly number[]): number[][] {
  let h = key[0];
  let k = key[1];
  let j = key[2];
  let i = key[3];
  const e: number[][] = [];
  for (let c = 0; c < 16; c++) {
    e[c] = [G(h + j - KC[c]), G(k - i + KC[c])];
    if (c % 2 === 0) {
      const a = h;
      h = (h >>> 8) | (k << 24);
      k = (k >>> 8) | (a << 24);
    } else {
      const a = j;
      j = (j << 8) | (i >>> 24);
      i = (i << 8) | (a >>> 24);
    }
  }
  return e;
}

/** 블록 하나(4워드) — 원본 _doCryptBlock 그대로. words[off..off+3] 를 제자리에서 바꾼다 */
function cryptBlock(words: number[], off: number, rk: readonly number[][]): void {
  let c: number[][] = [words.slice(off, off + 2), words.slice(off + 2, off + 4)];
  for (let n = 0; n < 16; n++) {
    const e = rk[n];
    const a = c[0];
    const r = c[1];
    const b = [r[0] ^ e[0], r[1] ^ e[1]];
    b[1] ^= b[0];
    b[1] = G(b[1]);
    b[0] += b[1];
    b[0] = G(b[0]);
    b[1] += b[0];
    b[1] = G(b[1]);
    b[0] += b[1];
    a[0] ^= b[0];
    a[1] ^= b[1];
    c = [r, a];
  }
  c.reverse();
  words.splice(off, 4, c[0][0], c[0][1], c[1][0], c[1][1]);
}

function bytesToWords(b: Uint8Array): number[] {
  const w: number[] = new Array(Math.ceil(b.length / 4)).fill(0);
  for (let i = 0; i < b.length; i++) w[i >>> 2] |= b[i] << (24 - (i % 4) * 8);
  return w;
}

function wordsToBytes(w: readonly number[], n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (w[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  return out;
}

/**
 * SEED-CBC + PKCS7 해독. 열쇠·IV 는 16바이트.
 * @returns 해독된 바이트. 덧붙임(padding)이 깨졌으면(=열쇠가 틀림) null
 */
export function seedCbcDecrypt(cipher: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array | null {
  if (key.length !== 16 || iv.length !== 16 || cipher.length === 0 || cipher.length % 16 !== 0) return null;
  const inv = roundKeys(bytesToWords(key)).reverse();
  const words = bytesToWords(cipher);
  let prev = bytesToWords(iv);
  for (let off = 0; off < words.length; off += 4) {
    const thisBlock = words.slice(off, off + 4);
    cryptBlock(words, off, inv);
    for (let t = 0; t < 4; t++) words[off + t] ^= prev[t];
    prev = thisBlock;
  }
  const bytes = wordsToBytes(words, cipher.length);
  const pad = bytes[bytes.length - 1];
  if (pad < 1 || pad > 16) return null;
  for (let i = bytes.length - pad; i < bytes.length; i++) if (bytes[i] !== pad) return null;
  return bytes.slice(0, bytes.length - pad);
}
