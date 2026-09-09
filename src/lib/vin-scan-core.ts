/**
 * ⭐ 사진 읽기 주문 코어 (2026-09-08) — 서버 액션과 업로드 경로가 같은 판정을 쓴다.
 *
 * 🔴 왜 갈랐나: Next/React 의 서버 액션 인자 해독기는 인자 총량을 **100만 자로
 *    하드코딩** 제한한다(설정 불가 — decodeReply 기본 arraySizeLimit 1e6).
 *    base64 사진이 그걸 넘으면 「Maximum array nesting exceeded」로 죽는다
 *    (2026-09-08 실사고, digest 312436354). 그래서 큰 사진은
 *    /api/vin-scan(이진 업로드)으로 보내고, 판정은 여기 한 곳에 둔다.
 * 🔴 "use server" 아님 · 권한 검사 없음 — 부르는 쪽(액션/route)이 세션을 책임진다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { blogJob } from "@/db/schema";
import { blogAgentStatus } from "./blog-job";
import { OUTDATED_MSG } from "./agent-version";

/** 사진 한 장의 상한 — 화면에서 긴 변 2000px 로 줄여 보낸다. 그래도 넘으면 거절 */
export const MAX_BYTES = 4 * 1024 * 1024;

/**
 * ⭐ 시도 진단 (사장님 요청 2026-09-09 — "기종·조건 오류를 데이터로 검증").
 *    기기 문자열·형식·크기·변환 시간뿐 — 개인정보 아님. scripts/photo-diag.ts 가 통계.
 */
export type ScanMeta = Record<string, string | number | boolean | null>;

const trimMeta = (meta: ScanMeta | null): string | null => {
  if (!meta) return null;
  const s = JSON.stringify(meta);
  return s.length > 2000 ? null : s;
};

/** 폰 안에서 끝난 실패도 한 표에 남긴다 — 없으면 기종별 검증이 불가능하다 */
export async function recordClientFailure(
  error: string,
  mode: "제원" | "판매등록",
  uid: number | null,
  meta: ScanMeta | null,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO vin_scan (image, status, error, requested_by, meta, finished_at)
    VALUES (NULL, '실패', ${"폰에서 실패: " + error.slice(0, 300)}, ${uid}, ${trimMeta(meta)}::jsonb, now())`);
  void mode;
}

export async function createVinScan(
  dataUrl: string,
  mode: "제원" | "판매등록",
  uid: number | null,
  meta: ScanMeta | null = null,
): Promise<{ ok: true; scanId: number } | { ok: false; error: string }> {
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
  /* 🔴 옛 대리인은 모르는 주문을 조용히 흘려보냈다 (2026-09-05 실사고) — 아예 안 받는다 */
  if (agent.outdated) return { ok: false, error: OUTDATED_MSG };

  /* 🔴 순차로 — 동시 질의가 풀을 채운 전례가 있다 */
  const rows = await db.execute<{ id: number }>(sql`
    INSERT INTO vin_scan (image, status, requested_by, meta)
    VALUES (${dataUrl}, '대기', ${uid}, ${trimMeta(meta)}::jsonb)
    RETURNING id`);
  const scanId = Number(rows[0].id);

  /* 🔴 payload 는 드리즐 insert 객체 그대로 (2026-09-05 — JSON 문자열로 넣으면 한 겹 더 싸인다) */
  await db.insert(blogJob).values({ kind: "차량사진", payload: { scanId, mode }, requestedBy: uid });

  return { ok: true, scanId };
}
