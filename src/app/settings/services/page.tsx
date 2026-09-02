import Link from "@/lib/link";
import { isOwner, hasPerm } from "@/lib/auth";
import { listServiceCatalog } from "@/lib/service-catalog";
import { Notice } from "@/components/ui/notice";
import { ServiceManager } from "./client";

export const dynamic = "force-dynamic";

/**
 * ⭐ 공임·정비 목록 관리 (사장님 요청 2026-08-31)
 *
 *   "공임정비 추가 항목들을 수정 및 추가가 가능하게. mars 등록을 방해하지 않는 선에서."
 *
 *   판매 등록·판매 내역의 「공임·정비 추가」 검색창이 이 목록(69건, MARS 이관)을 쓴다.
 *   지금까지는 목록에 없으면 「기타」+메모로 때워 오셨다 — 여기서 목록 자체를 고친다.
 *
 * 🔴 MARS 경계선은 lib/service-catalog.ts 머리말 참조 (번호 불변 · 삭제 없음 · 스냅샷).
 */
export default async function ServicesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const sp = await searchParams;
  const owner = await hasPerm("master");

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-5 pb-24">
      <Link href="/settings" className="text-sm text-slate-500 underline underline-offset-4">
        ← 설정으로
      </Link>
      <h1 className="mt-3 text-xl font-bold">공임·정비 목록</h1>
      <p className="mt-1 text-sm text-slate-500">
        판매 등록·정비 내역의 「공임·정비 추가」 검색에 나오는 목록입니다.
      </p>

      {!owner ? (
        <Notice tone="warn">공임·정비 목록은 사장님 계정에서만 고칠 수 있습니다.</Notice>
      ) : (
        <Body startNew={sp.new === "1"} />
      )}
    </main>
  );
}

async function Body({ startNew }: { startNew: boolean }) {
  const r = await listServiceCatalog();
  if (!r.ok) return <Notice tone="error">{r.error}</Notice>;
  return <ServiceManager rows={r.rows} startNew={startNew} />;
}
