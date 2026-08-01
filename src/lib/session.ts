/**
 * 세션 — 서명된 쿠키
 *
 * ⚠️ 이 파일은 **미들웨어(Edge)에서도 돌아간다.** `node:crypto` 를 쓰면 안 되고
 *    Web Crypto(`crypto.subtle`)만 쓴다. 서버 컴포넌트에서도 같은 코드가 동작한다.
 *
 * 외부 인증 업체에 묶이지 않는다 (D-11 / D-06 이식성).
 * 쿠키 하나에 `사용자ID · 역할 · 만료`를 담고 HMAC 으로 서명한다.
 * 서버는 상태를 저장하지 않으므로 자체 서버로 옮겨도 그대로 동작한다.
 */

export const SESSION_COOKIE = "tm_session";

export interface Session {
  uid: number;
  role: "owner" | "tech";
  name: string;
  /** 만료 (epoch 초) */
  exp: number;
}

/** 기기 신뢰 90일 — 매장 태블릿에서 매번 로그인시키면 아무도 안 쓴다 (D-11 3번) */
export const SESSION_DAYS = 90;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSession(s: Session, secret: string): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify(s)));
  const sig = await crypto.subtle.sign("HMAC", await key(secret), new TextEncoder().encode(payload));
  return `${payload}.${b64url(new Uint8Array(sig))}`;
}

/** 서명과 만료를 확인한다. 조금이라도 어긋나면 null */
export async function verifySession(token: string | undefined, secret: string): Promise<Session | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await key(secret),
      fromB64url(sig),
      new TextEncoder().encode(payload),
    );
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Session;
    if (typeof s.exp !== "number" || s.exp * 1000 < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export function sessionSecret(): string {
  const v = process.env.AUTH_SECRET;
  if (!v || v.length < 16) {
    throw new Error(
      "AUTH_SECRET 이 설정되지 않았습니다(16자 이상). .env.local 또는 배포 환경변수에 넣으세요.",
    );
  }
  return v;
}
