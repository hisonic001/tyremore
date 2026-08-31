"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { createService, setServiceActive, updateService, type ServiceCatalogRow } from "@/lib/service-catalog";
import { replacedLabels } from "@/lib/mars-service-words";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { useConfirm } from "@/components/ui/confirm";

/**
 * 공임·정비 목록 — 검색 · 고치기 · 새로 만들기 · 사용중지 (사장님 요청 2026-08-31)
 *
 *   짜임은 settings/suppliers/client.tsx 를 따른다 (목록이 먼저, 수정은 그 자리에서).
 *
 * ⭐ 이름을 칠 때 「MARS 점검표에 무엇이 켜지는지」를 미리 보여 준다 —
 *    점검표 체크는 이름의 낱말로 정해지므로(mars-service-words), 이름에서
 *    낱말이 빠지면 체크가 조용히 안 켜진다. 그 사고를 화면에서 미리 막는다.
 */

const won = (n: number) => n.toLocaleString("ko-KR");
const QTY_RULE: Record<string, string> = { per_unit: "본당", per_2_units: "2개당", per_job: "건당" };

/** 이름 → 점검표 미리보기 (이전 이름과 견줘 잃는 것도 알려 준다) */
function MarsPreview({ name, before }: { name: string; before?: string }) {
  const now = replacedLabels(name);
  const lost = before ? replacedLabels(before).filter((l) => !now.includes(l)) : [];
  if (lost.length > 0) {
    return (
      <Notice tone="warn">
        이 이름이면 MARS 차량 점검표의 <strong>{lost.join(" · ")} 교체 표시가 꺼집니다</strong> — 낱말(엔진오일·배터리·얼라인·패드…)이 빠졌습니다.
      </Notice>
    );
  }
  if (now.length > 0) {
    return (
      <p className="mt-1 text-xs text-sky-800">
        MARS 차량 점검표에서 <strong>{now.join(" · ")}</strong> 교체로 표시됩니다.
        {/점검/.test(name.replace(/\s/g, "")) ? " (「점검」이 들어가면 표시 안 함)" : ""}
        {/* ⭐ 앞/뒤는 이름의 낱말로 갈린다 — 사장님이 직접 바꿀 수 있게 알려 준다 (2026-08-31 후륜 요청) */}
        {now.includes("앞 브레이크 패드") ? " — 이름에 「뒤」나 「후륜」이 들어가면 뒤로 표시됩니다" : ""}
      </p>
    );
  }
  return null;
}

/** 금액 입력 — 비우면 「건별로 정함」 */
function PriceField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field
      label="금액"
      value={value === "" ? "" : won(Number(value))}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      inputMode="numeric"
      placeholder="비우면 건별로 정함"
      hint="비우면 담을 때 0원으로 들어가고 그 자리에서 금액을 적습니다"
      className="tabular text-right"
    />
  );
}

export function ServiceManager({ rows, startNew }: { rows: ServiceCatalogRow[]; startNew: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: "success" | "error"; msg: string } | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(startNew);
  const [showHidden, setShowHidden] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);

  const norm = (s: string | null | undefined) => (s ?? "").replace(/\s/g, "").toLowerCase();
  const needle = norm(q);
  const matched = needle
    ? rows.filter((r) => norm(r.name).includes(needle) || norm(r.shortName).includes(needle) || norm(r.marsNo).includes(needle))
    : rows;
  const active = matched.filter((r) => r.isActive);
  const hidden = matched.filter((r) => !r.isActive);

  const done = (msg: string) => {
    setNotice({ tone: "success", msg });
    setEditId(null);
    setAdding(false);
    router.refresh();
  };
  const fail = (msg: string) => setNotice({ tone: "error", msg });

  return (
    <>
      {notice && <Notice tone={notice.tone}>{notice.msg}</Notice>}

      {adding ? (
        <NewForm pending={pending} start={start} onDone={done} onFail={fail} onClose={() => setAdding(false)} />
      ) : (
        <Button className="mt-3 w-full" onClick={() => { setNotice(null); setAdding(true); }}>
          + 새 공임·정비 만들기
        </Button>
      )}

      <div className="mt-3">
        <Field value={q} onChange={(e) => setQ(e.target.value)} placeholder={`이름으로 찾기 (${rows.length}개)`} />
      </div>

      {/* 🔴 금액 수정이 과거에 소급되지 않는다는 것 — 안 적으면 매번 걱정하시게 된다 */}
      <p className="mt-2 text-xs text-slate-500">
        금액을 고쳐도 <strong>이미 등록된 판매는 그대로</strong>입니다 — 앞으로 담는 것부터 적용됩니다.
      </p>

      <ul className="mt-3 space-y-2">
        {active.map((r) => (
          <li key={r.id}>
            {editId === r.id ? (
              <EditForm
                row={r}
                pending={pending}
                start={start}
                onDone={done}
                onFail={fail}
                onClose={() => setEditId(null)}
              />
            ) : (
              <RowView
                row={r}
                pending={pending}
                onEdit={() => { setNotice(null); setEditId(r.id); }}
                onStar={() =>
                  start(async () => {
                    const res = await updateService({
                      id: r.id, name: r.name, shortName: r.shortName, price: r.price,
                      isFavorite: !r.isFavorite,
                    });
                    if (!res.ok) return fail(res.error);
                    router.refresh();
                  })
                }
              />
            )}
          </li>
        ))}
      </ul>
      {active.length === 0 && <p className="mt-4 text-center text-sm text-slate-400">찾는 공임이 없습니다 — 위에서 새로 만들 수 있습니다.</p>}

      {hidden.length > 0 && (
        <div className="mt-5">
          <button type="button" onClick={() => setShowHidden((v) => !v)} className="text-sm text-slate-500 underline underline-offset-4">
            사용중지 {hidden.length}개 {showHidden ? "접기" : "보기"}
          </button>
          {showHidden && (
            <ul className="mt-2 space-y-2 opacity-60">
              {hidden.map((r) => (
                <li key={r.id} className="flex items-center gap-2 rounded-card border border-slate-200 bg-white p-3">
                  <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
                  <Button
                    variant="secondary"
                    pending={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await setServiceActive(r.id, true);
                        if (!res.ok) return fail(res.error);
                        done(`「${r.name}」 을 다시 켰습니다 — 검색에 다시 나옵니다.`);
                      })
                    }
                  >
                    다시 켜기
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

function RowView({ row: r, pending, onEdit, onStar }: {
  row: ServiceCatalogRow; pending: boolean; onEdit: () => void; onStar: () => void;
}) {
  return (
    <div className="rounded-card border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2">
        {/* 즐겨찾기 — 검색어 없이 검색칸을 눌렀을 때 나오는 목록 */}
        <button type="button" disabled={pending} onClick={onStar} aria-label="즐겨찾기"
          className="shrink-0 p-1">
          <Star className={`size-5 ${r.isFavorite ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{r.name}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-400">
            {r.marsNo ? <span className="tabular">{r.marsNo}</span> : <span className="text-sky-700">직접 만든 항목{r.createdAt ? ` (${r.createdAt})` : ""}</span>}
            <span>{QTY_RULE[r.qtyRule] ?? r.qtyRule}</span>
            {r.usedCount > 0 && <span>판매 {r.usedCount}번</span>}
          </div>
        </div>
        <span className="tabular shrink-0 text-sm font-semibold">
          {r.price === null ? <span className="font-normal text-slate-400">건별</span> : `${won(r.price)}원`}
        </span>
        <Button variant="secondary" onClick={onEdit} className="shrink-0">고치기</Button>
      </div>
    </div>
  );
}

function EditForm({ row: r, pending, start, onDone, onFail, onClose }: {
  row: ServiceCatalogRow;
  pending: boolean;
  start: (fn: () => Promise<void>) => void;
  onDone: (m: string) => void;
  onFail: (m: string) => void;
  onClose: () => void;
}) {
  const [ask, confirmDialog] = useConfirm();
  const [name, setName] = useState(r.name);
  const [shortName, setShortName] = useState(r.shortName ?? "");
  const [price, setPrice] = useState(r.price === null ? "" : String(r.price));
  const [fav, setFav] = useState(r.isFavorite);

  const save = () =>
    start(async () => {
      const res = await updateService({
        id: r.id, name, shortName: shortName.trim() || null,
        price: price === "" ? null : Number(price), isFavorite: fav,
      });
      if (!res.ok) return onFail(res.error);
      onDone("고쳤습니다 — 검색과 앞으로의 판매에 바로 적용됩니다.");
    });

  const deactivate = async () => {
    const okGo = await ask({
      title: "이 공임을 사용중지할까요?",
      body: `「${r.name}」 — 검색에서 사라집니다.\n이미 등록된 판매 ${r.usedCount}건은 그대로 남습니다. 언제든 다시 켤 수 있습니다.`,
      tone: "danger",
      confirmLabel: "사용중지",
    });
    if (!okGo) return;
    start(async () => {
      const res = await setServiceActive(r.id, false);
      if (!res.ok) return onFail(res.error);
      onDone(`「${r.name}」 을 사용중지했습니다.`);
    });
  };

  return (
    <div className="rounded-card border-2 border-slate-900 bg-white p-3">
      {confirmDialog}
      <div className="space-y-2">
        <Field label="이름" value={name} onChange={(e) => setName(e.target.value)} />
        <MarsPreview name={name} before={r.name} />
        <Field label="짧은 이름 (선택)" value={shortName} onChange={(e) => setShortName(e.target.value)} />
        <PriceField value={price} onChange={setPrice} />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={fav} onChange={(e) => setFav(e.target.checked)} className="size-5 accent-brand-600" />
          즐겨찾기 — 검색칸을 누르면 바로 나오는 목록에 넣기
        </label>
        {/* 🔴 MARS 품번은 원본 보존(D-08) — 보여만 준다. 고치는 길 자체가 없다 */}
        {r.marsNo && <p className="text-xs text-slate-400">MARS 품번 {r.marsNo} — 바꿀 수 없습니다 (MARS 원본)</p>}
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="danger" pending={pending} onClick={deactivate}>사용중지</Button>
        <Button variant="secondary" className="ml-auto" onClick={onClose}>취소</Button>
        <Button pending={pending} disabled={!name.trim()} onClick={save}>저장</Button>
      </div>
    </div>
  );
}

function NewForm({ pending, start, onDone, onFail, onClose }: {
  pending: boolean;
  start: (fn: () => Promise<void>) => void;
  onDone: (m: string) => void;
  onFail: (m: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [price, setPrice] = useState("");
  const [fav, setFav] = useState(false);

  const save = () =>
    start(async () => {
      const res = await createService({
        name, shortName: shortName.trim() || null,
        price: price === "" ? null : Number(price), isFavorite: fav,
      });
      if (!res.ok) return onFail(res.error);
      onDone(`「${name.trim()}」 을 만들었습니다 — 판매 등록의 공임 검색에서 바로 찾을 수 있습니다.`);
      setName(""); setShortName(""); setPrice(""); setFav(false);
    });

  return (
    <section className="mt-3 rounded-card border-2 border-slate-900 bg-white p-4">
      <h2 className="font-semibold">새 공임·정비</h2>
      <div className="mt-3 space-y-2">
        <Field label="이름" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 로어암 볼조인트 교환" autoFocus />
        <MarsPreview name={name} />
        <Field label="짧은 이름 (선택)" value={shortName} onChange={(e) => setShortName(e.target.value)} />
        <PriceField value={price} onChange={setPrice} />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={fav} onChange={(e) => setFav(e.target.checked)} className="size-5 accent-brand-600" />
          즐겨찾기 — 검색칸을 누르면 바로 나오는 목록에 넣기
        </label>
      </div>
      {/* 새 항목이 MARS 로 가는 길 — 이미 검증된 「기타」 경로다 (service-catalog.ts 머리말) */}
      <p className="mt-2 text-xs text-slate-500">
        새 항목은 MARS 에 「기타」(S001/1290) 품번으로 들어가고, 이름은 그대로 적힙니다.
      </p>
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" onClick={onClose}>닫기</Button>
        <Button className="ml-auto" pending={pending} disabled={!name.trim()} onClick={save}>만들기</Button>
      </div>
    </section>
  );
}
