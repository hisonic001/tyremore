/**
 * 사진 폴더 훑기 — **매장 PC 전용** (C단계, 2026-09-02)
 *
 * 사장님 폴더(`블로그 작업후기`)를 읽어 `blog_folder` · `blog_photo` 에 넣는다.
 *
 * 🔴 **원본은 서버로 안 보낸다.** 폴더 하나가 248MB, 전체 1.3GB 다.
 *    보내는 것은 160px 썸네일뿐 — 장당 13KB 안팎, 전 폴더를 담아도 5MB 수준이다.
 *
 * 🔴 OneDrive 「파일 온디맨드」 — 18개 폴더 중 8개가 구름에만 있다.
 *    `fs.stat().blocks === 0` 이면 구름 파일이다 (실측 확인: 구름 3,707,484바이트인데
 *    blocks=0, 로컬 파일은 blocks=4784). 구름 파일은 **썸네일을 안 만든다** —
 *    만들려고 읽으면 OneDrive 가 통째로 내려받아 스캔이 몇 분씩 걸린다.
 *    화면에 「구름에만 있음」으로 표시하고, 원고 만들 때 그때 내려받는다.
 *
 * 이 파일은 대리인(scripts/blog-agent.ts)만 부른다 — Vercel 에는 이 폴더가 없다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { blogWorkDir } from "./blog-samples";
import { isPhoto, isVideo, parseFolderName } from "./blog-folder-core";

/** 사장님 폴더는 73장짜리도 있다 — 목록용 썸네일은 작게, 빠르게 */
export const THUMB_PX = 160;
export const THUMB_Q = 55;

/**
 * 🔴 **발행용** — 화면 「사진 순서」에서 끌어다 네이버 글쓰기에 붙이는 그림이다 (2026-09-05).
 *
 * 브라우저는 끌 때 화면에 보이는 크기가 아니라 **그림 파일 자체**를 넘긴다. 그래서
 * 미리보기(160px)를 끌면 160px 이 그대로 블로그에 올라간다 — 사장님이 지적하신 그 화질이다.
 *
 * 1280px 인 이유: 네이버가 어차피 **본문 폭 966px 로 다시 줄인다.** 원본(2.7MB)을 올려도
 * 독자가 보는 화질은 같고 올리는 시간만 10배다. 1280/q82 면 장당 150~280KB 로 끝난다.
 */
export const PUBLISH_PX = 1280;
export const PUBLISH_Q = 82;

/** 썸네일은 sharp 로. 없으면 미리보기 없이 목록만 만든다 (화면이 회색 칸으로 보여준다) */
type SharpFn = (input: Buffer) => {
  rotate(): ReturnType<SharpFn>;
  resize(w: number, h: number, o: { fit: string; withoutEnlargement: boolean }): ReturnType<SharpFn>;
  jpeg(o: { quality: number }): ReturnType<SharpFn>;
  toBuffer(): Promise<Buffer>;
};

/** undefined = 아직 안 찾아봤다 · null = 없다 */
let sharpFn: SharpFn | null | undefined;

async function loadSharp(): Promise<SharpFn | null> {
  if (sharpFn !== undefined) return sharpFn;
  try {
    sharpFn = ((await import("sharp")) as unknown as { default: SharpFn }).default;
  } catch {
    sharpFn = null;
  }
  return sharpFn;
}

/**
 * 사진 한 장을 정해진 크기의 JPEG(base64)로 굽는다. sharp 가 없으면 null.
 *
 * 🔴 **자는 하나뿐이어야 한다.** 목록용도 발행용도 이 길로만 굽는다 —
 *    같은 일을 두 군데에 적어 두면 한쪽만 고쳐져 어긋난다.
 */
export async function makeJpeg(buf: Buffer, px: number, q: number): Promise<string | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;
  const out = await sharp(buf)
    .rotate()
    .resize(px, px, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: q })
    .toBuffer();
  return out.toString("base64");
}

export interface ScanResult {
  folders: number;
  photos: number;
  newThumbs: number;
  offline: number;
  gone: number;
}

/** 파일이 구름에만 있는가 — 로컬에 실물이 없으면 blocks 가 0이다 */
function isCloudOnly(st: { blocks: number; size: number }): boolean {
  return st.size > 0 && st.blocks === 0;
}

export interface ScanOpts {
  /** 이 폴더 하나만 (폴더명 그대로). 비우면 전체 */
  only?: string;
  /**
   * 🔴 구름에만 있는 사진을 **실제로 내려받아** 미리보기를 만든다.
   *
   * 전체 스캔에서는 절대 켜지 않는다 — 사장님 폴더는 1.3GB 이고 절반이 구름에 있어
   * 통째로 받으면 몇십 분이 걸린다. 「이 폴더 사진 내려받기」를 누르셨을 때만 켠다
   * (폴더 하나면 보통 20~150MB, 1~2분).
   */
  hydrate?: boolean;
}

export async function scanFolders(onLog?: (s: string) => void, opts: ScanOpts = {}): Promise<ScanResult> {
  const { readdir, stat, readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const root = blogWorkDir();
  const log = onLog ?? (() => {});

  let dirs: string[];
  try {
    dirs = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    throw new Error(`사진 폴더를 열지 못했습니다: ${root} (BLOG_WORK_DIR 을 확인해 주세요)`);
  }
  if (opts.only) dirs = dirs.filter((d) => d === opts.only);
  log(opts.only ? `폴더 「${opts.only}」 하나를 봅니다` : `폴더 ${dirs.length}개를 찾았습니다`);

  const sharp = await loadSharp();
  if (!sharp) log("⚠️ 썸네일 도구(sharp)를 못 찾아 미리보기 없이 목록만 만듭니다");

  const res: ScanResult = { folders: 0, photos: 0, newThumbs: 0, offline: 0, gone: 0 };
  const seen: string[] = [];

  for (const name of dirs) {
    const parsed = parseFolderName(name);
    const dirPath = path.join(root, name);
    let files: string[];
    let dirStat: { mtime: Date };
    try {
      files = await readdir(dirPath);
      dirStat = await stat(dirPath);
    } catch {
      continue;
    }

    const photos = files.filter(isPhoto);
    const videos = files.filter(isVideo);

    const [folder] = await db.execute<{ id: number }>(sql`
      INSERT INTO blog_folder (name, label, plate, is_pending, photo_count, video_count, folder_mtime, is_gone, scanned_at)
      VALUES (${name}, ${parsed.label}, ${parsed.plate}, ${parsed.isPending},
              ${photos.length}, ${videos.length}, ${dirStat.mtime.toISOString()}, false, now())
      ON CONFLICT (name) DO UPDATE
        SET label = EXCLUDED.label, plate = EXCLUDED.plate, is_pending = EXCLUDED.is_pending,
            photo_count = EXCLUDED.photo_count, video_count = EXCLUDED.video_count,
            folder_mtime = EXCLUDED.folder_mtime, is_gone = false, scanned_at = now()
      RETURNING id`);
    const folderId = Number(folder.id);
    seen.push(name);
    res.folders += 1;

    /** 이미 썸네일이 있는 것은 다시 만들지 않는다 — 73장짜리를 매번 다시 굽지 않게 */
    const have = await db.execute<{ file_name: string; thumb: string | null }>(sql`
      SELECT file_name, thumb FROM blog_photo WHERE folder_id = ${folderId}`);
    const haveMap = new Map(have.map((h) => [h.file_name, h.thumb]));

    let offlineHere = 0;
    for (const f of [...photos, ...videos]) {
      const full = path.join(dirPath, f);
      let st: Awaited<ReturnType<typeof stat>>;
      try {
        st = await stat(full);
      } catch {
        continue;
      }
      let cloud = isCloudOnly(st);
      const video = isVideo(f);

      let thumb: string | null = haveMap.get(f) ?? null;
      /**
       * 구름 파일은 평소엔 굽지 않는다 — 읽는 순간 OneDrive 가 통째로 내려받아
       * 전체 스캔이 몇십 분이 된다 (사진 404장 중 200장이 구름에 있다).
       * 사장님이 「이 폴더 사진 내려받기」를 누르셨을 때만 받아서 굽는다.
       */
      if (!thumb && !video && sharp && (!cloud || opts.hydrate)) {
        try {
          const buf = await readFile(full);
          if (cloud) cloud = false; // 읽는 데 성공했으면 이제 로컬에 있다
          thumb = await makeJpeg(buf, THUMB_PX, THUMB_Q);
          if (thumb) res.newThumbs += 1;
        } catch {
          thumb = null;
        }
      }
      if (cloud) offlineHere += 1;

      await db.execute(sql`
        INSERT INTO blog_photo (folder_id, file_name, byte_size, is_offline, is_video, taken_at, thumb)
        VALUES (${folderId}, ${f}, ${Math.min(st.size, 2_000_000_000)}, ${cloud}, ${video},
                ${st.mtime.toISOString()}, ${thumb})
        ON CONFLICT (folder_id, file_name) DO UPDATE
          SET byte_size = EXCLUDED.byte_size, is_offline = EXCLUDED.is_offline,
              taken_at = EXCLUDED.taken_at,
              thumb = COALESCE(blog_photo.thumb, EXCLUDED.thumb)`);
      res.photos += 1;
    }

    await db.execute(sql`UPDATE blog_folder SET offline_count = ${offlineHere} WHERE id = ${folderId}`);
    res.offline += offlineHere;
    log(
      `  ${parsed.isPending ? "(미업로드) " : ""}${parsed.label} — 사진 ${photos.length}장` +
        (videos.length ? `, 영상 ${videos.length}` : "") +
        (offlineHere ? ` · 구름에만 ${offlineHere}장` : ""),
    );
  }

  /** 사라진 폴더는 지우지 않고 감춘다 (삭제는 하지 않는다는 관례). 한 폴더만 볼 땐 건너뛴다 */
  if (seen.length && !opts.only) {
    const goneRows = await db.execute<{ id: number }>(sql`
      UPDATE blog_folder SET is_gone = true
      WHERE is_gone = false
        AND name NOT IN (${sql.join(seen.map((s) => sql`${s}`), sql`, `)})
      RETURNING id`);
    res.gone = goneRows.length;
  }

  log(
    `끝. 폴더 ${res.folders}개 · 사진 ${res.photos}장 · 새 미리보기 ${res.newThumbs}장` +
      (res.offline ? ` · 구름에만 ${res.offline}장` : "") +
      (res.gone ? ` · 사라진 폴더 ${res.gone}개` : ""),
  );
  return res;
}
