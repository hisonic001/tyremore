import { buildStockWorkbook } from "@/lib/stock-sheet";

export const dynamic = "force-dynamic";

/**
 * 재고를 엑셀(.xlsx)로 내려받는다.
 *
 * 파일 이름에 날짜를 넣는다 — 실사는 여러 번 하게 되고, 다운로드 폴더에서
 * 어느 날 것인지 구분되어야 한다.
 */
export async function GET() {
  const buf = await buildStockWorkbook();
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const name = `타이어모어-재고-${stamp}.xlsx`;

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // 한글 파일명은 filename* (RFC 5987) 로 보내야 안 깨진다
      "Content-Disposition": `attachment; filename="tyremore-stock-${stamp}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
