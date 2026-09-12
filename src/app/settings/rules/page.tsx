import { redirect } from "next/navigation";
import { getSession, hasPerm } from "@/lib/auth";
import { PageHeader, PageShell } from "@/components/ui/page";
import { W } from "@/lib/fin-words";
import { listRules } from "@/lib/party-rule";
import { recentRuleOffs } from "@/lib/fin-activity";
import { RulesClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * ⭐ 「자동 규칙」 — 앱이 배운 것을 보고 끄는 화면 (돈관리 개편 4단계, 2026-09-12)
 *
 *   사장님 결정 5 「보고 끄기만」 · 결정 6 「앱에 박힌 기본 규칙도 보여 주고 끌 수 있게」.
 *   다섯 갈래(이름 짝 · 계산서 상대 · 지출 분류 · 입금 성격 · 앱 기본 규칙)를 한 목록으로 본다.
 *
 * 🔴 **추가·수정 입력은 없다.** 규칙은 사장님이 맞추기 단추 옆 「다음부터 자동으로」를
 *    켜 둔 채로 한 번 맞추면 앱이 스스로 배운다 — 여기서 손으로 만들 일이 생기면
 *    「배우는 곳」이 둘이 되어 어느 쪽이 진짜인지 매번 생각하게 된다.
 * 🔴 질의는 하나씩 — Promise.all 로 묶으면 풀(max 3)이 만석이 된다.
 */
export default async function RulesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  /* 돈 관리 권한이 있는 계정만 — 규칙은 전부 돈관리에서 배운 것이다 */
  if (!(await hasPerm("finance"))) redirect("/settings");

  const rows = await listRules();
  /* 최근 끈 규칙 — 되살리기는 「최근 한 일」 한 곳(결정 14)이라 여기선 목록만 */
  const offs = await recentRuleOffs(30);

  return (
    <PageShell width="md">
      <PageHeader title={W.rules} back={{ href: "/settings", label: "설정" }} />
      <p className="mt-1 text-sm text-slate-500">
        앱이 <strong>한 번 맞춘 것을 기억해 둔 목록</strong>입니다. 다음 달에 같은 상대가 오면 이 규칙대로
        바로 붙입니다. 틀린 것만 끄시면 됩니다 — 여기서 새로 만들 필요는 없습니다.
      </p>

      <RulesClient rows={rows} offs={offs} />
    </PageShell>
  );
}
