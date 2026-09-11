/**
 * ⭐ 카드 일마감 어휘 — 토스 포스와 앱은 낱말이 다르다 (2026-08-29)
 *
 * 🔴 이 파일은 **순수 상수만** — DB 를 안 부른다.
 *    일마감 화면(클라이언트)이 사유 목록을 그리려면 상수를 가져와야 하는데,
 *    pos-close.ts 는 `@/db` 를 물고 있어 그대로 가져오면 서버 코드가 브라우저 묶음에 딸려간다.
 *    그래서 낱말만 여기로 뺐다. pos-close.ts 가 그대로 다시 내보내므로 서버 쪽 import 는 그대로다.
 */

/** 토스 포스 결제수단 → 앱 결제수단 (scripts/add-pos-txn.ts 의 method 주석이 원본) */
export const POS_TO_APP: Record<string, string> = {
  카드: "카드",
  QR결제: "간편결제",
  선불지급수단: "간편결제",
  현금: "현금",
  계좌이체: "계좌이체",
};

/** 카드 일마감이 대조하는 앱 결제수단 — 현금·계좌이체는 여기서 안 맞춘다 */
export const RECON_METHODS = ["카드", "간편결제"] as const;

/** 그에 해당하는 토스 포스 쪽 낱말 — 카드 · QR결제 · 선불지급수단 */
export const RECON_POS_METHODS = Object.keys(POS_TO_APP).filter((k) =>
  (RECON_METHODS as readonly string[]).includes(POS_TO_APP[k]),
);

export const isReconPos = (posMethod: string) =>
  (RECON_METHODS as readonly string[]).includes(POS_TO_APP[posMethod] ?? "");

/** 다른 날 후보를 며칠까지 볼까 (2026-08-29 — 앞뒤 1일은 선결제·후결제를 놓쳤다) */
export const NEARBY_DAYS = 7;

/**
 * 미리 받아 둔 돈 — 판매가 아직 없다.
 * 이 사유가 달린 POS 건은 그 날 마감을 막지 않고, 판매가 생길 때까지 일마감 화면 맨 위에 남는다.
 */
export const PREPAID_REASON = "선결제 — 판매는 나중에";

/** 미해결 사유 — 서버·화면이 이 하나를 같이 쓴다 (전엔 서버 8개 vs 화면 5개로 갈려 있었다) */
export const POS_REASONS = [
  "단말기 누락",
  "앱 미등록",
  "취소",
  "다른 날",
  PREPAID_REASON,
  "개인통장 입금",
  "현금으로 받음",
  "아직 안 들어옴",
  "기타",
] as const;
