/**
 * 블로그 글을 자로 재 준다 (2026-09-04)
 *
 * 🔴 **네이버는 내 도구에서 하드 차단**이라 남의 블로그를 직접 못 읽는다.
 *    그리고 남의 글을 자동으로 긁는 것은 약관 위반이라 애초에 안 할 일이다.
 *    대신 **사장님이 잘 나가는 글을 골라 메모장에 붙여 폴더에 넣어 주시면**,
 *    우리 글과 **같은 자**를 대서 숫자로 비교할 수 있다.
 *
 * 🔴 **남의 글은 재기만 하고 지시문에는 절대 안 넣는다.** 넣으면 문장을 베끼게 되고,
 *    네이버 유사문서 판정과 저작권에 걸린다. 여기서 나오는 건 숫자뿐이다.
 *
 * 판정 규칙(소제목 세기 등)은 `src/lib/blog-style.ts` 것을 그대로 불러 쓴다 —
 * 자가 두 개면 검사와 측정이 어긋난다.
 *
 *   npx tsx scripts/blog-measure.ts "C:/…/블로그 작업후기"
 *   npx tsx scripts/blog-measure.ts "C:/…/참고글" --label 비교군
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { subheads } from "../src/lib/blog-style";

interface Measured {
  name: string;
  title: string;
  titleLen: number;
  headWord: string | null;
  chars: number;
  lines: number;
  avgLine: number;
  subs: number;
  photos: number;
  videos: number;
  qa: boolean;
  summary: boolean;
  tags: number;
}

/** 제목 앞부분에 있어야 할 말 — blog-style 의 규칙과 같은 것을 본다 */
const HEAD_WORDS = ["속초", "타이어", "얼라인먼트", "배터리", "엔진오일", "휠", "공기압", "교체", "밸런스", "TPMS", "점검"];
const TITLE_HEAD = 12;

function measure(name: string, text: string): Measured {
  const raw = text.split("\n");
  const body = raw.map((l) => l.trim()).filter(Boolean);
  const title = body[0] ?? "";
  const head = title.slice(0, TITLE_HEAD);
  const tagLine = body.find((l) => l.startsWith("#")) ?? "";
  return {
    name,
    title,
    titleLen: title.length,
    headWord: HEAD_WORDS.find((w) => head.includes(w)) ?? null,
    chars: text.replace(/\s/g, "").length,
    lines: body.length,
    avgLine: Math.round(body.reduce((s, l) => s + l.length, 0) / Math.max(1, body.length)),
    subs: subheads(text).length,
    photos: (text.match(/\[사진[^\]]*\]/g) ?? []).length,
    videos: (text.match(/\[영상[^\]]*\]|🎬/g) ?? []).length,
    qa: /많이\s*물어|자주\s*묻|Q&A/.test(text),
    summary: /^\s*오늘\s*정리\s*$/m.test(text),
    tags: (tagLine.match(/#/g) ?? []).length,
  };
}

/** 폴더를 한 겹 파고들며 글 파일을 모은다 */
async function collect(root: string): Promise<{ name: string; text: string }[]> {
  const out: { name: string; text: string }[] = [];
  const take = async (dir: string, depth: number) => {
    let items: string[];
    try {
      items = await readdir(dir);
    } catch {
      return;
    }
    for (const f of items) {
      const full = path.join(dir, f);
      let s: Awaited<ReturnType<typeof stat>>;
      try {
        s = await stat(full);
      } catch {
        continue; // 구름에만 있으면 조용히 넘어간다
      }
      if (s.isDirectory()) {
        if (depth < 2) await take(full, depth + 1);
        continue;
      }
      if (!/\.(txt|md)$/i.test(f)) continue;
      if (/제출양식/.test(f)) continue; // 입력 양식은 글이 아니다
      try {
        const text = await readFile(full, "utf8");
        if (text.trim().length >= 400) out.push({ name: path.basename(dir), text });
      } catch {
        /* 못 읽으면 넘어간다 */
      }
    }
  };
  await take(root, 0);
  return out;
}

function pad(s: string | number, n: number): string {
  const t = String(s);
  return t.length >= n ? t : t + " ".repeat(n - t.length);
}

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('폴더를 알려 주세요:  npx tsx scripts/blog-measure.ts "C:/…/블로그 작업후기"');
    process.exit(1);
  }
  const label = process.argv.includes("--label") ? process.argv[process.argv.indexOf("--label") + 1] : "우리 글";
  const files = await collect(dir);
  if (!files.length) {
    console.error(`글을 못 찾았습니다: ${dir}`);
    console.error("글 하나를 메모장에 붙여 .txt 로 저장해 주세요 (첫 줄에 제목도 같이).");
    process.exit(1);
  }

  const rows = files.map((f) => measure(f.name, f.text));
  console.log(`\n[${label}] ${rows.length}편 — ${dir}\n`);
  console.log("  제목자  앞말   글자   줄  줄평균 소제목 사진 영상 정리 Q&A 태그  이름");
  for (const r of rows) {
    console.log(
      `  ${pad(r.titleLen + (r.titleLen > 32 ? "⚠" : " "), 6)} ${pad(r.headWord ?? "❌", 6)} ${pad(r.chars, 6)} ${pad(r.lines, 4)} ${pad(r.avgLine, 5)} ${pad(r.subs + (r.subs < 4 ? "⚠" : " "), 6)} ${pad(r.photos, 4)} ${pad(r.videos, 4)} ${pad(r.summary ? "○" : "✗", 4)} ${pad(r.qa ? "○" : "✗", 3)} ${pad(r.tags, 4)} ${r.name}`,
    );
  }

  const avg = (f: (r: Measured) => number) => Math.round(rows.reduce((s, r) => s + f(r), 0) / rows.length);
  console.log(
    `\n  평균 — 제목 ${avg((r) => r.titleLen)}자 · 글자 ${avg((r) => r.chars)} · 줄평균 ${avg((r) => r.avgLine)}자 · 소제목 ${avg((r) => r.subs)}개 · 사진 ${avg((r) => r.photos)}개`,
  );
  const bad = rows.filter((r) => r.titleLen > 32 || !r.headWord || r.subs < 4);
  console.log(
    `  새 기준(제목 32자·앞 12자에 찾는 말·소제목 4개)으로 보면 ${rows.length}편 중 ${bad.length}편이 걸립니다`,
  );
  console.log("\n  ⚠ = 기준 밖 · ❌ = 제목 앞 12자에 「속초」나 작업 이름이 없음");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
