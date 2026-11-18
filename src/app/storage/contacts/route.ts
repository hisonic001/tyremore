import * as XLSX from "xlsx";
import { hasPerm } from "@/lib/auth";
import { contactRows } from "@/lib/tire-storage-data";
import { contactKindFor, contactTargets, type StorageKind } from "@/lib/tire-storage-pure";
import { formatPhone } from "@/lib/normalize";

export const dynamic = "force-dynamic";

/**
 * ⭐ 환절기 연락 명단 엑셀 (D-42 4단계) — 전화번호 명단이라 「고객」 권한.
 *   CSV 대신 xlsx — 엑셀이 CSV 한글을 깨뜨린다. 파일명 규칙은 stock/export 와 같다.
 *   🔴 이 파일은 손님 연락처다 — 메신저·메일로 돌리지 않는다(CLAUDE.md 보안 규칙).
 */
export async function GET(req: Request) {
  if (!(await hasPerm("customer"))) return new Response("고객 권한이 없습니다", { status: 403 });
  const k = new URL(req.url).searchParams.get("kind");
  const kind: StorageKind = k === "스노" || k === "일반" ? k : contactKindFor(Number(new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(5, 7))); // 한국 시각 달
  const targets = contactTargets(await contactRows(), kind);
  const ws = XLSX.utils.json_to_sheet(
    targets.map((t) => ({
      이름: t.name,
      전화: t.phone ? formatPhone(t.phone) : "",
      차량: t.plates.join(", "),
      "맡긴 세트": t.sets.join(" / "),
      "맡긴 날(가장 오래)": t.oldest,
      마케팅동의: t.consentMarketing ? "동의" : "미동의",
      연락함: "",
    })),
  );
  ws["!cols"] = [{ wch: 14 }, { wch: 15 }, { wch: 18 }, { wch: 48 }, { wch: 14 }, { wch: 10 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${kind} 맡긴 손님`);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const stamp = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const name = `타이어모어-보관연락-${kind}-${stamp}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="tyremore-storage-contacts-${stamp}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
