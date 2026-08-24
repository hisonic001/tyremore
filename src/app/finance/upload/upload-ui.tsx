"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyFinUpload, previewFinUpload, type FinPreview } from "@/lib/fin-upload";

const won = (n: number) => n.toLocaleString("ko-KR");

/**
 * ⭐ 돈 관리 — 엑셀 올리기 (ERP 1~2단계, 2026-08-24)
 *
 *   고르기 → **미리보기 강제** → (통장·카드면 계정 이름 적고) 확정.
 *   파일 종류(통장·법인카드·홈택스 세금계산서)는 서버가 알아본다.
 *   같은 파일을 다시 올려도 안전하다 — 이미 있는 줄은 「이미 있음」으로 세기만 한다.
 */
export function FinUpload() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FinPreview | null>(null);
  const [label, setLabel] = useState("");
  /** 🔴 감사 M15: 계정 이름 오타(신한주거래/신한 주거래)가 같은 파일을 통째로 중복시킨다 —
      기존 계정은 고르게 하고, 새 계정만 직접 입력 */
  const [newLabel, setNewLabel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function onPick(f: File | null) {
    setError(null);
    setDoneMsg(null);
    setPreview(null);
    setFile(f);
    if (!f) return;
    const fd = new FormData();
    fd.set("file", f);
    start(async () => {
      const r = await previewFinUpload(fd);
      if (!r.ok) return setError(r.error);
      setPreview(r.preview);
      if (!label && r.preview.labels.length === 1) setLabel(r.preview.labels[0]);
    });
  }

  function onApply() {
    if (!file || !preview) return;
    const fd = new FormData();
    fd.set("file", file);
    if (preview.kind === "cash") fd.set("label", label);
    start(async () => {
      const r = await applyFinUpload(fd);
      if (!r.ok) return setError(r.error);
      setDoneMsg(
        `반영했습니다 — 새로 ${r.newCount}줄 · 이미 있음 ${r.dupCount}줄` +
          (r.source.startsWith("홈택스") ? " · 「세금계산서 대조」에서 확인하세요" : ""),
      );
      setPreview(null);
      setFile(null);
      if (input.current) input.current.value = ""; // 계정 이름은 남긴다 — 다음 파일에 이어 쓰게
      router.refresh();
    });
  }

  const needLabel = preview?.kind === "cash";

  return (
    <>
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">엑셀 올리기</h2>
        <p className="mt-1 text-sm text-slate-500">
          은행 거래내역 · 법인카드 이용내역(KB 확인서 · 우리카드) · 홈택스 전자세금계산서 목록을
          올리면 무엇으로 읽었는지 먼저 보여 드립니다.{" "}
          <strong>같은 파일을 또 올려도 두 번 계산되지 않습니다.</strong>
        </p>
        <input
          ref={input}
          type="file"
          accept=".xls,.xlsx"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          className="mt-3 block w-full rounded-xl border border-slate-300 p-3 text-sm"
        />
        {pending && <p className="mt-2 text-sm text-slate-500">읽는 중…</p>}
        {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">⚠️ {error}</p>}
        {doneMsg && <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">✅ {doneMsg}</p>}
      </section>

      {preview && (
        <section className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-semibold">
            이렇게 읽었습니다 — <span className="text-amber-800">{preview.formatName}</span>
          </h2>
          <ul className="tabular mt-2 space-y-1 text-sm">
            <li>
              기간: {preview.periodFrom ?? "?"} ~ {preview.periodTo ?? "?"} · {preview.rowCount}줄
              {preview.skippedCount > 0 && (
                <span className="text-amber-700"> (못 읽음 {preview.skippedCount}줄)</span>
              )}
            </li>
            {preview.kind === "cash" ? (
              <li>
                들어온 돈 <strong>{won(preview.sumIn)}원</strong> · 나간 돈{" "}
                <strong>{won(preview.sumOut)}원</strong>
                <span className="ml-1 text-xs text-slate-500">— 은행·카드 앱의 합계와 맞는지 봐 주세요</span>
              </li>
            ) : (
              <li>
                합계금액 <strong>{won(preview.sumTotal)}원</strong>
                <span className="ml-1 text-xs text-slate-500">— 홈택스 화면의 총 합계금액과 맞는지 봐 주세요</span>
              </li>
            )}
          </ul>
          {preview.skippedSample.length > 0 && (
            <p className="mt-1 text-xs text-amber-700">못 읽은 줄: {preview.skippedSample.join(" / ")}</p>
          )}
          <table className="mt-2 w-full text-xs">
            <tbody>
              {preview.sample.map((s, i) => (
                <tr key={i} className="border-t border-amber-200">
                  <td className="tabular py-1 pr-2 text-slate-500">{s.when}</td>
                  <td className="max-w-[10rem] truncate pr-2">{s.desc}</td>
                  <td className="tabular pr-2 text-right text-emerald-700">
                    {s.inAmount !== 0 && `+${won(s.inAmount)}`}
                  </td>
                  <td className="tabular text-right text-red-600">{s.outAmount !== 0 && `−${won(s.outAmount)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {needLabel && (
            <label className="mt-3 block">
              <span className="text-sm font-medium">어느 {preview.source === "통장" ? "통장" : "카드"}인가요?</span>
              {preview.labels.length > 0 && !newLabel ? (
                <select
                  value={label}
                  onChange={(e) => {
                    if (e.target.value === "__new__") {
                      setNewLabel(true);
                      setLabel("");
                    } else setLabel(e.target.value);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-3"
                >
                  <option value="">계정 고르기…</option>
                  {preview.labels.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                  <option value="__new__">+ 새 계좌·카드…</option>
                </select>
              ) : (
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={preview.source === "통장" ? "예: 신한주거래" : "예: 국민법인카드"}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-3"
                />
              )}
              <span className="mt-1 block text-xs text-slate-500">
                전에 쓴 이름 그대로 골라 주세요 — 이름이 다르면 다른 계좌로 셉니다
              </span>
            </label>
          )}

          <button
            type="button"
            onClick={onApply}
            disabled={pending || (needLabel && label.trim() === "")}
            className="mt-3 w-full rounded-xl bg-slate-900 py-3.5 font-semibold text-white disabled:opacity-40"
          >
            이대로 반영
          </button>
        </section>
      )}
    </>
  );
}
