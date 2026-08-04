import Link from "next/link";
import { notFound } from "next/navigation";
import { getStockDetail } from "@/lib/stock";
import { SEASON_STYLE, type Season } from "@/lib/tire-attrs";
import { BADGE_STYLE } from "@/lib/tire-name";
import { AttrsEditor } from "./attrs-editor";
import { CopyLine, HideToggle, NameEditor } from "./editor";
import { AddDotRow, QtyEditor } from "./qty-editor";

/** 1826 → '26년 18주' */
function dotLabel(dot: string): string {
  return `${dot.slice(2, 4)}년 ${Number(dot.slice(0, 2))}주`;
}

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

        {/*
          세부사항 — 저장된 값을 보여준다.
          ⚠️ 이름에서 읽은 배지가 아니라 **고쳐진 값**이어야 한다.
             안 그러면 고쳐 놓고도 화면은 그대로라 사장님이 못 믿게 된다.
        */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {d.attrs.season && (
            <span
              className={`rounded px-2 py-1 text-sm font-medium ${
                SEASON_STYLE[d.attrs.season as keyof typeof SEASON_STYLE] ?? "bg-slate-100 text-slate-600"
              }`}
            >
              {d.attrs.season}
            </span>
          )}
          {d.attrs.isRunflat && (
            <span className="rounded bg-violet-100 px-2 py-1 text-sm font-medium text-violet-800">런플랫</span>
          )}
          {d.attrs.isAcoustic && (
            <span className="rounded bg-indigo-100 px-2 py-1 text-sm font-medium text-indigo-800">흡음재</span>
          )}
          {d.attrs.isSuv && (
            <span className="rounded bg-stone-100 px-2 py-1 text-sm font-medium text-stone-700">SUV</span>
          )}
          {d.attrs.oeMarks
            ?.split(",")
            .map((m) => m.trim())
            .filter(Boolean)
            .map((m) => (
              <span key={m} className="rounded bg-amber-100 px-2 py-1 text-sm font-bold text-amber-900">
                {m}
              </span>
            ))}
          {/* 구조 표기(XL 등)는 이름에서 읽은 그대로 */}
          {d.badges
            .filter((b) => b.kind === "structure")
            .map((b) => (
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

        {/* ⭐ 틀린 세부사항을 여기서 고친다. 고친 값은 재이관해도 유지된다 */}
        <AttrsEditor
          productId={d.productId}
          current={{
            season: (d.attrs.season as Season) ?? null,
            isRunflat: d.attrs.isRunflat,
            isAcoustic: d.attrs.isAcoustic,
            isSuv: d.attrs.isSuv,
            oeMarks: d.attrs.oeMarks,
          }}
          edited={d.attrsEdited}
        />

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

      {/*
        가격 계산은 검색 화면 카드에서 한다 (사장님 지시 2026-08-01).
        상담 중에는 목록을 보며 바로 계산하는 것이 빠르고, 여기까지 들어와서
        또 계산하는 것은 같은 일을 두 번 하는 것이다.
        여기서는 기표가만 보여준다 — 위 머리말에 있다.
      */}
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

      {/*
        ⭐ 수량을 여기서 바로 고친다 (사장님 지시 2026-08-04).
           "재고 변경이 엑셀로만 되는 점이 불편함."
        🔴 2026-08-03 의 「엑셀로만」 지시가 뒤집혔다 — 한두 줄 고치자고 엑셀을
           내려받아 다시 올리는 것이 더 불편했다. 엑셀은 전수 실사용으로 남는다.
      */}
      <section className="mt-4">
        <h2 className="mb-2 font-semibold">
          {d.isSerialized ? "DOT별 수량" : "수량"}
          <span className="ml-2 text-sm font-normal text-slate-500">
            {d.isSerialized ? "오래된 것부터 나갑니다 · " : ""}숫자를 누르면 고칠 수 있습니다
          </span>
        </h2>

        <ul className="space-y-2">
          {d.groups.map((g) => (
            <li
              key={g.dot ?? "none"}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3"
            >
              <span className="tabular text-lg font-semibold">
                {g.dot ?? <span className="font-normal text-amber-600">DOT 없음</span>}
                {g.dot && <span className="ml-2 text-xs font-normal text-slate-500">{dotLabel(g.dot)}</span>}
              </span>
              <QtyEditor productId={d.productId} dot={g.dot} qty={g.qty} unit={unit} />
            </li>
          ))}
          {d.groups.length === 0 && (
            <li className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-slate-500">
              등록된 재고가 없습니다
            </li>
          )}
        </ul>

        <AddDotRow productId={d.productId} />

        <Link
          href="/stock"
          className="mt-3 block py-1 text-center text-sm text-slate-400 underline underline-offset-4"
        >
          여러 상품을 한꺼번에 맞추시려면 재고 엑셀로
        </Link>
      </section>

      <HideToggle productId={d.productId} isActive={d.isActive} hasStock={d.total > 0} />

      <p className="mt-6 text-xs text-slate-400">
        모든 변경은 이력에 남습니다. 재고가 실물과 어긋났을 때 원인을 되짚기 위해서입니다.
      </p>
    </main>
  );
}
