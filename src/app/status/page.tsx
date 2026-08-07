import Link from "@/lib/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

/** 이관 결과 확인 화면 — 무엇이 들어왔고 무엇을 사람이 봐야 하는가 */
export default async function Status() {
  const counts = await db.execute<{ t: string; n: number }>(sql`
    SELECT '고객 (연락처)' t, count(*)::int n, 1 o FROM customer
    UNION ALL SELECT '차량', count(*)::int, 2 FROM vehicle
    UNION ALL SELECT '상품 — 타이어', count(*)::int, 3 FROM product WHERE item_type='tire'
    UNION ALL SELECT '상품 — 부품·경정비', count(*)::int, 4 FROM product WHERE item_type='part'
    UNION ALL SELECT '서비스·공임', count(*)::int, 5 FROM service_item
    UNION ALL SELECT '재고 — 타이어(본)', COALESCE(SUM(qty),0)::int, 6 FROM stock_item s
      JOIN product p ON p.id=s.product_id WHERE p.item_type='tire' AND s.status='재고'
    UNION ALL SELECT '재고 — 부품(미확인 품목)', count(*)::int, 7 FROM stock_item s
      JOIN product p ON p.id=s.product_id WHERE p.item_type='part' AND s.verified_at IS NULL
    ORDER BY 3
  `);

  const issues = await db.execute<{ kind: string; n: number }>(sql`
    SELECT kind, count(*)::int n FROM import_issue WHERE status='대기'
    GROUP BY kind ORDER BY n DESC
  `);

  const aging = await db.execute<{ y: string; n: number }>(sql`
    SELECT ('20' || substr(dot,3,2)) y, count(*)::int n
    FROM stock_item WHERE status='재고' AND dot IS NOT NULL
    GROUP BY 1 ORDER BY 1
  `);

  const ISSUE_LABEL: Record<string, string> = {
    spec_parse: "규격 파싱 실패 — 파서 보정 또는 수기 입력",
    dup_customer: "같은 번호에 다른 이름 — 합치지 말고 연결만",
    plate: "번호판 형식 이상",
    no_phone: "휴대폰 없음 — 문자 알림에서 빠짐",
    service_price: "단가 없는 서비스 — 건별 입력",
    dot: "DOT 합과 수량 불일치",
    name_is_plate: "이름 자리에 차량번호",
  };

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-6">
      <header className="mb-5 flex items-baseline justify-between">
        <h1 className="text-xl font-bold">이관 현황</h1>
        <Link href="/" className="text-sm text-slate-500 underline underline-offset-4">
          검색으로
        </Link>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-semibold">들어온 데이터</h2>
        <dl className="divide-y divide-slate-100">
          {counts.map((c) => (
            <div key={c.t} className="flex justify-between py-2">
              <dt className="text-slate-600">{c.t}</dt>
              <dd className="tabular font-bold">{Number(c.n).toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 font-semibold">재고 노후화 (DOT 기준)</h2>
        <p className="mb-3 text-sm text-slate-500">오래된 것부터 팔아야 합니다</p>
        <dl className="divide-y divide-slate-100">
          {aging.map((a) => (
            <div key={a.y} className="flex justify-between py-2">
              <dt className={Number(a.y) <= 2024 ? "font-medium text-amber-700" : "text-slate-600"}>
                {a.y}년산
              </dt>
              <dd className="tabular font-bold">{a.n}본</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="mb-1 font-semibold">사람이 봐야 하는 것</h2>
        <p className="mb-3 text-sm text-amber-800">
          자동으로 처리하지 못한 건입니다. 보정 화면은 다음 단계에서 만듭니다.
        </p>
        <dl className="divide-y divide-amber-100">
          {issues.map((i) => (
            <div key={i.kind} className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-sm text-slate-700">{ISSUE_LABEL[i.kind] ?? i.kind}</dt>
              <dd className="tabular shrink-0 font-bold">{i.n}건</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
