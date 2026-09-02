/**
 * 사진을 AI 에 보이고, 순서대로 복사본을 만든다 — **매장 PC 전용** (C단계, 2026-09-02)
 *
 * 🔴 원본 폴더를 그대로 열어 주면 안 된다. 폴더 이름이 `264저6834 벤츠 GLS` 라
 *    **경로만으로 번호판이 국외 서버로 나간다.** 그래서 임시 폴더에 `p00.jpg` 로
 *    복사해 그 폴더만 열고, 끝나면 지운다.
 *
 * 🔴 구름에만 있는 사진은 읽을 때 OneDrive 가 내려받는다 — 장당 30초 제한을 두고,
 *    못 받은 것은 빼고 로그에 남긴다. **가장 나쁜 실패는 실패가 아니라 조용한 성공**이라
 *    (사진 없는 글이 그냥 나오는 것) 모델에게 받은 목록을 먼저 말하게 하고 개수를 대조한다.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { blogWorkDir } from "./blog-samples";
import { copyFileName } from "./blog-folder-core";

/** 🔴 사장님 결정 (2026-09-02) — 고른 것 중 앞 12장까지만 AI 가 본다 */
export const AI_MAX_PHOTOS = 12;

/** 구름에서 한 장 받는 데 이보다 오래 걸리면 포기한다 */
const HYDRATE_MS = 30_000;

export interface PreparedPhoto {
  photoId: number;
  /** 임시 폴더 안의 이름 — `p00.jpg`. 번호판이 없다 */
  tempName: string;
  /** 원본 파일 이름 — 복사본을 만들 때 쓴다 */
  fileName: string;
}

export interface Prepared {
  dir: string;
  photos: PreparedPhoto[];
  /** 못 받아서 뺀 사진 이름들 */
  skipped: string[];
  cleanup: () => Promise<void>;
}

/** 파일 하나를 제한 시간 안에 읽는다 (구름이면 그 사이 내려받힌다) */
async function readWithTimeout(full: string, ms: number): Promise<Buffer | null> {
  const { readFile } = await import("node:fs/promises");
  return Promise.race([
    readFile(full).catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), ms)),
  ]);
}

/**
 * 고른 사진을 임시 폴더에 `p00.jpg` … 로 복사한다. AI 에는 이 폴더만 열어 준다.
 * @param photoIds 고른 순서 그대로
 */
export async function preparePhotosForAi(
  folderId: number,
  photoIds: number[],
  onLog?: (s: string) => void,
): Promise<Prepared> {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const log = onLog ?? (() => {});

  const rows = await db.execute<{ id: number; file_name: string; folder_name: string; is_video: boolean }>(sql`
    SELECT p.id, p.file_name, f.name AS folder_name, p.is_video
    FROM blog_photo p JOIN blog_folder f ON f.id = p.folder_id
    WHERE p.folder_id = ${folderId}`);
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const folderName = rows[0]?.folder_name;
  if (!folderName) return { dir: "", photos: [], skipped: [], cleanup: async () => {} };

  const srcDir = path.join(blogWorkDir(), folderName);
  const dir = await mkdtemp(path.join(os.tmpdir(), "tyremore-blog-"));

  const photos: PreparedPhoto[] = [];
  const skipped: string[] = [];
  let n = 0;
  for (const id of photoIds) {
    if (photos.length >= AI_MAX_PHOTOS) break;
    const r = byId.get(Number(id));
    if (!r || r.is_video) continue;
    const buf = await readWithTimeout(path.join(srcDir, r.file_name), HYDRATE_MS);
    if (!buf) {
      skipped.push(r.file_name);
      continue;
    }
    const ext = path.extname(r.file_name).toLowerCase() || ".jpg";
    const tempName = `p${String(n).padStart(2, "0")}${ext}`;
    await writeFile(path.join(dir, tempName), buf);
    photos.push({ photoId: Number(id), tempName, fileName: r.file_name });
    n += 1;
  }

  log(`사진 ${photos.length}장 준비 완료${skipped.length ? ` (구름에서 못 받아 뺀 것 ${skipped.length}장)` : ""}`);
  if (skipped.length) log(`  ⚠️ 뺀 사진: ${skipped.slice(0, 3).join(", ")}${skipped.length > 3 ? " 외" : ""}`);

  return {
    dir,
    photos,
    skipped,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/**
 * 모델이 준 사진 계획대로 **원본 폴더 안 `_블로그\`** 에 순서대로 복사한다.
 *
 * 사장님이 벤츠 GLS 폴더에 손수 `A-00 계기판 주행거리.jpg` 로 해 두신 방식 그대로다.
 * 밑줄이 앞이라 폴더 목록 맨 위에 오고, 원본 폴더가 OneDrive 안이라 **폰에서도 보인다**
 * — 폰의 OneDrive 앱에서 위에서부터 차례로 올리시면 된다.
 */
export async function makeOrderedCopies(
  folderId: number,
  plan: { photoId: number; slot: string; caption: string }[],
  onLog?: (s: string) => void,
): Promise<string | null> {
  const { mkdir, copyFile, rm } = await import("node:fs/promises");
  const path = await import("node:path");
  const log = onLog ?? (() => {});

  const rows = await db.execute<{ id: number; file_name: string; folder_name: string }>(sql`
    SELECT p.id, p.file_name, f.name AS folder_name
    FROM blog_photo p JOIN blog_folder f ON f.id = p.folder_id
    WHERE p.folder_id = ${folderId}`);
  const byId = new Map(rows.map((r) => [Number(r.id), r.file_name]));
  const folderName = rows[0]?.folder_name;
  if (!folderName || plan.length === 0) return null;

  const srcDir = path.join(blogWorkDir(), folderName);
  const outDir = path.join(srcDir, "_블로그");
  await rm(outDir, { recursive: true, force: true }).catch(() => {});
  await mkdir(outDir, { recursive: true });

  let made = 0;
  for (const p of plan) {
    const file = byId.get(Number(p.photoId));
    if (!file) continue;
    const ext = path.extname(file).toLowerCase() || ".jpg";
    const dest = path.join(outDir, copyFileName(p.slot, p.caption, ext));
    try {
      await copyFile(path.join(srcDir, file), dest);
      made += 1;
    } catch {
      /* 못 읽으면 건너뛴다 */
    }
  }
  log(`사진 ${made}장을 「_블로그」 폴더에 순서대로 복사했습니다`);
  return made > 0 ? outDir : null;
}
