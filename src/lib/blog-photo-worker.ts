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
import { copyFileName, isVideo } from "./blog-folder-core";
import { PUBLISH_PX, PUBLISH_Q, makeJpeg } from "./blog-scan";

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

  /**
   * 🔴 **영상도 같이 넣는다** (2026-09-05, 사장님 질문에서).
   *
   * 영상은 사진과 길이 다르다 — 네이버는 영상을 자기 「동영상」 단추로만 받는다.
   * 웹 화면에서 끌어다 붙이는 길이 **아예 없다.** 그러니 프로그램이 할 수 있는 일은
   * **사장님 손이 닿는 자리에 순서대로 놓아 드리는 것**뿐이다.
   *
   * 어느 영상을 쓸지는 고르지 않는다 — 나는 영상 안을 못 본다. 밸런서인지 토크렌치인지
   * 모르면서 고르는 척하면 안 된다. 찍은 순서대로 V-00, V-01 … 로 놓고 사장님이 고르신다.
   */
  const vids = [...byId.values()].filter(isVideo).sort((a, b) => a.localeCompare(b));
  let vmade = 0;
  for (const [i, file] of vids.entries()) {
    const ext = path.extname(file).toLowerCase() || ".mp4";
    const dest = path.join(outDir, copyFileName(`V-${String(i).padStart(2, "0")}`, "작업 영상", ext));
    try {
      await copyFile(path.join(srcDir, file), dest);
      vmade += 1;
    } catch {
      /* 구름에만 있으면 건너뛴다 — 영상은 크다 */
    }
  }

  log(`사진 ${made}장${vmade ? ` · 영상 ${vmade}개` : ""}를 「_블로그」 폴더에 순서대로 복사했습니다`);
  return made > 0 ? outDir : null;
}

/**
 * ⭐ **발행용 사진**을 구워 창고에 올린다 — 끌어다 놓기용 (2026-09-05)
 *
 * 🔴 왜 필요한가: 화면 「사진 순서」의 그림은 **목록용 160px 미리보기**다. 브라우저는 끌 때
 *    화면에 보이는 크기가 아니라 그림 파일 자체를 넘기므로, 그걸 끌면 160px 이 그대로
 *    블로그에 올라간다. 사장님이 「화질이 너무 안 좋다」고 하신 것이 이것이다.
 *
 * 🔴 마침 좋은 자리다: 원고를 만들 때 `preparePhotosForAi()` 가 구름 사진까지 이미
 *    로컬로 받아 놨다. 그래서 여기서 굽는 데 **추가로 내려받을 것이 없다.**
 *
 * 🔴 글에 든 사진만 굽는다. 폴더 사진을 전부 구우면 451장 = 130MB 이고, 대부분 안 쓴다.
 */
export async function uploadPublishImages(
  folderId: number,
  plan: { photoId: number; slot: string; caption: string }[],
  onLog?: (s: string) => void,
): Promise<number> {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const log = onLog ?? (() => {});
  if (plan.length === 0) return 0;

  const rows = await db.execute<{ id: number; file_name: string; folder_name: string; has_publish: boolean }>(sql`
    SELECT p.id, p.file_name, f.name AS folder_name, (p.publish IS NOT NULL) AS has_publish
    FROM blog_photo p JOIN blog_folder f ON f.id = p.folder_id
    WHERE p.folder_id = ${folderId} AND p.is_video = false`);
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const folderName = rows[0]?.folder_name;
  if (!folderName) return 0;

  const srcDir = path.join(blogWorkDir(), folderName);
  let made = 0;
  let skipped = 0;

  /** 🔴 한 장씩 순차로 — Promise.all 금지. 동시 질의가 풀을 채워 전면 마비된 전례가 있다 */
  for (const p of plan) {
    const r = byId.get(Number(p.photoId));
    if (!r || r.has_publish) continue; // 이미 있으면 다시 안 굽는다
    let b64: string | null = null;
    try {
      const buf = await readFile(path.join(srcDir, r.file_name));
      b64 = await makeJpeg(buf, PUBLISH_PX, PUBLISH_Q);
    } catch {
      b64 = null;
    }
    if (!b64) {
      skipped += 1;
      continue;
    }
    await db.execute(sql`UPDATE blog_photo SET publish = ${b64} WHERE id = ${r.id}`);
    made += 1;
  }

  if (made) log(`발행용 사진 ${made}장을 만들었습니다 (${PUBLISH_PX}px)`);
  if (skipped) log(`  ⚠️ 못 만든 사진 ${skipped}장 — 구름에만 있거나 파일이 없습니다`);
  return made;
}
