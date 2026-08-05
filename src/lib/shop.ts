"use server";

/**
 * ⭐ 가게 정보 (사장님 요청 2026-08-05 — 견적서·거래명세서)
 *
 * 견적서·거래명세서 상단의 공급자 칸에 들어간다:
 * 상호 · 사업자등록번호 · 대표자 · 주소 · 전화 · 도장 이미지.
 * 설정 > 가게 정보에서 입력한다.
 */
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";

export interface ShopInfo {
  name: string;
  bizNo: string | null;
  owner: string | null;
  address: string | null;
  phone: string | null;
  /** 도장 이미지 (data URL) — 없으면 (인) 글자만 인쇄한다 */
  stamp: string | null;
}

export async function getShopInfo(): Promise<ShopInfo> {
  const [r] = await db.execute<{
    name: string;
    biz_no: string | null;
    owner: string | null;
    address: string | null;
    phone: string | null;
    stamp: string | null;
  }>(sql`SELECT name, biz_no, owner, address, phone, stamp FROM shop_info WHERE id = 1`);
  return {
    name: r?.name ?? "타이어모어 속초점",
    bizNo: r?.biz_no ?? null,
    owner: r?.owner ?? null,
    address: r?.address ?? null,
    phone: r?.phone ?? null,
    stamp: r?.stamp ?? null,
  };
}

export async function saveShopInfo(input: {
  name: string;
  bizNo?: string | null;
  owner?: string | null;
  address?: string | null;
  phone?: string | null;
  /** data URL. undefined = 그대로 두기, null = 지우기 */
  stamp?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "상호는 비울 수 없습니다" };
  if (input.stamp && input.stamp.length > 800_000) {
    return { ok: false, error: "도장 이미지가 너무 큽니다 — 500KB 이하로 줄여 주세요" };
  }
  await db.execute(sql`
    UPDATE shop_info SET
      name = ${name},
      biz_no = ${input.bizNo?.trim() || null},
      owner = ${input.owner?.trim() || null},
      address = ${input.address?.trim() || null},
      phone = ${input.phone?.trim() || null},
      ${input.stamp === undefined ? sql`` : sql`stamp = ${input.stamp},`}
      updated_at = now()
    WHERE id = 1
  `);
  for (const p of ["/settings/shop", "/settings"]) {
    try {
      revalidatePath(p);
    } catch {
      /* 요청 밖 */
    }
  }
  return { ok: true };
}
