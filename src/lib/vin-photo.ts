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
import { getSession } from "./auth";
import { createVinScan } from "./vin-scan-core";
import { cleanPlate, type CleanRead } from "./vin-photo-core";

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
  /** ⭐ 읽기 용도 (2026-09-05) — '판매등록'이면 번호판·계기판·등록증 소유자 이름까지 읽는다 */
  mode: "제원" | "판매등록" = "제원",
): Promise<{ ok: true; scanId: number } | { ok: false; error: string }> {
  /* `/carinfo` 화면 자체가 로그인만 보므로 여기도 같게 한다 — 화면은 열리는데 단추만 막히면 안 된다 */
  const session = await getSession();
  if (!session) return { ok: false, error: "로그인이 필요합니다" };
  /**
   * 🔴 서버 액션 인자는 100만 자를 못 넘는다 (Next/React 하드코딩 — 2026-09-08
   *    「Maximum array nesting exceeded」 실사고). 큰 사진은 /api/vin-scan(이진
   *    업로드)으로 온다 — 판정은 vin-scan-core 한 곳이다. 이 액션은 /carinfo
   *    (1600px, 한도 안)용으로 남는다.
   */
  return createVinScan(dataUrl, mode, session.uid ?? null);
}

/**
 * 다 읽었는지 화면이 3초마다 물어본다.
 *
 * 🔴 **주문이 실패했으면 사진도 실패로 바꾼다** (2026-09-05).
 *    예전에는 주문만 실패하고 `vin_scan` 은 「대기」로 남아, 화면이 **영원히
 *    「읽고 있습니다」**를 보여 줬다. 사장님 눈에는 아무 일도 안 일어난 것으로 보였다.
 */
export async function getVinScan(scanId: number): Promise<ScanRow | null> {
  const rows = await db.execute<{
    id: number;
    status: string;
    error: string | null;
    result: (CleanRead & { warn: string[]; vinAgreed?: boolean }) | null;
    job_error: string | null;
  }>(sql`
    SELECT s.id, s.status, s.error, s.result,
           (SELECT j.error FROM blog_job j
             WHERE j.kind = '차량사진' AND j.status = '실패'
               AND (j.payload->>'scanId')::bigint = s.id
             ORDER BY j.id DESC LIMIT 1) AS job_error
    FROM vin_scan s WHERE s.id = ${scanId}`);
  const r = rows[0];
  if (!r) return null;

  /* 주문은 실패했는데 사진이 「대기」로 굳어 있으면 여기서 끊어 준다 */
  if (r.status === "대기" && r.job_error) {
    await db.execute(sql`
      UPDATE vin_scan SET status='실패', error=${r.job_error}, image=NULL, finished_at=now()
      WHERE id = ${scanId} AND status = '대기'`);
    return { id: Number(r.id), status: "실패", error: r.job_error, result: null };
  }

  /**
   * 🔴 결과를 **정본으로 한 번 더 거른다** (2026-09-05, 스캔 14 사고).
   *    매장 PC 대리인이 옛/딴 코드로 돌면 번호판 칸에 `{plate:"23너9549"}` 객체를
   *    통째로 적는 일이 실제로 났다 — 화면에는 [object Object] 가 들어가 검색이
   *    조용히 망가진다. 대리인이 어떤 상태든 앱은 깨진 값을 안 쓴다.
   */
  if (r.result) {
    const raw = r.result as CleanRead & { warn: string[]; vinAgreed?: boolean };
    const p = cleanPlate(raw.plateNo);
    raw.plateNo = p.plate;
    raw.plateTail = typeof raw.plateTail === "string" ? raw.plateTail : p.tail;
    raw.dropped = Array.isArray(raw.dropped) ? raw.dropped : [];
    if (p.reason && !raw.dropped.includes(p.reason)) raw.dropped.push(p.reason);
    let mask = typeof raw.plateMask === "string" ? raw.plateMask : p.mask;
    /* 매장 PC 대리인이 mask 없는 판이어도 — 버린 사유 문구에 「23?9549」 꼴이 남는다.
       또 pull 을 시키지 않고 여기서 복원한다 (2026-09-07) */
    if (!mask && raw.plateTail) {
      for (const d of raw.dropped) {
        const m = d.match(/「((?:[가-힣]{2})?\d{2,3}\?\d{4})」/);
        if (m) {
          mask = m[1];
          break;
        }
      }
    }
    raw.plateMask = mask;
  }
  return { id: Number(r.id), status: r.status, error: r.error, result: r.result };
}
