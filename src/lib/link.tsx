import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * 🔴 이 앱의 Link 는 **기본 prefetch 금지**다 (2026-08-07 풀러 마비 사건의 결론).
 *
 * Next 는 화면에 보이는 <Link> 의 페이지를 몰래 미리 렌더한다(prefetch).
 * 검색 카드 수십 장, 리포트의 「창고 세기 화면」 링크 — 어디에 링크가 있든
 * 무거운 페이지가 등 뒤에서 렌더되다가, 화면을 이동하면 **중단되며 DB 질의가
 * 좀비(active·ClientRead)로 남아** 트랜잭션 풀러를 채웠다. 이틀간 「전체 로딩」
 * 마비의 공통 뿌리다. 링크마다 막는 두더지 잡기 대신 여기서 한 번에 끈다.
 *
 * 서울 리전(icn1)이라 눌러서 여는 것도 수백 ms — prefetch 없이 충분히 빠르다.
 * 꼭 필요한 곳은 <Link prefetch={true}> 로 개별로 켤 수 있다 (props 가 뒤라 이긴다).
 */
export default function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
