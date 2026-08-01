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
const client = postgres(url, {
  max: 10,
  idle_timeout: 20,
  // 한글 정렬·검색을 위해 클라이언트도 UTF-8 고정
  connection: { application_name: "tyremore" },
});

export const db = drizzle(client, { schema });
export { schema };
