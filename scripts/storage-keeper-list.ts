/**
 * ⭐ 경리 정리 명단 → 보관 실사 체크표 (D-42, 사장님 지시 2026-11-17)
 *
 *   「2026 일반 보관 타이어.txt」 — 날짜 줄(2026/11/09) 아래 「-차량번호 차종 이름 전화 [규격 브랜드 N개]」.
 *   한 줄 끝에 다른 차의 「…스노 보관탈부착」이 붙어 있으면 그건 찾아간 기록이라 뺀다.
 *
 *   - 이미 확인대기 후보가 있는 차 → 브랜드·규격·본수를 명단 값으로 고치고 「경리 명단에 있음」
 *   - 후보 없는 차 → 새 확인대기 (그날 ±3일 판매가 있으면 그 판매에 연결)
 *   - 명단 기간 안인데 명단에 없는 일반 후보 → 「경리 명단에 없음 — 특히 확인」
 *   - 이미 보관중(실사 확인 끝)인 차는 건드리지 않는다
 *   🔴 이름·전화는 DB 에 넣지 않는다(원문에서 지운다). 콘솔엔 번호판 끝 4자리만.
 *
 * 실행: npx tsx --env-file=.env.local scripts/storage-keeper-list.ts --file "<경로>" --dry
 *       … --fix
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { isPlaceholderCustomerName, normalizePlate } from "@/lib/normalize";
import { brandsIn, sizesIn, describeSet } from "@/lib/tire-storage-pure";

const PLATE = /(\d{2,3}[가-힣]\d{4})/;

interface Entry {
  day: string;
  plate: string;
  /** 차종 첫 낱말 — 번호판 오타 맞추기에만 */
  model: string | null;
  brand: string | null;
  size: string | null;
  qty: number;
  memo: string | null;
  clean: string;
}

function parseLine(day: string, raw: string): Entry | null {
  const m = /^-\s*(\d{2,3}[가-힣]\d{4})(.*)$/.exec(raw.trim());
  if (!m) return null;
  // 뒤에 붙은 다른 차(…-40다2541 한국스노 보관탈부착)는 잘라낸다
  let body = m[2];
  const other = /-\s*\d{2,3}[가-힣]\d{4}|-\s*[가-힣]+스노/.exec(body);
  if (other) body = body.slice(0, other.index);
  // 이름·전화는 지운다 — 차종·괄호 내용만 남긴다
  const clean = body.replace(/0\d{1,2}[.\-\s]?\d{3,4}[.\-\s]?\d{4}/g, "").replace(/\s+/g, " ").trim();
  // 규격이 든 괄호 하나만 — 「[245/45R20 금호 4개](스노우는 한국…)」의 뒤 괄호는 다른 세트 이야기
  const sAt = clean.search(/\d{3}[/R]/);
  const open = sAt >= 0 ? Math.max(clean.lastIndexOf("[", sAt), clean.lastIndexOf("(", sAt)) : -1;
  const close = sAt >= 0 ? clean.indexOf("]", sAt) : -1;
  const bracket = sAt >= 0 ? clean.slice(open + 1, close >= 0 ? close : undefined) : clean;

  // 앞뒤 다른 규격(225/40+255 55R19 · 255/50,285/45R20)은 글 그대로
  const pair = /\d{3}\/\d{2}\s*[+,]\s*\d{3}[\/\s]\d{2}\s*R\s*\d{2}/i.exec(bracket);
  const sizes = sizesIn(bracket);
  // 「255 55R19」 처럼 띄어 쓴 것은 「255/55R19」로
  const size = pair ? pair[0].replace(/(\d{3})\s+(\d{2})(\s*R)/i, "$1/$2R").replace(/\s+/g, "").toUpperCase() : (sizes[0] ?? null);
  const qtyM = /(\d)\s*개|\*\s*(\d)(?!\d)/.exec(bracket);
  const qty = qtyM ? Number(qtyM[1] ?? qtyM[2]) : 4;
  const memo = [/휠/.test(bracket) ? "휠 포함" : null, /후륜/.test(bracket) ? "후륜" : null, /전륜/.test(bracket) ? "전륜" : null]
    .filter(Boolean)
    .join(" · ");
  return {
    day,
    plate: m[1],
    model: /^[가-힣A-Za-z0-9]+/.exec(clean)?.[0]?.replace(/(DM|TM|MD|HEV|EV)$/i, "") || null,
    brand: brandsIn(bracket).join(",") || null,
    size,
    qty: qty >= 1 && qty <= 8 ? qty : 4,
    memo: memo || null,
    clean: `경리 명단 ${day}: ${m[1]} ${clean}`.slice(0, 300),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--file");
  const file = at >= 0 ? argv[at + 1] : null;
  const fix = argv.includes("--fix");
  if (!file) throw new Error('--file "<경로>" 가 필요합니다');
  const text = readFileSync(file, "utf8");

  const entries: Entry[] = [];
  let day = "";
  for (const line of text.split(/\r?\n/)) {
    const d = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(line.trim());
    if (d) {
      day = `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}`;
      continue;
    }
    if (!day || !PLATE.test(line)) continue;
    const e = parseLine(day, line);
    if (e) entries.push(e);
  }
  const from = entries.map((e) => e.day).sort()[0];
  const to = entries.map((e) => e.day).sort().at(-1)!;
  const tail = (p: string) => p.slice(-4);

  type Plan = { e: Entry; act: "고침" | "새로" | "건너뜀"; why?: string; storageId?: number; vehicleId?: number; customerId?: number; quoteId?: number | null };
  const plans: Plan[] = [];
  const touched = new Set<number>();

  for (const e of entries) {
    let vs = await db.execute<{ id: number; customer_id: number; name: string }>(sql`
      SELECT v.id, v.customer_id, c.name FROM vehicle v JOIN customer c ON c.id = v.customer_id
      WHERE v.plate_no_norm = ${normalizePlate(e.plate)} AND v.is_active ORDER BY v.id DESC`);
    let fuzzy = false;
    if (!vs.length && e.model) {
      // 번호판 오타(23더0582 ↔ 53?0582) — 끝 4자리 + 차종이 같은 차가 **한 대뿐**일 때만
      const alt = await db.execute<{ id: number; customer_id: number; name: string }>(sql`
        SELECT v.id, v.customer_id, c.name FROM vehicle v JOIN customer c ON c.id = v.customer_id
        WHERE right(v.plate_no_norm, 4) = ${tail(e.plate)} AND v.is_active AND v.model ILIKE ${"%" + e.model + "%"}`);
      if (alt.length === 1) {
        vs = alt;
        fuzzy = true;
      }
    }
    if (!vs.length) {
      plans.push({ e, act: "건너뜀", why: "앱에 없는 차량" });
      continue;
    }
    if (fuzzy) console.log(`    번호판 오타로 보고 끝 4자리·차종(${e.model})으로 맞춤: …${tail(e.plate)}`);
    const v = vs[0];
    if (isPlaceholderCustomerName(v.name)) {
      plans.push({ e, act: "건너뜀", why: "자리표시 손님 차량" });
      continue;
    }
    const rows = await db.execute<{ id: number; status: string; stored_on: string; kind: string | null }>(sql`
      SELECT id, status, to_char(stored_on, 'YYYY-MM-DD') stored_on, kind FROM tire_storage
      WHERE vehicle_id = ${v.id} AND status IN ('확인대기','보관중') ORDER BY abs(stored_on - ${e.day}::date), id`);
    const live = rows.find((r) => r.status === "보관중" && r.kind === "일반");
    if (live) {
      plans.push({ e, act: "건너뜀", why: "이미 실사 확인(보관중)" });
      touched.add(Number(live.id));
      continue;
    }
    const cand = rows.find((r) => r.status === "확인대기" && !touched.has(Number(r.id)));
    if (cand) {
      touched.add(Number(cand.id));
      plans.push({ e, act: "고침", storageId: Number(cand.id), vehicleId: Number(v.id) });
      continue;
    }
    const [q] = await db.execute<{ id: number }>(sql`
      SELECT id FROM quote WHERE vehicle_id = ${v.id} AND status = '성사'
        AND work_date BETWEEN ${e.day}::date - 3 AND ${e.day}::date + 3
      ORDER BY abs(work_date - ${e.day}::date), id LIMIT 1`);
    plans.push({ e, act: "새로", vehicleId: Number(v.id), customerId: Number(v.customer_id), quoteId: q ? Number(q.id) : null });
  }

  // 명단 기간 안 · 명단에 없는 일반 후보
  const missing = await db.execute<{ id: number; plate: string | null }>(sql`
    SELECT t.id, v.plate_no plate FROM tire_storage t LEFT JOIN vehicle v ON v.id = t.vehicle_id
    WHERE t.status = '확인대기' AND t.kind = '일반' AND t.stored_on BETWEEN ${from}::date AND ${to}::date`);
  const notListed = missing.filter((m) => !touched.has(Number(m.id)));

  const count = (a: Plan["act"]) => plans.filter((p) => p.act === a).length;
  console.log(`경리 명단 ${entries.length}세트 (${from} ~ ${to})`);
  console.log(`  기존 후보 고침 ${count("고침")} · 새 후보 ${count("새로")} (그 판매에 연결 ${plans.filter((p) => p.act === "새로" && p.quoteId).length}) · 건너뜀 ${count("건너뜀")}`);
  for (const p of plans.filter((x) => x.act === "건너뜀")) console.log(`    건너뜀 …${tail(p.e.plate)} — ${p.why}`);
  console.log(`  명단 기간 안인데 명단에 없는 일반 후보 ${notListed.length} → 「경리 명단에 없음」 표시`);
  for (const p of plans.slice(0, 50)) if (p.act !== "건너뜀") console.log(`    ${p.act} ${p.e.day} …${tail(p.e.plate)} — ${describeSet({ ...p.e, kind: "일반" })}${p.e.memo ? ` (${p.e.memo})` : ""}`);

  if (!fix) {
    console.log("\n(--dry) 바꾸지 않았습니다. 반영하려면 --fix");
    process.exit(0);
  }
  await db.transaction(async (tx) => {
    for (const p of plans) {
      if (p.act === "고침") {
        await tx.execute(sql`
          UPDATE tire_storage SET kind = '일반', brand = ${p.e.brand}, size = ${p.e.size}, qty = ${p.e.qty},
                 memo = COALESCE(${p.e.memo}, memo), release_note = '경리 명단(11/12)에 있음',
                 source_text = left(COALESCE(source_text || ' / ', '') || ${p.e.clean}, 900), updated_at = now()
          WHERE id = ${p.storageId} AND status = '확인대기'`);
      } else if (p.act === "새로") {
        await tx.execute(sql`
          INSERT INTO tire_storage (storage_no, status, customer_id, vehicle_id, kind, brand, size, qty, memo, stored_on, stored_quote_id, source_text, release_note)
          VALUES (NULL, '확인대기', ${p.customerId}, ${p.vehicleId}, '일반', ${p.e.brand}, ${p.e.size}, ${p.e.qty}, ${p.e.memo},
                  ${p.e.day}::date, ${p.quoteId ?? null}, ${p.e.clean}, '경리 명단(11/12)에 있음')`);
      }
    }
    for (const m of notListed) {
      await tx.execute(sql`
        UPDATE tire_storage SET release_note = '경리 명단(11/12)에 없음 — 특히 확인', updated_at = now()
        WHERE id = ${m.id} AND status = '확인대기'`);
    }
  });
  console.log(`\n✅ 반영했습니다 — 고침 ${count("고침")} · 새로 ${count("새로")} · 명단에 없음 표시 ${notListed.length}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
