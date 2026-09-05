"use server";

/**
 * 사진 폴더 — 앱 쪽 조회·주문 (C단계, 2026-09-02)
 *
 * 🔴 미리보기(base64)를 **화면 데이터에 절대 싣지 않는다.**
 *    404장이면 2.3MB 다 — 한 방에 실으면 폰에서 몇 초가 걸리고 Vercel 응답 한도에도 닿는다.
 *    목록에는 id·파일명만 보내고, 그림은 `/api/blog-photo/{id}/thumb` 이 한 장씩 내려 준다
 *    (브라우저가 알아서 게으르게 받고 캐시한다).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { hasPerm } from "./auth";
import { requestBlogJob } from "./blog-job";

export interface FolderRow {
  id: number;
  label: string;
  isPending: boolean;
  photoCount: number;
  videoCount: number;
  offlineCount: number;
  thumbCount: number;
  mtime: string | null;
  quoteId: number | null;
}

/** 폴더 목록 — 「(미업로드)」가 위, 그다음 최근 순 */
export async function listFolders(): Promise<FolderRow[]> {
  const rows = await db.execute<{
    id: number;
    label: string;
    is_pending: boolean;
    photo_count: number;
    video_count: number;
    offline_count: number;
    thumb_count: number;
    mtime: string | null;
    quote_id: number | null;
  }>(sql`
    SELECT f.id, f.label, f.is_pending, f.photo_count, f.video_count, f.offline_count,
           (SELECT count(*)::int FROM blog_photo p WHERE p.folder_id = f.id AND p.thumb IS NOT NULL) AS thumb_count,
           to_char(f.folder_mtime AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS mtime,
           f.quote_id
    FROM blog_folder f
    WHERE f.is_gone = false
    ORDER BY f.is_pending DESC, f.folder_mtime DESC NULLS LAST
    LIMIT 60`);
  return rows.map((r) => ({
    id: Number(r.id),
    label: r.label,
    isPending: !!r.is_pending,
    photoCount: Number(r.photo_count),
    videoCount: Number(r.video_count),
    offlineCount: Number(r.offline_count),
    thumbCount: Number(r.thumb_count),
    mtime: r.mtime,
    quoteId: r.quote_id === null ? null : Number(r.quote_id),
  }));
}

export interface PhotoRow {
  id: number;
  fileName: string;
  isVideo: boolean;
  isOffline: boolean;
  hasThumb: boolean;
}

/** 폴더 하나의 사진 목록 — 🔴 thumb 은 안 싣는다 (id 만) */
export async function listPhotos(folderId: number): Promise<PhotoRow[]> {
  const rows = await db.execute<{
    id: number;
    file_name: string;
    is_video: boolean;
    is_offline: boolean;
    has_thumb: boolean;
  }>(sql`
    SELECT id, file_name, is_video, is_offline, (thumb IS NOT NULL) AS has_thumb
    FROM blog_photo WHERE folder_id = ${folderId}
    ORDER BY file_name`);
  return rows.map((r) => ({
    id: Number(r.id),
    fileName: r.file_name,
    isVideo: !!r.is_video,
    isOffline: !!r.is_offline,
    hasThumb: !!r.has_thumb,
  }));
}

export async function getFolder(folderId: number): Promise<FolderRow | null> {
  const all = await listFolders();
  return all.find((f) => f.id === folderId) ?? null;
}

/** 미리보기 한 장 — 라우트가 부른다 */
export async function getThumb(photoId: number): Promise<string | null> {
  const rows = await db.execute<{ thumb: string | null }>(sql`
    SELECT thumb FROM blog_photo WHERE id = ${photoId}`);
  return rows[0]?.thumb ?? null;
}

/**
 * 발행용 사진 한 장 (1280px) — 끌어다 놓기용. 라우트가 부른다.
 * 🔴 없으면 **null 을 낸다.** 미리보기로 몰래 갈아치우면 「고화질인 줄 알았는데 아닌」
 *    최악이 된다 — 사장님이 그걸 그대로 블로그에 올리시게 된다.
 */
export async function getPublish(photoId: number): Promise<{ b64: string; fileName: string } | null> {
  const rows = await db.execute<{ publish: string | null; file_name: string }>(sql`
    SELECT publish, file_name FROM blog_photo WHERE id = ${photoId}`);
  const r = rows[0];
  return r?.publish ? { b64: r.publish, fileName: r.file_name } : null;
}

/** 이 글에 든 사진 중 발행용이 준비된 것 (화면이 「끌어도 됩니다」를 언제 보일지 정한다) */
export async function publishReady(photoIds: number[]): Promise<number[]> {
  if (photoIds.length === 0) return [];
  const rows = await db.execute<{ id: number }>(sql`
    SELECT id FROM blog_photo
    WHERE id = ANY(${photoIds}::bigint[]) AND publish IS NOT NULL`);
  return rows.map((r) => Number(r.id));
}

/** 폴더 이름 — 화면이 「_블로그 폴더에서 원본을 끄셔도 됩니다」 안내에 쓴다 */
export async function folderName(folderId: number): Promise<string | null> {
  const rows = await db.execute<{ name: string }>(sql`
    SELECT name FROM blog_folder WHERE id = ${folderId}`);
  return rows[0]?.name ?? null;
}

/** 이 폴더의 영상들 — 화면이 「이건 끌지 마시고 동영상 단추로」 안내에 쓴다 */
export async function folderVideos(folderId: number): Promise<{ fileName: string; mb: number }[]> {
  const rows = await db.execute<{ file_name: string; byte_size: number }>(sql`
    SELECT file_name, byte_size FROM blog_photo
    WHERE folder_id = ${folderId} AND is_video = true
    ORDER BY file_name`);
  return rows.map((r) => ({
    fileName: r.file_name,
    mb: Math.round((Number(r.byte_size) / 1024 / 1024) * 10) / 10,
  }));
}

/**
 * 「사진 다시 훑기」 — 폴더를 지정하면 그 폴더만, `hydrate` 면 구름에 있는 것도 내려받는다.
 * 🔴 전체 + hydrate 는 1.3GB 를 받는 일이라 화면에서 못 하게 한다.
 */
export async function requestScan(
  folderId?: number,
  hydrate = false,
): Promise<{ ok: true; jobId: number } | { ok: false; error: string }> {
  if (!(await hasPerm("marketing"))) return { ok: false, error: "마케팅 권한이 없습니다" };

  let folderName: string | undefined;
  if (folderId) {
    const rows = await db.execute<{ name: string }>(sql`SELECT name FROM blog_folder WHERE id = ${folderId}`);
    folderName = rows[0]?.name;
    if (!folderName) return { ok: false, error: "폴더를 찾지 못했습니다" };
  }
  if (!folderName && hydrate) return { ok: false, error: "전체 내려받기는 폴더를 하나 고르고 해 주세요" };

  const r = await requestBlogJob("스캔", { ...(folderName ? { folderName } : {}), hydrate });
  return r.ok ? { ok: true, jobId: r.jobId } : r;
}

/** 폴더에 판매 건을 이어 둔다 — 다음 방문 때 다시 안 묻는다 */
export async function linkFolderToQuote(
  folderId: number,
  quoteId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await hasPerm("marketing"))) return { ok: false, error: "마케팅 권한이 없습니다" };
  await db.execute(sql`UPDATE blog_folder SET quote_id = ${quoteId} WHERE id = ${folderId}`);
  return { ok: true };
}

/** 폴더명 번호판으로 차량·최근 판매를 찾아 이어 둔다 (대리인 스캔 뒤 앱이 부른다) */
export async function autoLinkFolders(): Promise<number> {
  const rows = await db.execute<{ id: number; quote_id: number }>(sql`
    UPDATE blog_folder f
    SET quote_id = m.quote_id, vehicle_id = m.vehicle_id
    FROM (
      SELECT f2.id AS folder_id, v.id AS vehicle_id,
             (SELECT q.id FROM quote q
               WHERE q.vehicle_id = v.id AND q.status = '성사'
               ORDER BY q.work_date DESC NULLS LAST, q.id DESC LIMIT 1) AS quote_id
      FROM blog_folder f2
      JOIN vehicle v ON v.plate_no_norm = f2.plate
      WHERE f2.quote_id IS NULL AND f2.plate IS NOT NULL AND f2.is_gone = false
    ) m
    WHERE f.id = m.folder_id AND m.quote_id IS NOT NULL
    RETURNING f.id, f.quote_id`);
  return rows.length;
}

/** 폴더 화면이 쓰는 것 — 이어진 판매의 시공 요약 */
export async function folderSaleSummary(
  quoteId: number,
): Promise<{ quoteNo: string; workDate: string; car: string; mileage: number | null; tires: string } | null> {
  const rows = await db.execute<{
    quote_no: string;
    work_date: string;
    car: string | null;
    mileage: number | string | null;
    tires: string | null;
  }>(sql`
    SELECT q.quote_no, q.work_date::text AS work_date,
           NULLIF(TRIM(CONCAT_WS(' ', COALESCE(mk.name_ko, v.maker_name), v.model,
                    CASE WHEN v.year IS NULL THEN NULL ELSE v.year || '년식' END)), '') AS car,
           COALESCE(q.mileage, v.mileage) AS mileage,
           STRING_AGG(DISTINCT qi.description, ', ') AS tires
    FROM quote q
    LEFT JOIN vehicle v ON v.id = q.vehicle_id
    LEFT JOIN vehicle_maker mk ON mk.code = v.maker_code
    LEFT JOIN quote_item qi ON qi.quote_id = q.id AND qi.line_type = 'tire'
    WHERE q.id = ${quoteId}
    GROUP BY q.quote_no, q.work_date, mk.name_ko, v.maker_name, v.model, v.year, q.mileage, v.mileage`);
  const r = rows[0];
  if (!r) return null;
  return {
    quoteNo: r.quote_no,
    workDate: r.work_date,
    car: r.car ?? "차종 미상",
    mileage: r.mileage === null ? null : Number(r.mileage) || null,
    tires: r.tires ?? "",
  };
}
