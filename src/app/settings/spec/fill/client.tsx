"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Search, X } from "lucide-react";
import Link from "@/lib/link";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { canonical } from "@/lib/spec-format-core";
import { parseSpecPaste, type PastedSpec } from "@/lib/spec-paste-core";
import {
  findOeTires,
  saveSpecByOwner,
  setGenerationBodyType,
  type FillSheet,
  type FillTarget,
  type OeTireChoice,
  type SpecEntryLine,
  type SpecOrigin,
} from "@/lib/spec-entry";

/**
 * 제원 채우기 폼 (2026-09-08, 사장님 지시)
 *
 * 🔴 **치는 대로 바로 보여 준다.** 저장 단추를 누른 뒤에 「형식이 틀렸습니다」가 나오면
 *    무엇이 틀렸는지 찾느라 다시 훑어야 한다. 검사는 `spec-format-core` 의 순수 함수라
 *    화면에서 그대로 부를 수 있다 — 서버를 다녀오지 않는다.
 *
 * 🔴 **차체를 먼저 정한다.** 세대 149개의 차체가 전부 비어 있어서, 모르면 휠너트 토크가
 *    승용 8~20 이 아니라 넓은 6~70 으로만 막힌다. 승용차에 50 kgf·m 을 넣어도 안 걸린다.
 */

const ORIGINS: SpecOrigin[] = ["취급설명서", "문틀 라벨", "부품상", "인터넷", "차에서 확인"];
const BODY_TYPES = ["승용", "SUV", "소형트럭", "밴·소형버스", "대형"];

type Draft = Record<string, { raw: string; unit?: string | null }>;

/** 「wiper_size@운전석」처럼 항목과 위치를 한 열쇠로 */
const keyOf = (item: string, pos?: string | null) => (pos ? `${item}@${pos}` : item);
const splitKey = (k: string): { item: string; pos: string | null } => {
  const i = k.indexOf("@");
  return i < 0 ? { item: k, pos: null } : { item: k.slice(0, i), pos: k.slice(i + 1) };
};

export function FillUI({ sheet, targets }: { sheet: FillSheet; targets: FillTarget[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [origin, setOrigin] = useState<SpecOrigin>("취급설명서");
  const [originNote, setOriginNote] = useState("");
  const [body, setBody] = useState<string | null>(sheet.bodyType ?? sheet.bodyGuess ?? null);
  const [draft, setDraft] = useState<Draft>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [clashes, setClashes] = useState<{ item: string; label: string; 지금: string; 넣으신것: string }[]>([]);
  const [pasted, setPasted] = useState<PastedSpec | null>(null);

  /* 무엇이 어떻게 저장될지 — 서버를 안 다녀오고 여기서 바로 본다 */
  const checked = useMemo(() => {
    const out: Record<string, ReturnType<typeof canonical>> = {};
    for (const [k, v] of Object.entries(draft)) {
      if (!v.raw.trim()) continue;
      out[k] = canonical(splitKey(k).item, v.raw, v.unit, { bodyType: body });
    }
    return out;
  }, [draft, body]);

  const ready = Object.values(checked).filter((c) => c.ok).length;
  const bad = Object.values(checked).filter((c) => !c.ok).length;

  const set = (k: string, patch: { raw?: string; unit?: string | null }) =>
    setDraft((d) => ({ ...d, [k]: { raw: patch.raw ?? d[k]?.raw ?? "", unit: patch.unit ?? d[k]?.unit ?? null } }));

  const save = (replace: string[] = []) =>
    start(async () => {
      setErr(null);
      setMsg(null);
      if (body && body !== sheet.bodyType) await setGenerationBodyType(sheet.variantKey, body);
      const lines: SpecEntryLine[] = Object.entries(draft)
        .filter(([, v]) => v.raw.trim())
        .map(([k, v]) => {
          const { item, pos } = splitKey(k);
          return { item, raw: v.raw, unit: v.unit ?? null, qualifier: pos };
        });
      const r = await saveSpecByOwner({ variantKey: sheet.variantKey, origin, originNote, lines, replace });
      if (r.error) {
        setErr(r.error);
        return;
      }
      setClashes(r.clashes);
      if (r.saved > 0) {
        setMsg(`${r.saved}개를 넣었습니다`);
        setDraft({});
        router.refresh();
      }
      if (r.rejected.length) {
        setErr(r.rejected.map((x) => `${x.label}: ${x.why}`).join(" · "));
      }
    });

  /**
   * 🔴 **붙여넣은 것은 트림마다 따로 넣는다** (2026-09-08).
   *    제원 쪽은 「한 차종에 값 하나」가 아니라 세부모델(트림)마다 다른 표다.
   */
  const savePasted = (p: PastedSpec) =>
    start(async () => {
      setErr(null);
      setMsg(null);
      if (body && body !== sheet.bodyType) await setGenerationBodyType(sheet.variantKey, body);
      const lines: SpecEntryLine[] = [];
      p.trims.forEach((trim, i) => {
        for (const it of p.items) {
          const v = it.values[i];
          if (!v) continue;
          lines.push({ item: it.item, raw: v, qualifier: it.qualifier, trim });
        }
      });
      if (lines.length === 0) {
        setErr("넣을 값이 없습니다");
        return;
      }
      const r = await saveSpecByOwner({
        variantKey: sheet.variantKey,
        origin: "인터넷",
        originNote: originNote || "제원 쪽에서 붙여넣음",
        lines,
      });
      if (r.error) {
        setErr(r.error);
        return;
      }
      setClashes(r.clashes);
      if (r.saved > 0) {
        setMsg(`${r.saved}개를 넣었습니다 (세부모델 ${p.trims.length}가지)`);
        setPasted(null);
        router.refresh();
      }
      if (r.rejected.length) setErr(r.rejected.map((x) => `${x.label}: ${x.why}`).join(" · "));
    });

  return (
    <>
      {/* ── 오늘 채울 차종 ── */}
      <div className="mt-3 rounded-card border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900">{sheet.label}</h2>
          <span className="text-[13px] text-slate-500">
            우리 손님 차 {sheet.cars}대 · 채운 항목 {sheet.rows.filter((r) => r.now.length).length}/{sheet.rows.length}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {targets.slice(0, 6).map((t) => (
            <Link
              key={t.variantKey}
              href={`/settings/spec/fill?gen=${encodeURIComponent(t.variantKey)}`}
              className={`rounded-full px-3 py-1 text-[13px] font-medium ${
                t.variantKey === sheet.variantKey ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              {t.label} <span className="opacity-60">{t.cars}대</span>
            </Link>
          ))}
        </div>
      </div>

      {/* ── 차체 ── */}
      <div className="mt-3 rounded-card border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold text-slate-500">차체 종류</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {BODY_TYPES.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBody(b)}
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                body === b ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              {b}
            </button>
          ))}
        </div>
        {!sheet.bodyType && (
          <p className="mt-2 text-xs leading-snug text-amber-700">
            {sheet.bodyGuess
              ? `손님 차를 보고 「${sheet.bodyGuess}」로 짐작했습니다 — 맞는지 봐 주세요.`
              : "차체를 골라 주세요."}{" "}
            차체를 알아야 <b>휠너트 토크가 승용 범위(8~20 kgf·m)로</b> 검사됩니다.
          </p>
        )}
      </div>

      {/* ── 어디서 보셨나 ── */}
      <div className="mt-3 rounded-card border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold text-slate-500">어디서 보셨나요? — 근거로 남습니다</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ORIGINS.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setOrigin(o)}
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                origin === o ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              {o}
            </button>
          ))}
        </div>
        {origin === "인터넷" && (
          <input
            value={originNote}
            onChange={(e) => setOriginNote(e.target.value)}
            placeholder="보신 쪽 주소를 붙여넣어 주세요"
            className="mt-2 w-full rounded-control border border-slate-300 px-3 py-2 text-sm"
          />
        )}
      </div>

      {err && <Notice tone="error">{err}</Notice>}
      {msg && !err && <Notice tone="success">{msg}</Notice>}

      {clashes.length > 0 && (
        <div className="mt-3 rounded-card border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">지금 값과 다릅니다 — 어느 쪽이 맞습니까?</p>
          <ul className="mt-2 space-y-1 text-[13px] text-amber-900">
            {clashes.map((c) => (
              <li key={c.item}>
                <b>{c.label}</b> · 지금 {c.지금} → 넣으신 것 {c.넣으신것}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <Button size="md" pending={pending} onClick={() => save(clashes.map((c) => c.item))}>
              <Check className="size-4" /> 넣은 값으로 바꿉니다
            </Button>
            <Button size="md" variant="ghost" onClick={() => setClashes([])}>
              <X className="size-4" /> 그대로 둡니다
            </Button>
          </div>
        </div>
      )}

      {/* ── 제원 쪽 통째로 붙여넣기 ── */}
      <PasteBox
        pasted={pasted}
        onParse={setPasted}
        onSave={savePasted}
        pending={pending}
      />

      {/* ── 순정 타이어 고르기 ── */}
      <OeTirePicker
        onPick={(t) => {
          set("oe_tire_brand", { raw: t.brand });
          if (t.pattern) set("oe_tire_pattern", { raw: t.pattern });
          set("tire_size", { raw: t.size });
        }}
      />

      {/* ── 항목들 ── */}
      <div className="mt-3 space-y-2">
        {sheet.rows.map((r) =>
          r.positions ? (
            r.positions.map((p) => (
              <Row
                key={keyOf(r.item, p)}
                row={r}
                position={p}
                value={draft[keyOf(r.item, p)]}
                made={checked[keyOf(r.item, p)]}
                onChange={(patch) => set(keyOf(r.item, p), patch)}
              />
            ))
          ) : (
            <Row
              key={r.item}
              row={r}
              position={null}
              value={draft[r.item]}
              made={checked[r.item]}
              onChange={(patch) => set(r.item, patch)}
            />
          ),
        )}
      </div>

      <div className="sticky bottom-16 mt-4 rounded-card border border-slate-200 bg-white p-3 shadow-sm lg:bottom-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-slate-600">
            넣을 것 <b className="text-slate-900">{ready}개</b>
            {bad > 0 && <span className="ml-2 text-amber-700">고칠 것 {bad}개</span>}
          </span>
          <Button pending={pending} disabled={ready === 0} onClick={() => save()}>
            <Check className="size-4" /> 넣기
          </Button>
        </div>
      </div>
    </>
  );
}

function Row({
  row,
  position,
  value,
  made,
  onChange,
}: {
  row: FillSheet["rows"][number];
  position: string | null;
  value?: { raw: string; unit?: string | null };
  made?: ReturnType<typeof canonical>;
  onChange: (patch: { raw?: string; unit?: string | null }) => void;
}) {
  const now = row.now.filter((n) => (position ? n.qualifier === position : true));
  const raw = value?.raw ?? "";
  const unit = value?.unit ?? row.units[0] ?? null;

  return (
    <div className="rounded-card border border-slate-200 bg-white p-3">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-semibold text-slate-800">
          {row.label}
          {position && <span className="ml-1 text-xs font-normal text-slate-400">{position}</span>}
        </label>
        {now.length > 0 && (
          <span className="text-right text-[13px] text-slate-500">
            지금 {now.map((n) => n.display).join(" · ")}{" "}
            {now[0].status === "승인" ? (
              <StatusPill tone="success">확인</StatusPill>
            ) : (
              <StatusPill tone="neutral">자동</StatusPill>
            )}
          </span>
        )}
      </div>

      {row.choices ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {row.choices.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ raw: raw === c ? "" : c })}
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                raw === c ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <input
            value={raw}
            onChange={(e) => onChange({ raw: e.target.value })}
            placeholder={row.hint ?? ""}
            inputMode={row.numeric ? "decimal" : "text"}
            className="min-w-0 flex-1 rounded-control border border-slate-300 px-3 py-2 text-sm"
          />
          {row.units.length > 1 && (
            <select
              value={unit ?? ""}
              onChange={(e) => onChange({ unit: e.target.value })}
              className="shrink-0 rounded-control border border-slate-300 px-2 py-2 text-sm"
            >
              {row.units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          )}
          {row.units.length === 1 && (
            <span className="shrink-0 self-center text-sm text-slate-400">{row.units[0]}</span>
          )}
        </div>
      )}

      {/* 🔴 치는 즉시 — 저장될 모양이거나, 왜 안 되는지 */}
      {made && (
        <p className={`mt-1.5 text-xs leading-snug ${made.ok ? "text-brand-700" : "text-amber-700"}`}>
          {made.ok ? `✓ 이렇게 저장됩니다: ${made.display}` : `⚠ ${made.why}`}
        </p>
      )}
    </div>
  );
}

/**
 * 순정 타이어를 **우리 상품에서** 고른다 (2026-09-08, 사장님 지시)
 * 🔴 고르면 브랜드·패턴·규격 셋이 한꺼번에 들어간다. 설명서에는 패턴명이 아예 없다.
 * 🔴 없으면 빈 목록이다 — 그때는 직접 치신다.
 */
function OeTirePicker({ onPick }: { onPick: (t: OeTireChoice) => void }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<OeTireChoice[] | null>(null);
  const [picked, setPicked] = useState<OeTireChoice | null>(null);
  const [pending, start] = useTransition();

  const look = () =>
    start(async () => {
      const size = /\d{3}\/\d{2}\s*[RZ]?\s*\d{2}/i.test(q) ? q : null;
      setList(await findOeTires({ size, text: size ? null : q }));
    });

  return (
    <div className="mt-3 rounded-card border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold text-slate-500">순정 타이어를 우리 상품에서 고르기</p>
      <div className="mt-2 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && look()}
          placeholder="235/45R18 처럼 규격, 또는 브랜드·패턴 이름"
          className="min-w-0 flex-1 rounded-control border border-slate-300 px-3 py-2 text-sm"
        />
        <Button size="md" variant="secondary" pending={pending} onClick={look}>
          <Search className="size-4" /> 찾기
        </Button>
      </div>
      {picked && (
        <p className="mt-2 text-xs text-brand-700">
          ✓ {picked.brand} {picked.pattern ?? ""} {picked.size} 을 넣었습니다 — 아래 세 칸이 채워졌습니다
        </p>
      )}
      {list !== null &&
        (list.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            우리 상품에 없습니다 — 아래에서 직접 넣어 주세요.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {list.map((t) => (
              <li key={t.productId}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(t);
                    setPicked(t);
                    /* 고르면 목록을 닫는다 — 안 닫으면 입력칸이 저 아래로 밀린다 */
                    setList(null);
                  }}
                  className="flex w-full items-center gap-2 py-2 text-left active:bg-slate-50 lg:hover:bg-slate-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {t.pattern ?? "(패턴 없음)"}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {t.brand} · {t.size}
                      {t.stock > 0 && <span className="ml-1 text-brand-700">재고 {t.stock}</span>}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-slate-400" />
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

/**
 * 제원 쪽을 **통째로 붙여넣는** 칸 (2026-09-08, 사장님 지시)
 *
 * 「그랜저 ig 제원이 이런식인데 현재의 폼으로는 해결이 안됨.」
 *
 * 🔴 제원은 **세부모델(트림)마다 다르다.** 모던은 17인치·225/55, 익스클루시브는 18인치·245/45.
 *    한 칸씩 치시게 하면 트림 셋이면 세 배를 치셔야 한다.
 * 🔴 **읽은 것을 먼저 보여 드리고** 넣습니다. 조용히 넣으면 잘못 읽은 것을 못 보신다.
 */
function PasteBox({
  pasted,
  onParse,
  onSave,
  pending,
}: {
  pasted: PastedSpec | null;
  onParse: (p: PastedSpec | null) => void;
  onSave: (p: PastedSpec) => void;
  pending: boolean;
}) {
  const [text, setText] = useState("");
  const [failed, setFailed] = useState(false);

  const read = () => {
    const got = parseSpecPaste(text);
    setFailed(got === null);
    onParse(got);
  };

  return (
    <div className="mt-3 rounded-card border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold text-slate-500">제원 쪽을 통째로 붙여넣기</p>
      <p className="mt-1 text-[11px] leading-snug text-slate-400">
        다나와·카이즈유 같은 제원 쪽을 <b>전체 선택해서 복사</b>해 붙이시면, 세부모델별로 읽어 드립니다.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="여기에 붙여넣으세요"
        className="mt-2 w-full rounded-control border border-slate-300 px-3 py-2 text-sm"
      />
      <div className="mt-2 flex gap-2">
        <Button size="md" variant="secondary" onClick={read} disabled={text.trim().length < 20}>
          읽기
        </Button>
        {pasted && (
          <Button size="md" pending={pending} onClick={() => onSave(pasted)}>
            <Check className="size-4" /> 이대로 넣기
          </Button>
        )}
      </div>

      {failed && (
        <p className="mt-2 text-xs text-amber-700">
          제원 쪽으로 안 보입니다 — 「… 제원 정보」가 든 쪽 전체를 복사해 주세요.
        </p>
      )}

      {pasted && (
        <div className="mt-3 overflow-x-auto">
          <p className="text-xs font-semibold text-slate-600">읽은 것 — 맞는지 봐 주세요</p>
          <table className="mt-1 w-full min-w-[420px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-1 pr-2 font-medium">항목</th>
                {pasted.trims.map((t) => (
                  <th key={t} className="py-1 pr-2 font-medium">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pasted.items.map((it) => (
                <tr key={`${it.item}-${it.qualifier ?? ""}`} className="border-b border-slate-50">
                  <td className="py-1 pr-2 text-slate-500">
                    {it.label}
                  </td>
                  {it.values.map((v, i) => (
                    <td key={i} className="py-1 pr-2 font-semibold text-slate-900">
                      {v ?? <span className="font-normal text-slate-300">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {pasted.hints.length > 0 && (
            <p className="mt-1.5 text-[11px] text-slate-400">
              참고: {pasted.hints.map((h) => `${h.label} ${h.values.filter(Boolean).join(" / ")}`).join(" · ")}
            </p>
          )}
          {pasted.warn.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {pasted.warn.map((w, i) => (
                <li key={i} className="text-[11px] text-amber-700">
                  ⚠ {w}
                </li>
              ))}
            </ul>
          )}
          {pasted.items.length === 0 && (
            <p className="mt-1.5 text-xs text-amber-700">읽어낸 값이 없습니다 — 위 이유를 봐 주세요.</p>
          )}
        </div>
      )}
    </div>
  );
}
