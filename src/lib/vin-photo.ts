"use server";

/**
 * 사진으로 차량 정보 읽기 — 앱 쪽 (2026-09-05, 사장님 제안)
 *
 * 🔴 여기(Vercel)에서는 **읽지 않는다.** 클로드 구독이 매장 PC 에만 로그인되어 있다.
 *    앱은 사진을 맡기고 주문만 남기며, 읽는 것은 `scripts/vin-photo.ts` 다.
 *
 * 🔴 사진은 매장 PC 가 읽고 나면 **즉시 지운다**(`image = NULL`).
 *    등록증에는 소유자 이름·주소가 찍히므로 창고에 남기지 않는다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { blogJob } from "@/db/schema";
import { getSession } from "./auth";
import { blogAgentStatus } from "./blog-job";
import type { CleanRead } from "./vin-photo-core";

/** 사진 한 장의 상한 — 화면에서 긴 변 1600px 로 줄여 보낸다. 그래도 넘으면 거절 */
const MAX_BYTES = 4 * 1024 * 1024;

export interface ScanRow {
  id: number;
  status: string;
  error: string | null;
  result: (CleanRead & { warn: string[]; vinAgreed?: boolean }) | null;
}

/**
 * 사진을 맡기고 매장 PC 에 읽어 달라고 주문한다.
 * 대리인이 꺼져 있으면 **아예 안 받는다** — 「대기」로 굳어 영문을 모르는 일을 막는다.
 */
export async function requestVinScan(
  dataUrl: string,
): Promise<{ ok: true; scanId: number } | { ok: false; error: string }> {
  /* `/carinfo` 화면 자체가 로그인만 보므로 여기도 같게 한다 — 화면은 열리는데 단추만 막히면 안 된다 */
  const session = await getSession();
  if (!session) return { ok: false, error: "로그인이 필요합니다" };

  if (!/^data:image\/(jpe?g|png|webp);base64,/i.test(dataUrl)) {
    return { ok: false, error: "사진 파일만 올릴 수 있습니다" };
  }
  if (dataUrl.length > MAX_BYTES) {
    return { ok: false, error: "사진이 너무 큽니다 — 다시 찍어 주세요" };
  }

  const agent = await blogAgentStatus();
  if (!agent.alive) {
    return {
      ok: false,
      error: "매장 PC 가 꺼져 있습니다 — 사진은 그 PC 에서 읽습니다. 켜신 뒤 다시 눌러 주세요.",
    };
  }

  /* 🔴 순차로 — 동시 질의가 풀을 채운 전례가 있다 */
  const rows = await db.execute<{ id: number }>(sql`
    INSERT INTO vin_scan (image, status, requested_by)
    VALUES (${dataUrl}, '대기', ${session.uid ?? null})
    RETURNING id`);
  const scanId = Number(rows[0].id);

  /**
   * 🔴 payload 는 **드리즐 insert 로 객체 그대로** 넣는다 (2026-09-05).
   *    `${JSON.stringify(...)}::jsonb` 로 넣었더니 **JSON 글자가 통째로 한 겹 더 싸여**
   *    `"{\"scanId\":1}"` 로 들어갔고, 매장 PC 가 못 읽었다.
   *    `blog-job.ts` 가 쓰는 이 방식이 정본이다.
   */
  await db.insert(blogJob).values({ kind: "차량사진", payload: { scanId }, requestedBy: session.uid ?? null });

  return { ok: true, scanId };
}

/** 다 읽었는지 화면이 3초마다 물어본다 */
export async function getVinScan(scanId: number): Promise<ScanRow | null> {
  const rows = await db.execute<{
    id: number;
    status: string;
    error: string | null;
    result: (CleanRead & { warn: string[]; vinAgreed?: boolean }) | null;
  }>(sql`SELECT id, status, error, result FROM vin_scan WHERE id = ${scanId}`);
  const r = rows[0];
  if (!r) return null;
  return { id: Number(r.id), status: r.status, error: r.error, result: r.result };
}
