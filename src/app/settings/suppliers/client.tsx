"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addSupplier,
  deleteSupplier,
  setSupplierActive,
  updateSupplier,
  type SupplierRow,
} from "@/lib/supplier";

/**
 * 거래처 추가 · 수정 · 삭제 (사장님 요청 2026-08-03)
 *
 * 설계
 *   · 목록이 먼저다. 매입 건수와 마지막 거래일이 보여야 어느 곳인지 안다
 *   · 이름 고치기는 **합치기**를 겸한다 — 「쌍성」을 「쌍성 타이어」로 고치면 합쳐진다.
 *     갈라진 이름을 합치는 것이 이 화면의 가장 큰 쓸모라 막지 않고 한 번 더 묻는다
 *   · 매입 내역이 있으면 지우기 대신 숨기기. 옛 인보이스의 출처가 사라지면 안 된다
 */
export function SupplierManager({ rows }: { rows: SupplierRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const shown = showHidden ? rows : rows.filter((r) => r.isActive);
  const hiddenCount = rows.length - rows.filter((r) => r.isActive).length;

  function submit() {
    setError(null);
    start(async () => {
      const r = await addSupplier({ name, phone, memo });
      if (!r.ok) return setError(r.error);
      setName("");
      setPhone("");
      setMemo("");
      setAdding(false);
      router.refresh();
    });
  }

  return (
    <>
      {adding ? (
        <section className="mt-4 rounded-2xl border-2 border-slate-900 bg-white p-4">
          <h2 className="font-semibold">새 거래처</h2>
          <div className="mt-3 space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="거래처 이름  예: 쌍성 타이어"
              autoFocus
              className="w-full rounded-lg border-2 border-slate-300 px-3 py-3 text-lg outline-none focus:border-slate-900"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="연락처 (선택)"
              inputMode="tel"
              className="tabular w-full rounded-lg border border-slate-300 px-3 py-2.5"
            />
            <input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="메모 (선택)  예: 금호·넥센 위주, 오후 배송"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
            />
          </div>
          {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
              className="rounded-lg px-4 py-3 text-slate-500"
            >
              취소
            </button>
            <button
              type="button"
              disabled={pending || !name.trim()}
              onClick={submit}
              className="flex-1 rounded-lg bg-slate-900 py-3 font-semibold text-white disabled:opacity-40"
            >
              {pending ? "저장 중…" : "추가"}
            </button>
          </div>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-4 w-full rounded-xl bg-slate-900 py-3.5 font-semibold text-white active:bg-slate-700"
        >
          + 거래처 추가
        </button>
      )}

      <ul className="mt-4 space-y-2">
        {shown.map((s) => (
          <SupplierCard key={s.id} s={s} />
        ))}
        {shown.length === 0 && (
          <li className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
            등록된 거래처가 없습니다
          </li>
        )}
      </ul>

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowHidden((v) => !v)}
          className="mt-3 w-full py-2 text-sm text-slate-500 underline underline-offset-4"
        >
          {showHidden ? "숨긴 거래처 감추기" : `숨긴 거래처 ${hiddenCount}곳 보기`}
        </button>
      )}
    </>
  );
}

function SupplierCard({ s }: { s: SupplierRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.name);
  const [phone, setPhone] = useState(s.phone ?? "");
  const [memo, setMemo] = useState(s.memo ?? "");
  const [error, setError] = useState<string | null>(null);
  /** 합칠 상대 이름 — 있으면 「합칠까요?」 를 띄운다 */
  const [merge, setMerge] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function save(confirmMerge = false) {
    setError(null);
    start(async () => {
      const r = await updateSupplier({ id: s.id, name, phone, memo, confirmMerge });
      if (!r.ok) {
        if (r.needsMerge) return setMerge(r.needsMerge);
        return setError(r.error);
      }
      setMerge(null);
      setEditing(false);
      router.refresh();
    });
  }

  if (editing) {
    return (
      <li className="rounded-xl border-2 border-slate-900 bg-white p-3">
        <div className="space-y-2">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setMerge(null);
            }}
            autoFocus
            className="w-full rounded-lg border-2 border-slate-300 px-3 py-2.5 text-lg font-semibold outline-none focus:border-slate-900"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="연락처"
            inputMode="tel"
            className="tabular w-full rounded-lg border border-slate-300 px-3 py-2"
          />
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="메모"
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </div>

        {s.invoiceCount > 0 && name.trim() !== s.name && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            매입 내역 {s.invoiceCount}건의 거래처 이름도 <strong>「{name.trim()}」</strong> 로 같이
            바뀝니다.
          </p>
        )}

        {/* ⭐ 갈라진 이름 합치기 — 이 화면의 가장 큰 쓸모다 */}
        {merge && (
          <div className="mt-2 rounded-lg border-2 border-amber-500 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-900">「{merge}」 이(가) 이미 있습니다</p>
            <p className="mt-1 text-sm text-amber-800">
              두 곳을 <strong>하나로 합칠까요?</strong> 「{s.name}」 의 매입 내역 {s.invoiceCount}건이
              「{merge}」 로 넘어가고, 「{s.name}」 은 사라집니다.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setMerge(null)}
                className="rounded-lg px-3 py-2 text-sm text-amber-800"
              >
                아니요
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => save(true)}
                className="flex-1 rounded-lg bg-amber-600 py-2 text-sm font-semibold text-white"
              >
                {pending ? "합치는 중…" : "네, 합칩니다"}
              </button>
            </div>
          </div>
        )}

        {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setName(s.name);
              setPhone(s.phone ?? "");
              setMemo(s.memo ?? "");
              setEditing(false);
              setMerge(null);
              setError(null);
            }}
            className="rounded-lg px-4 py-2.5 text-slate-500"
          >
            취소
          </button>
          <button
            type="button"
            disabled={pending || !name.trim() || merge !== null}
            onClick={() => save()}
            className="flex-1 rounded-lg bg-slate-900 py-2.5 font-semibold text-white disabled:opacity-40"
          >
            {pending ? "저장 중…" : "저장"}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className={`rounded-xl border p-3 ${s.isActive ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50"}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={`truncate font-bold ${s.isActive ? "" : "text-slate-400"}`}>
          {s.name}
          {!s.isActive && <span className="ml-2 text-xs font-normal text-slate-400">숨김</span>}
        </span>
        <span className="tabular shrink-0 text-sm text-slate-500">
          {s.invoiceCount > 0 ? `매입 ${s.invoiceCount}건` : "거래 전"}
        </span>
      </div>
      {(s.phone || s.memo || s.lastAt) && (
        <div className="tabular mt-0.5 flex flex-wrap gap-x-3 text-sm text-slate-500">
          {s.phone && <span>{s.phone}</span>}
          {s.lastAt && <span>마지막 {s.lastAt}</span>}
          {s.memo && <span className="text-slate-600">{s.memo}</span>}
        </div>
      )}

      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 active:bg-slate-100"
        >
          고치기
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await setSupplierActive(s.id, !s.isActive);
              router.refresh();
            })
          }
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 active:bg-slate-100"
        >
          {s.isActive ? "숨기기" : "다시 쓰기"}
        </button>

        {/* 매입 내역이 있으면 지우기 자체를 안 보여준다 — 눌러 보고 안 되는 것보다 낫다 */}
        {s.invoiceCount === 0 &&
          (confirmDelete ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await deleteSupplier(s.id);
                    if (!r.ok) setError(r.error);
                    else router.refresh();
                  })
                }
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white"
              >
                정말 삭제
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-2 text-sm text-slate-500"
              >
                취소
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="ml-auto rounded-lg px-3 py-2 text-sm text-slate-400 active:bg-slate-100"
            >
              삭제
            </button>
          ))}
      </div>
    </li>
  );
}
