import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL 이 설정되지 않았습니다. .env.example 을 복사해 .env.local 을 만드세요.",
  );
}

/**
 * postgres.js 를 쓰는 이유: 표준 PostgreSQL 프로토콜만 사용한다.
 * Supabase 고유 SDK를 쓰지 않으므로 자체 서버로 옮길 때 접속 문자열만 바꾸면 된다 (D-06).
 */
/**
 * 🔴 max 는 낮게 잡는다 (2026-08-05 장애 — «max clients reached in session mode»).
 *
 * Supabase 세션 풀러는 **전체 15자리**뿐인데, 이 클라이언트는 프로세스마다 생긴다:
 * Vercel 인스턴스(몰리면 여러 개) + 매장 PC 대리인 + mars-fill + 개발 서버.
 * max 10 이던 시절엔 둘만 겹쳐도 한도를 넘어 홈이 500으로 죽었다.
 * 화면 하나가 동시에 날리는 쿼리는 2~4개라 3이면 충분하다 — 넘치면 잠깐 줄을 설 뿐이다.
 */
const client = postgres(url, {
  max: 3,
  idle_timeout: 20,
  /**
   * 🔴 소켓을 5분마다 갈아 끼운다 (2026-08-11 무한로딩 2차).
   *    Vercel 로그에 「write CONNECTION_CLOSED」 — 풀러(Supavisor)가 이미 닫은
   *    낡은 소켓에 질의를 쓰다 죽거나, 어중간한 소켓에서 멈춰(ClientRead) 좀비가 됐다.
   *    수명을 짧게 하면 낡은 소켓 자체가 안 생긴다.
   */
  max_lifetime: 60 * 5,
  connect_timeout: 15,
  /**
   * ⭐ 트랜잭션 풀러(6543) 대비 (2026-08-06 안정성 작업).
   * 트랜잭션 모드는 준비된 문장(prepared statement)을 지원하지 않는다 —
   * 이 줄 없이 포트만 6543 으로 바꾸면 모든 쿼리가 죽는다.
   * 세션 풀러(5432)에서도 그대로 동작하므로 어느 포트든 안전하다.
   */
  prepare: false,
  // 한글 정렬·검색을 위해 클라이언트도 UTF-8 고정
  connection: { application_name: "tyremore" },
});

export const db = drizzle(client, { schema });
export { schema };
