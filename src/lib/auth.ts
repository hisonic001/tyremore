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
import { cache } from "react";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { appUser } from "@/db/schema";
import { allOnPerms, evalPerm, type PermKey, type PermMap } from "./perm-keys";
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

/* ============================================================
 * ⭐ 기능 모듈 권한 (사장님 요청 2026-09-02) — 정본 perm-keys.ts
 *
 * 🔴 권한은 쿠키가 아니라 **DB 에서** 읽는다 — 쿠키(무상태, 90일)는 로그인 때만
 *    만들어져 스위치를 바꿔도 재로그인 전까지 안 바뀐다. uid 로 매번 조회하되
 *    React cache 로 한 요청 안에서는 한 번만 나간다. 스위치 즉시 반영.
 * ========================================================== */
const userPermRow = cache(async (uid: number) => {
  const [u] = await db
    .select({ role: appUser.role, perms: appUser.perms, isActive: appUser.isActive })
    .from(appUser)
    .where(eq(appUser.id, uid))
    .limit(1);
  return u ?? null;
});

/** 이 기능을 쓸 수 있는가 — 서버 액션 게이트가 부른다 */
export async function hasPerm(key: PermKey): Promise<boolean> {
  const s = await getSession();
  if (!s) return false;
  if (s.role === "owner") return true; // owner 는 스위치 무관 (perm-keys 규칙과 동일)
  const u = await userPermRow(s.uid);
  if (!u || !u.isActive) return false;
  return evalPerm(u.role, (u.perms ?? null) as PermMap | null, key);
}

/** 페이지용 — 권한 없으면 홈으로 */
export async function requirePerm(key: PermKey): Promise<Session> {
  const s = await requireSession();
  if (!(await hasPerm(key))) redirect("/");
  return s;
}

/** 네비·메뉴 노출용 — 내 역할과 스위치 맵 */
export async function myPerms(): Promise<{ role: string; perms: PermMap } | null> {
  const s = await getSession();
  if (!s) return null;
  if (s.role === "owner") return { role: "owner", perms: allOnPerms() };
  const u = await userPermRow(s.uid);
  if (!u || !u.isActive) return null;
  return { role: u.role, perms: ((u.perms ?? {}) as PermMap) ?? {} };
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
