/**
 * PDF → 텍스트  (서버 전용 — `invoice.ts`("use server")에서만 부른다)
 *
 * ⚠️ **CMap 데이터가 반드시 필요하다.**
 *    콘티넨탈 인보이스는 한글 CID 폰트를 쓰는데, CMap 없이 열면
 *    "Ensure that the `cMapUrl` API parameter is provided" 경고와 함께
 *    **글자 조각이 0개로 나온다.** 스캔 이미지 PDF 로 착각하기 딱 좋다.
 *    (미쉐린은 CMap 없이도 읽혀서 처음엔 문제를 못 봤다 — 2026-08-01)
 *
 * ⚠️ **줄바꿈을 살려야 한다.** 조각을 공백으로만 이으면 한 줄이 되어
 *    「순번 품번 수량 단가 금액」 같은 줄 단위 규칙이 전부 깨진다.
 *    pdf.js 가 주는 `hasEOL` 로 원래 줄 구조를 되살린다.
 */
export async function pdfToText(bytes: ArrayBuffer): Promise<string> {
  const { createRequire } = await import("node:module");
  const { dirname, join } = await import("node:path");
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve("pdfjs-dist/package.json"));

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    // pdf.js 는 넘긴 버퍼를 가져가 버린다(detach) — 복사본을 준다
    data: new Uint8Array(bytes.slice(0)),
    cMapUrl: join(root, "cmaps") + "/",
    cMapPacked: true,
    standardFontDataUrl: join(root, "standard_fonts") + "/",
    useSystemFonts: false,
  }).promise;

  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!("str" in item)) continue;
      out += item.str;
      if (item.hasEOL) out += "\n";
      else out += " ";
    }
    out += "\n";
  }
  await doc.cleanup();
  return out;
}
