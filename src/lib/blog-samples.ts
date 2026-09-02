/**
 * 사장님이 실제로 발행한 글을 문체 예시로 읽어 온다 (2026-09-02)
 *
 * 🔴 **매장 PC 에서만 돈다** — 원고를 만드는 것은 대리인(scripts/blog-agent.ts)이고,
 *    글 파일은 사장님 사진 폴더 안에 있다. Vercel 에는 그 폴더가 없다.
 *    못 읽으면 빈 배열을 돌려주고, 그때는 규칙만으로 쓴다 (blog-style.buildSystem).
 *
 * 🔴 저장소에 글을 복사해 두지 않는다 — 개인정보는 깃허브로 나가지 않는다는 원칙(D-13).
 *    (확인함: 이 글 3편에는 번호판·전화번호가 하나도 없다. 그래도 원칙을 지킨다.)
 *
 * 폴더는 `BLOG_WORK_DIR` 로 바꿀 수 있다. 기본값은 사장님이 쓰시는 그 폴더다.
 */

const DEFAULT_DIR = "C:/Users/info/OneDrive/문서/카카오톡 받은 파일/블로그 작업후기";

/** 예시로 넣기 좋은 길이 — 너무 길면 지시문이 무거워진다 */
const MAX_CHARS = 3600;

export function blogWorkDir(): string {
  return process.env.BLOG_WORK_DIR || DEFAULT_DIR;
}

/**
 * 폴더에서 `블로그_포스팅_*.txt` 를 찾아 짧은 것부터 최대 2편.
 * 짧은 쪽을 먼저 쓰는 이유: 지시문이 가벼워야 본문 쓸 여력이 남는다.
 */
export async function loadStyleSamples(max = 2): Promise<string[]> {
  try {
    const { readdir, readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const root = blogWorkDir();
    const dirs = await readdir(root, { withFileTypes: true });

    const found: { text: string; len: number }[] = [];
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      let files: string[];
      try {
        files = await readdir(path.join(root, d.name));
      } catch {
        continue;
      }
      for (const f of files) {
        if (!/^블로그_포스팅_.*\.txt$/.test(f)) continue;
        try {
          const text = await readFile(path.join(root, d.name, f), "utf8");
          if (text.trim().length >= 800) found.push({ text: text.slice(0, MAX_CHARS), len: text.length });
        } catch {
          /* 구름에만 있어 못 읽으면 건너뛴다 */
        }
      }
    }
    return found
      .sort((a, b) => a.len - b.len)
      .slice(0, max)
      .map((f) => f.text);
  } catch {
    return [];
  }
}
