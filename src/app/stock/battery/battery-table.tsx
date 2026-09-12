"use client";

import { useMemo, useState, useTransition } from "react";
import { setListPrice } from "@/lib/catalog";
import type { BatteryPriceRow, BatteryPriceView } from "@/lib/battery-price";
import { BATTERY_BRANDS } from "@/lib/battery-price-list";
import { won } from "@/components/fin/money";
import { TableWrap } from "@/components/fin/table";
import { ChipButton } from "@/components/ui/chip";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

/**
 * ⭐ 배터리 단가표 — 브랜드 칩 · 품명 검색 · 계열별 표 (개편 2026-09-12)
 *
 *   줄이 145개뿐이라 **전부 받아 두고 여기서 거른다** — 칩을 눌러도 서버에 다시 안 묻는다.
 *   파는 값은 줄마다 바로 고친다(`setListPrice` 정본). 고친 값은 화면 상태로만 갱신하고
 *   `router.refresh()` 를 부르지 않는다 — 열 줄 고치면 열 번 재질의가 되기 때문(풀 max 3).
 */
export function BatteryTable({ view }: { view: BatteryPriceView }) {
  const [brand, setBrand] = useState<string>(BATTERY_BRANDS[0]);
  const [q, setQ] = useState("");
  /**
   * 🔴 기본은 **표 전체**다 (2026-09-12 운영 확인 뒤 바꿈).
   *    취급하는 것만 보이게 했더니 델코 일반 22종 중 2종만 떠서 「단가표」 구실을 못 했다 —
   *    사장님이 원한 건 사진 대신 볼 값 목록이다. 안 받는 것(재고·판매 이력이 없어 검색에서
   *    꺼 둔 모델)은 품명을 회색으로만 갈라 놓는다 — 줄마다 「안 받음」을 붙이면 시끄럽다.
   */
  const [onlyHandled, setOnlyHandled] = useState(false);
  /** 방금 고친 파는 값 — 서버를 다시 안 부르고 화면만 맞춘다 */
  const [edited, setEdited] = useState<Record<number, number | null>>({});

  const term = q.trim().toUpperCase();
  const keep = (r: BatteryPriceRow) =>
    (!onlyHandled || r.isActive || r.qty > 0) &&
    (term === "" || r.name.toUpperCase().includes(term) || (r.displayName ?? "").toUpperCase().includes(term));

  const groups = useMemo(
    () =>
      view.groups
        .filter((g) => term !== "" || g.brand === brand)
        .map((g) => ({ ...g, rows: g.rows.filter(keep) }))
        .filter((g) => g.rows.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.groups, brand, term, onlyHandled],
  );
  const others = useMemo(() => view.others.filter(keep), // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.others, term, onlyHandled]);

  const priceOf = (r: BatteryPriceRow) => (r.productId !== null && r.productId in edited ? edited[r.productId] : r.price);

  return (
    <div>
      <p className="mt-1 text-sm text-slate-500">
        {view.source} {view.listDate} 인상표
        {view.costShown && <> · 사 오는 값은 <b className="font-semibold">VAT 별도</b></>} · 파는 값은 VAT 포함
      </p>
      {view.costShown && view.changed > 0 && (
        <Notice tone="info">
          {view.listDate} 표로 <b className="font-semibold">{view.changed}종</b>의 사 오는 값을 바꿨습니다 — 바뀐 줄에는 전 값이 같이 보입니다.
        </Notice>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {BATTERY_BRANDS.map((b) => (
          <ChipButton key={b} active={term === "" && brand === b} onClick={() => { setBrand(b); setQ(""); }}>
            {b}
          </ChipButton>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="품명으로 찾기 — DF80L · HK90 · AGM"
          className="min-h-11 min-w-0 flex-1 rounded-control border border-slate-300 px-3 text-sm"
        />
        <label className="flex min-h-11 shrink-0 items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={onlyHandled} onChange={(e) => setOnlyHandled(e.target.checked)} className="size-4" />
          받는 것만 보기
        </label>
      </div>
      {term !== "" && <p className="mt-2 text-sm text-slate-500">「{q.trim()}」 찾은 결과 — 브랜드 전부에서</p>}

      {groups.length === 0 && others.length === 0 && (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          찾는 배터리가 없습니다
        </div>
      )}

      {groups.map((g) => (
        <section key={`${g.brand}-${g.series}`} className="mt-5">
          <h2 className="font-bold">
            {g.brand} <span className="text-slate-500">{g.series}</span>
            <span className="ml-2 text-sm font-normal text-slate-400">{g.rows.length}종</span>
          </h2>
          <Rows rows={g.rows} view={view} priceOf={priceOf} onSaved={(id, v) => setEdited((e) => ({ ...e, [id]: v }))} />
        </section>
      ))}

      {others.length > 0 && (
        <section className="mt-6">
          <h2 className="font-bold">
            단가표에 없는 배터리 <span className="ml-1 text-sm font-normal text-slate-400">{others.length}종</span>
          </h2>
          <p className="mt-1 text-sm text-slate-500">바르타·에너자이저처럼 싸군배터리 표에 없는 것 — 값은 그대로 둡니다.</p>
          <Rows rows={others} view={view} priceOf={priceOf} onSaved={(id, v) => setEdited((e) => ({ ...e, [id]: v }))} />
        </section>
      )}

      <p className="mt-6 text-xs leading-relaxed text-slate-400">
        사 오는 값은 단가표가 정본이라 이 화면에서는 못 고칩니다 — 다음 인상표를 받으시면 말씀해 주세요.
        파는 값을 적어 두시면 판매 등록에서 그 값이 저절로 채워집니다(비워 두면 지금처럼 팔 때 칩니다).
      </p>
    </div>
  );
}

function Rows({
  rows,
  view,
  priceOf,
  onSaved,
}: {
  rows: BatteryPriceRow[];
  view: BatteryPriceView;
  priceOf: (r: BatteryPriceRow) => number | null;
  onSaved: (productId: number, v: number | null) => void;
}) {
  return (
    <TableWrap minWidth={view.costShown ? 520 : 380}>
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
          <th className="py-2 font-medium">품명</th>
          {view.costShown && <th className="py-2 text-right font-medium">사 오는 값</th>}
          <th className="py-2 text-right font-medium">파는 값</th>
          <th className="py-2 text-right font-medium">재고</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.productId ?? r.name} className="border-b border-slate-100 align-middle">
            <td className="py-2 pr-2">
              <span className={r.isActive || r.qty > 0 ? "font-medium" : "text-slate-400"}>{r.name}</span>
              {/* 앱 이름은 품명과 다를 때만 — 「델코 DF40L」처럼 브랜드만 덧붙인 것은 묶음 제목과 겹친다 */}
              {r.displayName && !r.displayName.includes(r.name) && (
                <span className="ml-1 text-xs text-slate-400">{r.displayName}</span>
              )}
              {r.productId === null && <span className="ml-1"><StatusPill tone="warn">앱에 없음</StatusPill></span>}
            </td>
            {view.costShown && (
              <td className="py-2 pr-2 text-right">
                {r.listedCost === null && r.note ? (
                  <>
                    <StatusPill tone="warn">확인 필요</StatusPill>
                    {r.cost !== null && <div className="text-xs text-slate-400">지금 {won(r.cost)}원</div>}
                  </>
                ) : (
                  <>
                    <span className="tabular font-semibold">{r.cost === null ? "—" : `${won(r.cost)}원`}</span>
                    {r.prevCost !== null && r.prevCost !== r.cost && (
                      <div className="tabular text-xs text-slate-400">전 {won(r.prevCost)}</div>
                    )}
                    {r.cost === null && r.listedCost !== null && (
                      <div className="tabular text-xs text-slate-400">표 {won(r.listedCost)}</div>
                    )}
                  </>
                )}
              </td>
            )}
            <td className="py-2 pr-2 text-right">
              {r.productId === null ? (
                <span className="text-slate-300">—</span>
              ) : (
                <PriceCell productId={r.productId} price={priceOf(r)} canEdit={view.canEdit} onSaved={onSaved} />
              )}
            </td>
            <td className="tabular py-2 text-right text-slate-500">{r.qty > 0 ? `${r.qty}개` : "—"}</td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

/**
 * 파는 값 한 칸 — 누르면 입력, 저장하면 그 줄만 갱신.
 *   기표가 정본 `setListPrice`(hasPerm master) 를 그대로 부른다. 비우면 「팔 때 친다」로 돌아간다.
 */
function PriceCell({
  productId,
  price,
  canEdit,
  onSaved,
}: {
  productId: number;
  price: number | null;
  canEdit: boolean;
  onSaved: (productId: number, v: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(price ? String(price) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!canEdit) {
    return <span className="tabular">{price ? `${won(price)}원` : "—"}</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(price ? String(price) : "");
          setEditing(true);
        }}
        className="tabular min-h-11 px-1 text-right"
      >
        {price ? (
          <span className="font-semibold">{won(price)}원</span>
        ) : (
          <span className="text-slate-400">적기</span>
        )}
        <span className="ml-1 text-xs text-slate-400">✏️</span>
      </button>
    );
  }

  const save = () =>
    start(async () => {
      setError(null);
      const n = value.trim() === "" ? null : Number(value.replace(/\D/g, ""));
      const r = await setListPrice(productId, n);
      if (!r.ok) return setError(r.error);
      onSaved(productId, n && n > 0 ? n : null);
      setEditing(false);
    });

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      <input
        value={value === "" ? "" : Number(value).toLocaleString()}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        inputMode="numeric"
        autoFocus
        placeholder="VAT 포함"
        className="tabular h-11 w-28 rounded-control border-2 border-slate-900 px-2 text-right text-sm font-semibold outline-none"
      />
      <Button onClick={save} pending={pending}>
        저장
      </Button>
      <Button variant="ghost" onClick={() => setEditing(false)}>
        취소
      </Button>
      {error && <Notice tone="error">{error}</Notice>}
    </span>
  );
}
