import { config } from "dotenv";
config({ path: ".env.local" });

/** 브랜드마다 다른 바코드를 「찍으면서 배우는」 흐름 검증. */
async function main() {
  const { readFile } = await import("node:fs/promises");
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  const { lookupBarcode, linkBarcode } = await import("../src/lib/barcode-lookup");
  const { saveInvoice, pendingInvoices, receiveByScan } = await import("../src/lib/invoice");

  const MI = "441358261D590A"; // 미쉐린 라벨 (앞 6자리 = CAI)
  const HK = "8808563590301"; // 한국타이어 EAN-13

  console.log("① 처음 상태에서 찾아보기");
  for (const c of [MI, HK]) {
    const h = await lookupBarcode(c);
    console.log(`   ${c.padEnd(16)} → ${h ? `✅ ${h.model} (${h.via})` : "❌ 모름"}`);
  }

  console.log("\n② 한국타이어 EAN-13 을 상품에 이어 준다");
  const [hk] = await db.execute<{ id: number; pattern: string }>(
    sql`SELECT id, COALESCE(display_name,pattern) pattern FROM product WHERE mars_item_no='HK1033085'`,
  );
  const r = await linkBarcode({ code: HK, productId: hk.id, kind: "exact" });
  console.log(`   ${r.ok ? `✅ ${hk.pattern} 에 연결` : "❌ " + r.error}`);

  console.log("\n③ 다시 찾아보기 — 이제 알아본다");
  for (const c of [MI, HK]) {
    const h = await lookupBarcode(c);
    console.log(
      `   ${c.padEnd(16)} → ${h ? `✅ ${String(h.model).slice(0, 26)} (${h.via}) 개별 ${h.serial ?? "—"}` : "❌ 모름"}`,
    );
  }

  console.log("\n④ 같은 상품 다른 개별번호도 인식하는가 (미쉐린식 prefix)");
  const [mi] = await db.execute<{ id: number }>(sql`SELECT id FROM product WHERE mars_item_no='441358'`);
  await linkBarcode({ code: "441358", productId: mi.id, kind: "prefix" });
  for (const c of ["441358261D590A", "441358AA11BB22", "441358999XYZ"]) {
    const h = await lookupBarcode(c);
    console.log(`   ${c.padEnd(16)} → ${h ? `✅ 개별 ${h.serial} (${h.via})` : "❌"}`);
  }

  console.log("\n⑤ 스캔 입고");
  const buf = await readFile("C:/dev/tyremore-data/invoice-michelin-sample.xlsx");
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  await saveInvoice("mi.xlsx", bytes, { updatePrices: false });
  for (const c of ["441358261D590A", "441358AA11BB22"]) {
    const res = await receiveByScan(c);
    console.log(
      res.ok ? `   ✅ ${res.line.model} 1본 · 개별 ${res.serial} · 남은 ${res.remain}본 (${res.via})` : `   ❌ ${res.error}`,
    );
  }

  console.log("\n⑥ 정리");
  await db.execute(sql`
    WITH v AS (SELECT id FROM stock_item WHERE stock_no LIKE 'S%'),
         d AS (DELETE FROM stock_movement WHERE stock_item_id IN (SELECT id FROM v) RETURNING 1)
    DELETE FROM stock_item WHERE id IN (SELECT id FROM v)
  `);
  await db.execute(sql`DELETE FROM purchase_invoice`);
  await db.execute(sql`DELETE FROM product_barcode`);
  const [c] = await db.execute<{ p: number; s: number; b: number }>(sql`
    SELECT (SELECT count(*)::int FROM product) p, (SELECT count(*)::int FROM stock_item) s,
           (SELECT count(*)::int FROM product_barcode) b
  `);
  console.log(`   상품 ${c.p} (10,955) · 재고 ${c.s} (561) · 바코드 ${c.b} (0)`);
  process.exit(0);
}
main();
