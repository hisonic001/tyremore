"use server";

/**
 * ⭐ 계정 관리 (사장님 요청 2026-08-08)
 *
 *   "새로운 아이디 만들기, 비밀번호 찾기, owner 아이디는 다른 아이디들에
 *    권한 부여 가능. 등의 기본적인 계정관련 기능들"
 *
 * 설계 결정:
 *   · **공개 가입은 없다** — 고객 실명·전화가 든 인터넷 공개 앱이라, 계정은
 *     사장님이 설정 > 계정 관리에서 만든다.
 *   · **비밀번호 찾기 = 재설정** — 이메일 발송 기반 「찾기」는 메일 인프라가
 *     필요하고 피싱 표적이 된다. 정비사는 사장님이 재설정해 주고,
 *     사장님 본인이 잊으면 매장 PC 의 scripts/create-user.ts 로 재설정한다.
 *   · 모든 관리 기능은 isOwner 문지기 뒤에 있다 (2026-08-08 보안 정비와 같은 원칙).
 *
 * 🔴 잠금 방지: 마지막 남은 owner 를 정비사로 내리거나 중지시킬 수 없다.
 *    사장님이 스스로를 잠그면 아무도 되돌릴 수 없기 때문이다.
 */

import { and, asc, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { appUser } from "@/db/schema";
import { getSession, hashPassword, isOwner, verifyPassword } from "./auth";

function refresh() {
  try {
    revalidatePath("/settings/users");
  } catch {
    /* 요청 밖 */
  }
}

const NOT_OWNER = { ok: false as const, error: "사장님 계정에서만 할 수 있습니다" };

function checkPassword(pw: string): string | null {
  if (pw.length < 4) return "비밀번호는 4자 이상으로 해 주세요";
  if (pw.length > 100) return "비밀번호가 너무 깁니다";
  return null;
}

export interface UserRow {
  id: number;
  loginId: string;
  name: string;
  role: "owner" | "tech";
  isActive: boolean;
  isMe: boolean;
}

export async function listUsers(): Promise<UserRow[] | null> {
  const s = await getSession();
  if (s?.role !== "owner") return null;
  const rows = await db
    .select({
      id: appUser.id,
      loginId: appUser.loginId,
      name: appUser.name,
      role: appUser.role,
      isActive: appUser.isActive,
    })
    .from(appUser)
    .orderBy(asc(appUser.id));
  return rows.map((r) => ({ ...r, role: r.role as "owner" | "tech", isMe: r.id === s.uid }));
}

/** 새 계정 — 사장님이 만든다. 임시 비밀번호를 정해 알려주는 방식 */
export async function createAccount(input: {
  loginId: string;
  name: string;
  password: string;
  role: "owner" | "tech";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isOwner())) return NOT_OWNER;
  const loginId = input.loginId.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^[a-z0-9._-]{2,30}$/.test(loginId)) {
    return { ok: false, error: "아이디는 영문·숫자 2~30자로 해 주세요 (점·밑줄·대시 가능)" };
  }
  if (!name) return { ok: false, error: "이름을 넣어 주세요" };
  const pwErr = checkPassword(input.password);
  if (pwErr) return { ok: false, error: pwErr };
  if (input.role !== "owner" && input.role !== "tech") return { ok: false, error: "역할이 올바르지 않습니다" };

  const [dup] = await db.select({ id: appUser.id }).from(appUser).where(eq(appUser.loginId, loginId)).limit(1);
  if (dup) return { ok: false, error: `아이디 「${loginId}」 는 이미 있습니다` };

  await db.insert(appUser).values({
    loginId,
    name,
    passwordHash: await hashPassword(input.password),
    role: input.role,
  });
  refresh();
  return { ok: true };
}

/** 남은 활성 owner 수 — 잠금 방지의 근거 */
async function activeOwnersExcept(userId: number): Promise<number> {
  const [r] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int n FROM app_user
    WHERE role = 'owner' AND is_active AND id <> ${userId}
  `);
  return Number(r?.n ?? 0);
}

/** ⭐ 권한 부여/회수 — owner 만. 마지막 owner 는 내릴 수 없다 */
export async function setRole(
  userId: number,
  role: "owner" | "tech",
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isOwner())) return NOT_OWNER;
  if (role !== "owner" && role !== "tech") return { ok: false, error: "역할이 올바르지 않습니다" };
  if (role === "tech" && (await activeOwnersExcept(userId)) === 0) {
    return { ok: false, error: "마지막 사장님 계정은 정비사로 내릴 수 없습니다 — 다른 사장님 계정을 먼저 만드세요" };
  }
  await db.update(appUser).set({ role }).where(eq(appUser.id, userId));
  refresh();
  return { ok: true };
}

/** 비밀번호 재설정 — 사장님이 임시 비밀번호를 정해 준다 (「비밀번호 찾기」의 매장 방식) */
export async function resetPassword(
  userId: number,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isOwner())) return NOT_OWNER;
  const pwErr = checkPassword(newPassword);
  if (pwErr) return { ok: false, error: pwErr };
  await db.update(appUser).set({ passwordHash: await hashPassword(newPassword) }).where(eq(appUser.id, userId));
  refresh();
  return { ok: true };
}

/** 사용 중지/되살리기 — 마지막 owner·본인은 중지할 수 없다 */
export async function setActive(
  userId: number,
  active: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await getSession();
  if (s?.role !== "owner") return NOT_OWNER;
  if (!active) {
    if (userId === s.uid) return { ok: false, error: "본인 계정은 중지할 수 없습니다" };
    const [u] = await db.select({ role: appUser.role }).from(appUser).where(eq(appUser.id, userId)).limit(1);
    if (u?.role === "owner" && (await activeOwnersExcept(userId)) === 0) {
      return { ok: false, error: "마지막 사장님 계정은 중지할 수 없습니다" };
    }
  }
  await db.update(appUser).set({ isActive: active }).where(eq(appUser.id, userId));
  refresh();
  return { ok: true };
}

/** 내 비밀번호 바꾸기 — 누구나, 현재 비밀번호를 확인하고 */
export async function changeMyPassword(
  current: string,
  next: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s) return { ok: false, error: "로그인이 필요합니다" };
  const pwErr = checkPassword(next);
  if (pwErr) return { ok: false, error: pwErr };

  const [u] = await db
    .select({ hash: appUser.passwordHash })
    .from(appUser)
    .where(and(eq(appUser.id, s.uid), ne(appUser.isActive, false)))
    .limit(1);
  if (!u || !(await verifyPassword(current, u.hash))) {
    return { ok: false, error: "현재 비밀번호가 맞지 않습니다" };
  }
  await db.update(appUser).set({ passwordHash: await hashPassword(next) }).where(eq(appUser.id, s.uid));
  return { ok: true };
}
