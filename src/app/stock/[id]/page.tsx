import Link from "next/link";
import { notFound } from "next/navigation";
import { getPrice } from "@/lib/pricing";
import { getStockDetail } from "@/lib/stock";
import { BADGE_STYLE } from "@/lib/tire-name";
import { CopyLine, DotRow, HideToggle, NameEditor, NewDotRow } from "./editor";
import { PricePanel } from "./price";

export const dynamic = "force-dynamic";

/**
 * 재고 상세 — 수량·DOT를 언제든 고칠 수 있다 (사장님 요청 2026-08-01)
 *
 * 화면 설계 원칙 (docs/10)
 *   · 장갑 낀 손 → 버튼을 크게
 *   · 모르는 것은 「미확인」으로 두고, 실물을 볼 때 그 자리에서 확정한다
 */
export default async function StockPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ owner?: string }>;
}) {
  const { id } = await params;
  const { owner } = await searchParams;
  const productId = Number(id);
  if (!Number.isFinite(productId)) notFound();

  const [d, price] = await Promise.all([getStockDetail(productId), getPrice(productId)]);
  if (!d) notFound();

  /**
   * ⚠️ 임시 — 로그인이 아직 없다. 지금은 매장 내부망이라 URL 로 전환한다.
   *    배포하면 인터넷에 열리므로 **반드시 로그인으로 바꿔야 한다** (D-05 6번 / D-11 2번).
   *    그때는 `role='tech'` 요청에 매입가·마진을 **서버 응답에서 아예 뺀다.**
   */
  const ownerMode = owner === "1";

  const unit = d.itemType === "tire" ? "본" : "개";

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
      <Link href="/" className="text-sm text-slate-500 underline underline-offset-4">
        ← 검색으로
      </Link>

      <header className="mt-3">
        {d.brandName && (
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {d.brandName}
          </span>
        )}
        <NameEditor
          productId={d.productId}
          model={d.model}
          autoModel={d.autoModel}
          isCustom={d.displayName !== null}
        />
        <div className="tabular mt-1 flex flex-wrap gap-x-3 text-lg text-slate-700">
          {d.spec && <span className="font-semibold">{d.spec}</span>}
          {d.loadSpeed && <span>{d.loadSpeed}</span>}
        </div>

        {/* 세부사항 — 런플랫·흡음재·OE마킹 등 전부 */}
        {(d.badges.length > 0 || d.unknown.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {d.badges.map((b) => (
              <span key={b.code} className={`rounded px-2 py-1 text-sm font-medium ${BADGE_STYLE[b.kind]}`}>
                {b.code === b.label ? b.code : `${b.code} ${b.label}`}
              </span>
            ))}
            {d.unknown.map((u) => (
              <span key={u} className="rounded bg-slate-100 px-2 py-1 text-sm text-slate-400">
                {u}
              </span>
            ))}
          </div>
        )}

        <div className="tabular mt-2 flex flex-wrap gap-x-4 text-sm text-slate-500">
          {d.cai && (
            <span>
              CAI <span className="font-semibold text-slate-700">{d.cai}</span>
            </span>
          )}
          {d.listPrice && (
            <span>
              기표가 <span className="font-semibold text-slate-700">{d.listPrice.toLocaleString()}원</span>
              <span className="ml-1 text-xs text-slate-400">VAT 포함</span>
            </span>
          )}
        </div>

        {/* ⭐ 미쉐린 주문 사이트와 같은 형태. 주문할 때 이 줄로 대조한다 */}
        <CopyLine label="주문 사이트 표기" value={d.orderName} />

        {/* ⚠️ MARS 입력용 원본. 4주차 입력 대기열에서 이 이름으로 찾는다 (D-08) */}
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-slate-400">MARS 원본 이름</summary>
          <p className="mt-1 rounded bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500">
            {d.marsName}
            {d.pattern && d.pattern !== d.marsName && (
              <>
                <br />
                {d.pattern}
              </>
            )}
          </p>
        </details>
      </header>

      {/* ⭐ 상담의 핵심 — 할인율을 넣으면 판매가가 나온다 (D-05) */}
      {price && <PricePanel productId={d.productId} price={price} ownerMode={ownerMode} />}

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

      <HideToggle productId={d.productId} isActive={d.isActive} hasStock={d.total > 0} />

      <p className="mt-6 text-xs text-slate-400">
        모든 변경은 이력에 남습니다. 재고가 실물과 어긋났을 때 원인을 되짚기 위해서입니다.
      </p>
    </main>
  );
}
