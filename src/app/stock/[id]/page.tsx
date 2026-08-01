import Link from "next/link";
import { notFound } from "next/navigation";
import { getStockDetail } from "@/lib/stock";
import { DotRow, NewDotRow } from "./editor";

export const dynamic = "force-dynamic";

/**
 * 재고 상세 — 수량·DOT를 언제든 고칠 수 있다 (사장님 요청 2026-08-01)
 *
 * 화면 설계 원칙 (docs/10)
 *   · 장갑 낀 손 → 버튼을 크게
 *   · 모르는 것은 「미확인」으로 두고, 실물을 볼 때 그 자리에서 확정한다
 */
export default async function StockPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isFinite(productId)) notFound();

  const d = await getStockDetail(productId);
  if (!d) notFound();

  const unit = d.itemType === "tire" ? "본" : "개";

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
      <Link href="/" className="text-sm text-slate-500 underline underline-offset-4">
        ← 검색으로
      </Link>

      <header className="mt-3">
        <h1 className="text-2xl font-bold leading-tight">
          {d.brandName && <span className="text-slate-500">{d.brandName} </span>}
          {d.pattern ?? d.name}
        </h1>
        {d.spec && <p className="tabular mt-1 text-lg text-slate-700">{d.spec}</p>}
        {d.listPrice && (
          <p className="tabular mt-1 text-sm text-slate-500">
            기표가 {d.listPrice.toLocaleString()}원
          </p>
        )}
      </header>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-slate-600">현재 재고</span>
          {!d.stockTracked ? (
            <span className="rounded-lg bg-slate-100 px-3 py-1 font-medium text-slate-500">⚪ 미등록</span>
          ) : !d.verified ? (
            <span className="rounded-lg bg-slate-100 px-3 py-1 font-medium text-slate-500">⚪ 미확인</span>
          ) : (
            <span className="tabular text-3xl font-bold">
              {d.total}
              <span className="ml-1 text-lg font-medium text-slate-500">{unit}</span>
            </span>
          )}
        </div>
        {!d.stockTracked && (
          <p className="mt-2 text-sm text-slate-500">
            아직 한 번도 입고하지 않은 상품입니다. <strong>0본이라는 뜻이 아닙니다</strong> — 창고에 있다면
            아래에서 넣어 주세요.
          </p>
        )}
        {d.verifiedAt && (
          <p className="mt-2 text-sm text-slate-500">
            마지막 확인 {new Date(d.verifiedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}
          </p>
        )}
      </section>

      <section className="mt-4">
        <h2 className="mb-2 font-semibold">
          {d.isSerialized ? "DOT별 수량" : "수량"}
          {d.isSerialized && (
            <span className="ml-2 text-sm font-normal text-slate-500">오래된 것부터 나갑니다</span>
          )}
        </h2>

        <ul className="space-y-2">
          {d.groups.map((g) => (
            <DotRow
              key={g.dot ?? "none"}
              productId={d.productId}
              dot={g.dot}
              qty={g.qty}
              unit={unit}
              serialized={d.isSerialized}
            />
          ))}
          {d.groups.length === 0 && (
            <li className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-slate-500">
              등록된 재고가 없습니다
            </li>
          )}
        </ul>

        <div className="mt-3">
          <NewDotRow productId={d.productId} unit={unit} serialized={d.isSerialized} />
        </div>
      </section>

      <p className="mt-6 text-xs text-slate-400">
        모든 변경은 이력에 남습니다. 재고가 실물과 어긋났을 때 원인을 되짚기 위해서입니다.
      </p>
    </main>
  );
}
