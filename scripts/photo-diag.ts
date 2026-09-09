/**
 * ⭐ 사진 시도 기종×결과 통계 (사장님 요청 2026-09-09)
 *
 *   "핸드폰 기종이나 다른 조건에 의해서도 오류가 생길 수 있는지 데이터를 통해 검증"
 *   vin_scan.meta(기기 문자열·형식·크기·변환 시간)를 묶어 표로 낸다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/photo-diag.ts [--days 14]
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";

/** ua 원문은 길다 — 사람이 알아볼 기종 한 줄로 줄인다 */
function device(ua: string | null): string {
  if (!ua) return "(기록 전 시도)";
  if (/iPhone/i.test(ua)) {
    const os = ua.match(/OS (\d+)_/)?.[1];
    return `아이폰 iOS${os ?? "?"}${/CriOS/.test(ua) ? " 크롬" : " 사파리"}`;
  }
  if (/Android/i.test(ua)) {
    const model = ua.match(/Android [\d.]+; ([^);]+)/)?.[1]?.trim();
    return `안드로이드 ${model ?? "?"}`;
  }
  if (/Windows/i.test(ua)) return "PC 윈도우";
  if (/Macintosh/i.test(ua)) return "맥";
  return ua.slice(0, 40);
}

async function main() {
  const days = Number(process.argv[process.argv.indexOf("--days") + 1]) || 14;
  const rows = await db.execute<{
    status: string;
    error: string | null;
    src: string | null;
    ua: string | null;
    src_type: string | null;
    out_kb: number | null;
    ms: number | null;
  }>(sql`
    SELECT status, error, result->>'source' src,
           meta->>'ua' ua, meta->>'srcType' src_type,
           ((meta->>'outBytes')::bigint / 1024)::int out_kb, (meta->>'ms')::int ms
    FROM vin_scan WHERE created_at > now() - make_interval(days => ${days})
    ORDER BY id`);
  const agg = new Map<string, { n: number; ok: number; phoneFail: number; readFail: number; svrFail: number; kb: number[]; ms: number[] }>();
  for (const r of rows) {
    const k = device(r.ua);
    const a = agg.get(k) ?? { n: 0, ok: 0, phoneFail: 0, readFail: 0, svrFail: 0, kb: [], ms: [] };
    a.n++;
    if (r.status === "완료") a.ok++;
    else if ((r.error ?? "").startsWith("폰에서 실패")) a.phoneFail++;
    else if (r.status === "실패") a.svrFail++;
    if (r.status === "완료" && !r.src) a.readFail++;
    if (r.out_kb) a.kb.push(r.out_kb);
    if (r.ms) a.ms.push(r.ms);
    agg.set(k, a);
  }
  console.log(`── 최근 ${days}일 사진 시도 ${rows.length}건 · 기종별 ──`);
  for (const [k, a] of [...agg.entries()].sort((x, y) => y[1].n - x[1].n)) {
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, v) => s + v, 0) / xs.length) : null);
    console.log(
      `${k}: ${a.n}건 — 완료 ${a.ok} · 폰 실패 ${a.phoneFail} · 읽기 실패(서버) ${a.svrFail}` +
        (avg(a.kb) ? ` · 평균 ${avg(a.kb)}KB` : "") +
        (avg(a.ms) ? ` · 변환 ${avg(a.ms)}ms` : ""),
    );
  }
  const fails = rows.filter((r) => r.status === "실패");
  if (fails.length) {
    console.log("\n── 실패 사유 ──");
    for (const f of fails) console.log(`· [${device(f.ua)}] ${f.error?.slice(0, 100)}`);
  }
  process.exit(0);
}
main();
