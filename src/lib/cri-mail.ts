/**
 * ⭐ 보안메일(HTML 첨부, 비밀번호로 여는 것) 해독 — 홈택스 전자세금계산서 메일이 이 형식 (2026-11-17)
 *
 *   구조 (홈택스 공개 스크립트 cri_ems_nt.js 실측):
 *     idCriHeader          base64 → 바이트마다 XOR 0x6B → 「이름:값」 줄들
 *                           ContentEncryptionAlgorithm 1=AES 2=SEED 3=ARIA
 *                           HashKey  = 열쇠 확인용 (풀면 열쇠의 MD5 16진 글자가 나와야 한다)
 *                           AttachFileName·AttachFileTagID (첨부 여러 개면 반복)
 *     idCriPcContents      본문 (암호문, base64)
 *     idCriAttachContentsN 첨부 N (암호문 → 풀면 base64 글자 → 그것을 풀면 원래 파일)
 *     열쇠 = MD5(비밀번호) 16바이트, IV = 0 16바이트, CBC + PKCS7
 *
 * 🔴 비밀번호(사업자번호)는 환경 변수로만 받는다 — 코드·저장소에 두지 않는다.
 * 🔴 사장님 승인(2026-11-17): 사장님 메일함의 보안메일을 사장님 사업자번호로 연다.
 */
import { createDecipheriv, createHash } from "node:crypto";
import { seedCbcDecrypt } from "./seed-cipher";

export interface CriFile {
  name: string;
  bytes: Uint8Array;
}

export type CriResult =
  | { ok: true; algorithm: string; body: string | null; files: CriFile[] }
  | { ok: false; error: string; wrongPassword?: boolean };

const ZERO_IV = new Uint8Array(16);

function hidden(html: string, id: string): string | null {
  const m = new RegExp(`id=["']${id}["'][^>]*?value=["']([^"']*)["']`, "i").exec(html)
    ?? new RegExp(`value=["']([^"']*)["'][^>]*?id=["']${id}["']`, "i").exec(html);
  return m ? m[1].trim() : null;
}

/** 머리 글자가 UTF-8 이 아니면 EUC-KR(CP949) 로 읽는다 */
function decodeText(b: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return new TextDecoder("euc-kr").decode(b);
  }
}

/** 보안메일 HTML 인가 — 은행·카드사 메일도 같은 틀을 쓰는 경우가 있다 */
export function isCriMail(html: string): boolean {
  return /idCriHeader/.test(html) && /idCri(Pc|Attach)Contents/.test(html);
}

export function decryptCriMail(html: string, password: string): CriResult {
  const headB64 = hidden(html, "idCriHeader");
  if (!headB64) return { ok: false, error: "보안메일 머리(idCriHeader)를 찾지 못했습니다" };
  const raw = Buffer.from(headB64, "base64").map((b) => b ^ 0x6b);
  const lines = decodeText(raw).split(/\r?\n/);
  const field = (k: string) => lines.filter((l) => l.startsWith(`${k}:`)).map((l) => l.slice(k.length + 1).trim());

  const alg = field("ContentEncryptionAlgorithm")[0] ?? "";
  const hashKey = field("HashKey")[0] ?? "";
  const names = field("AttachFileName");
  const tags = field("AttachFileTagID");

  const key = new Uint8Array(createHash("md5").update(password, "utf8").digest());
  const keyHex = Buffer.from(key).toString("hex");

  const dec = (b64: string): Uint8Array | null => {
    const c = new Uint8Array(Buffer.from(b64, "base64"));
    if (alg === "2") return seedCbcDecrypt(c, key, ZERO_IV);
    if (alg === "1") {
      try {
        const d = createDecipheriv("aes-128-cbc", key, ZERO_IV);
        return new Uint8Array(Buffer.concat([d.update(c), d.final()]));
      } catch {
        return null;
      }
    }
    return null;
  };
  if (alg !== "1" && alg !== "2") return { ok: false, error: `지원하지 않는 암호 방식입니다 (ContentEncryptionAlgorithm=${alg || "없음"})` };

  // 열쇠 확인 — 틀린 비밀번호로 쓰레기를 만들어 내지 않는다
  const check = hashKey ? dec(hashKey) : null;
  if (!check || Buffer.from(check).toString("utf8") !== keyHex) {
    return { ok: false, error: "비밀번호(사업자번호)가 맞지 않습니다", wrongPassword: true };
  }

  const bodyEnc = hidden(html, "idCriPcContents") ?? hidden(html, "idCriMobileContents");
  const bodyBytes = bodyEnc ? dec(bodyEnc) : null;
  const body = bodyBytes ? decodeText(bodyBytes) : null;

  const files: CriFile[] = [];
  for (let n = 0; n < Math.max(names.length, tags.length); n++) {
    const enc = hidden(html, tags[n] ?? `idCriAttachContents${n}`);
    if (!enc) continue;
    const b = dec(enc);
    if (!b) return { ok: false, error: `첨부 ${n + 1}번을 풀지 못했습니다` };
    // 풀린 것은 base64 글자다 (원본 CriDownFile → Crib64toBlob)
    const inner = Buffer.from(Buffer.from(b).toString("latin1").replace(/\s+/g, ""), "base64");
    files.push({ name: names[n] ?? `첨부${n + 1}`, bytes: new Uint8Array(inner) });
  }
  return { ok: true, algorithm: alg === "2" ? "SEED" : "AES", body, files };
}
