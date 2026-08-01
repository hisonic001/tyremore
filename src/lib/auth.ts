"use server";

/**
 * 로그인 · 비밀번호
 *
 * 비밀번호는 scrypt 로 해싱한다 (Node 내장 — 추가 의존성 없음).
 * 저장 형식: `scrypt$<salt-hex>$<hash-hex>`
 *
 * ⚠️ 이 파일은 서버에서만 돈다. 미들웨어(Edge)에서는 `session.ts` 만 쓴다.
 */
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { appUser } from "@/db/schema";
import { SESSION_COOKIE, SESSION_DAYS, sessionSecret, signSession, verifySession, type Session } from "./session";

const scrypt = promisify(_scrypt) as (p: string, s: Buffer, l: number) => Promise<Buffer>;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(plain, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [algo, saltHex, hashHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  const hash = await scrypt(plain, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  // 길이가 다르면 timingSafeEqual 이 예외를 던진다
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

/** 현재 로그인 정보. 없으면 null */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value, sessionSecret());
}

/** 로그인 필수 화면에서 쓴다 */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** ⭐ 매입원가·마진을 볼 수 있는가 (D-05 6번) */
export async function isOwner(): Promise<boolean> {
  const s = await getSession();
  return s?.role === "owner";
}

export async function login(
  loginId: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = loginId.trim().toLowerCase();
  if (!id || !password) return { ok: false, error: "아이디와 비밀번호를 입력하세요" };

  const [u] = await db.select().from(appUser).where(eq(appUser.loginId, id)).limit(1);

  // 아이디가 없어도 같은 메시지를 준다 — 어느 아이디가 있는지 알려주지 않는다
  if (!u || !u.isActive || !(await verifyPassword(password, u.passwordHash))) {
    return { ok: false, error: "아이디 또는 비밀번호가 맞지 않습니다" };
  }

  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 3600;
  const token = await signSession(
    { uid: u.id, role: u.role as "owner" | "tech", name: u.name, exp },
    sessionSecret(),
  );

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true, // 자바스크립트가 못 읽는다
    secure: process.env.NODE_ENV === "production", // 배포에서는 HTTPS 로만
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  });
  return { ok: true };
}

export async function logout() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
