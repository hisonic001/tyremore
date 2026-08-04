import { redirect } from "next/navigation";

/**
 * 옛 주소 — `/settings/products?tab=new` 로 옮겼다 (2026-08-04).
 *
 * 화면을 접으면서 자리가 바뀌었다. 즐겨찾기·옛 링크가 죽지 않게 넘겨만 준다.
 * ⚠️ `?q=` 는 홈 검색이 빈손일 때 넘어오는 검색어다. **꼭 함께 넘겨야 한다** —
 *    안 넘기면 사장님이 방금 친 규격을 다시 쳐야 한다.
 */
export default async function OldNewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  redirect(`/settings/products?tab=new${q ? `&q=${encodeURIComponent(q)}` : ""}`);
}
