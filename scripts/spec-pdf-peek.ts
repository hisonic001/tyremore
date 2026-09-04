/**
 * PDF 설명서가 어떻게 읽히는지 눈으로 본다 (2026-09-04)
 *
 * 자료실 PDF 마다 표 짜임이 조금씩 달라서, 값이 안 나오면 **어디서 어긋났는지**
 * 봐야 한다. 세 단계를 그대로 보여 준다: 원시 자리값 → 격자 → 뽑은 값.
 *
 *   npx tsx scripts/spec-pdf-peek.ts <파일.pdf>            쪽마다 값이 나오는 표만
 *   npx tsx scripts/spec-pdf-peek.ts <파일.pdf> 2          2쪽만
 *   npx tsx scripts/spec-pdf-peek.ts <파일.pdf> 2 --grid   값이 없어도 격자 전부
 *   npx tsx scripts/spec-pdf-peek.ts <파일.pdf> 2 --raw    글자 자리값 그대로
 */
import { readFileSync } from "node:fs";
import { bothUnits, specItem } from "../src/lib/spec-core";
import { gridToText } from "../src/lib/spec-html";
import { harvestGrids } from "../src/lib/spec-manual";
import { itemsFromTextContent, pageToGrids } from "../src/lib/spec-pdf";
import { specFilter } from "../src/lib/spec-verify";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("파일을 알려 주세요:  npx tsx scripts/spec-pdf-peek.ts 설명서.pdf [쪽] [--grid|--raw]");
    process.exit(1);
  }
  const only = process.argv[3] && !process.argv[3].startsWith("--") ? Number(process.argv[3]) : null;
  const showGrid = process.argv.includes("--grid");
  const showRaw = process.argv.includes("--raw");
  const bodyType = process.argv.includes("--body") ? process.argv[process.argv.indexOf("--body") + 1] : undefined;

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true }).promise;
  console.log(`${file} · ${doc.numPages}쪽`);

  for (let p = 1; p <= doc.numPages; p++) {
    if (only && p !== only) continue;
    const page = await doc.getPage(p);
    const items = itemsFromTextContent((await page.getTextContent()) as never);

    if (showRaw) {
      console.log(`\n===== ${p}쪽 글자 자리값 =====`);
      for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
        console.log(`  y=${it.y.toFixed(1).padStart(7)} x=${it.x.toFixed(1).padStart(6)}  ${it.s}`);
      }
      continue;
    }

    for (const g of pageToGrids(items)) {
      const specs = harvestGrids("", [g]);
      if (!specs.length && !showGrid) continue;
      console.log(`\n===== ${p}쪽 · 격자 ${g.cells.length}줄 x ${g.cells[0].length}칸 (머리 ${g.headRows}줄) =====`);
      console.log(gridToText(g));
      if (!specs.length) continue;
      const src = gridToText(g);
      console.log("--- 뽑은 값 ---");
      for (const c of specs) {
        const prob = specFilter(c, src, { bodyType });
        const shown = c.textValue ?? bothUnits(c.numMin!, c.numMax ?? null, c.unit!);
        const q = c.qualifier ? `[${Object.values(c.qualifier).join(" ")}]` : "";
        console.log(
          `  ${prob ? "❌" : "✅"} ${(c.groupLabel ?? "").slice(0, 22).padEnd(22)} ${(specItem(c.item)?.label ?? c.item).padEnd(14)} ${q.padEnd(8)} ${shown}${prob ? "  ← " + prob.reason : ""}`,
        );
      }
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
