/**
 * 사진 폴더 이름 읽기 — 순수 함수 (C단계, 2026-09-02)
 *
 * 사장님 폴더 이름은 이렇게 생겼다 (실제 18개):
 *   `264저6834 벤츠 GLS` · `123마9868펠리세이드` · `85더7753렉스턴스포츠칸-얼라인먼트`
 *   `(미업로드)83다8036 코란도스포츠 TPMS 센서` · `23거1012[33213km-48213km]`
 *   `3.4` · `4.6 테슬라 모델Y`   ← 번호판이 없는 것도 있다
 *
 * 여기서 세 가지를 뽑는다:
 *   ① `(미업로드)` 접두사 → **사장님의 실제 대기열**
 *   ② 번호판 → 차량·판매 잇기 (화면엔 안 쓴다)
 *   ③ 화면에 보여줄 이름 → **번호판을 가린 것**
 *
 * 🔴 `@/db` 를 import 하지 않는다 — 화면과 테스트가 같이 쓴다.
 */
import { normalizePlate } from "./normalize";

export const PENDING_PREFIX = "(미업로드)";

/** 폴더명 안에 박힌 번호판 — 앞뒤에 글자가 붙어 있어도 잡는다 (`123마9868펠리세이드`) */
const PLATE_IN_NAME = /(?:[가-힣]{2})?\d{2,3}[가-힣]\d{4}/;

export interface FolderName {
  /** 폴더 이름 그대로 — 대리인이 원본을 찾을 때 쓴다 */
  name: string;
  /** 아직 블로그에 안 올린 건 */
  isPending: boolean;
  /** 정규화한 번호판. 없으면 null */
  plate: string | null;
  /** 화면에 보여줄 이름 — 번호판을 `○○○` 로 가린 것 */
  label: string;
}

export function parseFolderName(name: string): FolderName {
  const isPending = name.startsWith(PENDING_PREFIX);
  const body = isPending ? name.slice(PENDING_PREFIX.length) : name;

  const m = body.match(PLATE_IN_NAME);
  const plate = m ? normalizePlate(m[0]) : null;

  /**
   * 화면 이름 — 번호판을 지우고 남은 말을 다듬는다.
   * 지우고 나면 `펠리세이드` 처럼 차종만 남는데, 그게 사장님이 알아보기 쉬운 이름이다.
   */
  let label = (m ? body.replace(m[0], " ") : body)
    .replace(/[\[\]]/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!label) label = m ? "번호판만 있는 폴더" : body.trim() || "이름 없는 폴더";

  return { name, isPending, plate, label };
}

/** 사진인가 (AI 에 보낼 수 있는 것) */
export function isPhoto(fileName: string): boolean {
  return /\.(jpe?g|png)$/i.test(fileName);
}

/** 동영상인가 — 목록에만 세고 AI 에는 안 보낸다 */
export function isVideo(fileName: string): boolean {
  return /\.(mp4|mov|avi|mkv)$/i.test(fileName);
}

/**
 * 정렬 복사본 파일 이름 — 사장님이 벤츠 GLS 폴더에 손수 붙이신 방식 그대로.
 *   `A-04 차량 정면 입고.jpg`
 * 윈도우 파일명에 못 쓰는 글자는 뺀다.
 */
export function copyFileName(slot: string, caption: string, ext: string): string {
  const safe = caption
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return `${slot}${safe ? ` ${safe}` : ""}${ext}`;
}

/** 본문에 박히는 사진 자리 — 실제 발행 글이 쓰는 형식 그대로 */
export function photoPlaceholder(slot: string, caption: string): string {
  return `[사진 ${slot} - ${caption}]`;
}

/** 본문에서 사진 자리를 찾아낸다 (화면이 그 자리에 미리보기를 끼워 넣는다) */
export const PHOTO_SLOT_RE = /\[사진\s+([A-C]-\d{2})\s*-\s*([^\]]*)\]/g;
