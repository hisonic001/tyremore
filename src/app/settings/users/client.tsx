"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setMarsReportTechAccess } from "@/lib/mars-eval";
import { createAccount, resetPassword, savePerms, setActive, setRole, updateAccount, type UserRow } from "@/lib/user-admin";
import { allOnPerms, BASE_KEYS, OWNER_KEYS, PERM_KEYS, PERM_LABELS, type PermMap } from "@/lib/perm-keys";

/** ⭐ MARS 평가 리포트 정비사 열람 (사장님 요청 2026-08-10) — 계정 전체에 걸리는 스위치 하나 */
export function MarsReportToggle({ allowed }: { allowed: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold">MARS 입력 평가 리포트</div>
          <div className="mt-0.5 text-sm text-slate-500">
            정비사 계정도 <span className="font-medium">/reports/mars</span> 를 볼 수 있게 합니다
            (매입가·마진은 안 나오는 화면입니다)
          </div>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setMsg(null);
              const r = await setMarsReportTechAccess(!allowed);
              if (!r.ok) return setMsg(`⚠️ ${r.error}`);
              router.refresh();
            })
          }
          className={`shrink-0 rounded-lg px-4 py-2.5 text-sm font-semibold ${
            allowed ? "bg-emerald-700 text-white" : "border border-slate-300 text-slate-600"
          } disabled:opacity-50`}
        >
          {allowed ? "정비사 열람 켜짐" : "정비사 열람 꺼짐"}
        </button>
      </div>
      {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}
    </div>
  );
}

/** 계정 한 장 — 역할·비밀번호·중지를 이 자리에서 (사장님 요청 2026-08-08) */
export function UserCard({ u }: { u: UserRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState("");
  /* ⭐ 아이디·이름 바꾸기 (2026-09-02) */
  const [idOpen, setIdOpen] = useState(false);
  const [loginId, setLoginId] = useState(u.loginId);
  const [name, setName] = useState(u.name);
  /* ⭐ 기능 스위치 (2026-09-02) — 저장 즉시 반영 */
  const [perms, setPerms] = useState<PermMap>(u.perms);
  const [permsOpen, setPermsOpen] = useState(false);
  const permsDirty = JSON.stringify(perms) !== JSON.stringify(u.perms);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      setMsg(r.ok ? okMsg : `⚠️ ${(r as { error?: string }).error}`);
      if (r.ok) {
        setPwOpen(false);
        setPw("");
        router.refresh();
      }
    });

  return (
    <li className={`rounded-xl border bg-white p-4 ${u.isActive ? "border-slate-200" : "border-slate-200 opacity-60"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">
            {u.name}
            {u.isMe && <span className="ml-1.5 text-xs font-normal text-slate-400">(나)</span>}
            {!u.isActive && (
              <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-xs font-normal">중지됨</span>
            )}
          </div>
          <div className="text-sm text-slate-500">{u.loginId}</div>
        </div>
        <span
          className={`rounded-lg px-2.5 py-1 text-sm font-semibold ${
            u.role === "owner" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-600"
          }`}
        >
          {u.role === "owner" ? "사장님" : "정비사"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {/* ⭐ 권한 부여/회수 (사장님 요청) — 마지막 사장님은 서버가 막는다 */}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(
              () => setRole(u.id, u.role === "owner" ? "tech" : "owner"),
              u.role === "owner" ? "정비사로 바꿨습니다" : "사장님 권한을 줬습니다",
            )
          }
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600"
        >
          {u.role === "owner" ? "정비사로" : "사장님 권한 주기"}
        </button>
        <button
          type="button"
          onClick={() => {
            setPwOpen(!pwOpen);
            setMsg(null);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600"
        >
          비밀번호 재설정
        </button>
        <button
          type="button"
          onClick={() => {
            setIdOpen(!idOpen);
            setMsg(null);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600"
        >
          아이디·이름 바꾸기
        </button>
        {u.role === "tech" && (
          <button
            type="button"
            onClick={() => {
              setPermsOpen(!permsOpen);
              setMsg(null);
            }}
            className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700"
          >
            할 수 있는 일 {Object.values(u.perms).filter(Boolean).length}/{PERM_KEYS.length}
          </button>
        )}
        {!u.isMe && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => setActive(u.id, !u.isActive), u.isActive ? "중지했습니다" : "되살렸습니다")
            }
            className={`ml-auto rounded-lg border px-3 py-2 text-sm font-medium ${
              u.isActive ? "border-red-200 text-red-600" : "border-emerald-300 text-emerald-700"
            }`}
          >
            {u.isActive ? "사용 중지" : "되살리기"}
          </button>
        )}
      </div>

      {pwOpen && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2">
          <input
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="새 비밀번호 (4자 이상)"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={pending || pw.length < 4}
            onClick={() => run(() => resetPassword(u.id, pw), "재설정했습니다 — 본인에게 알려 주세요")}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            재설정
          </button>
        </div>
      )}

      {idOpen && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2">
          <input
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            placeholder="아이디 (영문·숫자 2~30자)"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="이름"
            className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={pending || !loginId.trim() || !name.trim()}
            onClick={() =>
              run(
                () => updateAccount({ userId: u.id, loginId, name }),
                "바꿨습니다 — 다음 로그인부터 새 아이디를 씁니다 (지금 로그인은 그대로)",
              )
            }
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            저장
          </button>
        </div>
      )}

      {/* ⭐ 기능 모듈 스위치 (사장님 요청 2026-09-02) — 정비사 계정만. 저장 즉시 반영 */}
      {permsOpen && u.role === "tech" && (
        <div className="mt-2 rounded-lg bg-slate-50 p-2.5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">이 계정이 할 수 있는 일</p>
            <button
              type="button"
              onClick={() => setPerms((p) => ({ ...p, ...allOnPerms() }))}
              className="text-xs text-slate-500 underline underline-offset-4"
            >
              매장 일 전부 켜기
            </button>
          </div>
          <ul className="mt-1.5 space-y-1">
            {BASE_KEYS.map((k) => (
              <li key={k}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={perms[k] === true}
                    onChange={(e) => setPerms((p) => ({ ...p, [k]: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 accent-brand-600"
                  />
                  <span className="text-sm">
                    {PERM_LABELS[k].label}
                    <span className="ml-1.5 text-xs text-slate-400">{PERM_LABELS[k].hint}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {/* ⭐ 사장님 영역 해금 (사장님 지시 2026-09-02 — "해금 가능한 기능들은 일단 넣어놓고") */}
          <p className="mt-2.5 text-sm font-medium text-amber-800">사장님 영역 — 민감한 것들이라 개별로만</p>
          <ul className="mt-1 space-y-1">
            {OWNER_KEYS.map((k) => (
              <li key={k}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={perms[k] === true}
                    onChange={(e) => setPerms((p) => ({ ...p, [k]: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 accent-amber-600"
                  />
                  <span className="text-sm">
                    {PERM_LABELS[k].label}
                    <span className="ml-1.5 text-xs text-slate-400">{PERM_LABELS[k].hint}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">계정 관리(이 화면)만은 항상 사장님 전용입니다 — 직원이 스스로 권한을 켜는 것을 막기 위해서입니다.</p>
          <button
            type="button"
            disabled={pending || !permsDirty}
            onClick={() => run(() => savePerms(u.id, perms), "저장했습니다 — 즉시 반영됩니다 (재로그인 불필요)")}
            className="mt-2 w-full rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            스위치 저장
          </button>
        </div>
      )}

      {msg && <p className="mt-2 text-sm text-slate-600">{msg}</p>}
    </li>
  );
}

/** 새 계정 만들기 — 공개 가입 대신 사장님이 만든다 */
export function NewAccount() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ loginId: "", name: "", password: "", role: "tech" as "owner" | "tech" });
  const [msg, setMsg] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full rounded-xl border border-dashed border-slate-300 py-3 font-medium text-slate-500 active:bg-slate-50"
      >
        + 새 계정 만들기
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-300 bg-white p-4">
      <h2 className="font-semibold">새 계정</h2>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="col-span-1">
          <span className="text-xs text-slate-500">아이디 (영문·숫자)</span>
          <input
            value={f.loginId}
            onChange={(e) => setF({ ...f, loginId: e.target.value })}
            className="mt-0.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
          />
        </label>
        <label className="col-span-1">
          <span className="text-xs text-slate-500">이름</span>
          <input
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            className="mt-0.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
          />
        </label>
        <label className="col-span-2">
          <span className="text-xs text-slate-500">임시 비밀번호 (4자 이상 — 본인이 나중에 바꿀 수 있습니다)</span>
          <input
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
            className="mt-0.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
          />
        </label>
      </div>
      <div className="mt-2 flex gap-2">
        {(
          [
            ["tech", "정비사"],
            ["owner", "사장님"],
          ] as const
        ).map(([r, label]) => (
          <button
            key={r}
            type="button"
            onClick={() => setF({ ...f, role: r })}
            className={`rounded-lg border px-4 py-2 text-sm font-medium ${
              f.role === r ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-600"
        >
          취소
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setMsg(null);
              const r = await createAccount(f);
              if (!r.ok) return setMsg(r.error);
              setOpen(false);
              setF({ loginId: "", name: "", password: "", role: "tech" });
              router.refresh();
            })
          }
          className="flex-1 rounded-lg bg-slate-900 py-2.5 font-semibold text-white disabled:opacity-50"
        >
          {pending ? "만드는 중…" : "만들기"}
        </button>
      </div>
    </div>
  );
}
