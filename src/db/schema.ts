/**
 * 타이어모어 데이터 모델 — 1차 오픈
 *
 * 기준 문서: docs/09-데이터모델-확정.md
 * 이 파일과 문서가 어긋나면 안 된다. 스키마를 고치면 문서도 고칠 것.
 *
 * 공통 규칙 (docs/09 2장)
 *   PK    bigserial
 *   시각  timestamptz (저장 UTC · 표시 KST)
 *   삭제  하지 않는다. is_active / status 변경
 *   금액  integer (원 단위)
 *   비율  numeric(5,4)  0.2500 = 25%
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** 모든 테이블 공통 — 생성 시각 */
const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/* ============================================================
 * 3-1. app_user — 직원
 * role='tech' 에게는 매입원가·마진을 서버 응답에서 제외한다 (docs/08 3장)
 * ========================================================== */
export const appUser = pgTable(
  "app_user",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    loginId: text("login_id").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    /** 4자리 PIN — 매장 태블릿 계정 전환용 (D-11) */
    pinHash: text("pin_hash"),
    name: text("name").notNull(),
    role: text("role").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt,
  },
  (t) => [check("app_user_role", sql`${t.role} IN ('owner','tech')`)],
);

/* ============================================================
 * 3-2. brand — 타이어 브랜드 (MARS 제조사 코드 18종)
 * ========================================================== */
export const brand = pgTable("brand", {
  code: text("code").primaryKey(), // 'MI','PI','HK' ...
  nameKo: text("name_ko").notNull(),
  nameEn: text("name_en"),
  sortOrder: integer("sort_order").default(999),
  /**
   * ⭐ 우리가 취급하는 브랜드인가 (사장님 요청 2026-08-01)
   * MARS 마스터에는 본사가 다루는 브랜드가 전부 들어 있다. 우리가 안 받는 것도 있다.
   * false면 검색 결과에서 빠진다. 지우지 않으므로 언제든 되살릴 수 있다.
   */
  isHandled: boolean("is_handled").notNull().default(true),
});

/* ============================================================
 * 3-3. vehicle_maker — 차량 제조사 (정규화 필수)
 * 실데이터가 48종으로 흩어져 있다 (현대자동차/현대/HYUNDAI).
 * 통합하지 않으면 "현대"로 검색했을 때 절반이 안 나온다.
 * ========================================================== */
export const vehicleMaker = pgTable("vehicle_maker", {
  code: text("code").primaryKey(), // 'HYUNDAI','KIA','BENZ' ...
  nameKo: text("name_ko").notNull(),
  /** ⭐ 국산/수입 → 공임이 갈린다 (얼라인먼트 60,000 vs 80,000) */
  isImported: boolean("is_imported").notNull(),
  sortOrder: integer("sort_order").default(999),
});

/** MARS 원본 표기 → 정규화 코드 매핑 */
export const vehicleMakerAlias = pgTable("vehicle_maker_alias", {
  rawName: text("raw_name").primaryKey(),
  code: text("code")
    .notNull()
    .references(() => vehicleMaker.code),
});

/* ============================================================
 * 3-4. product — 상품 마스터 (타이어 + 부품, D-12)
 * ========================================================== */
export const product = pgTable(
  "product",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** MARS 품번. 타이어는 100% 보유, 부품은 없음 */
    marsItemNo: text("mars_item_no").unique(),
    itemType: text("item_type").notNull(), // 'tire' | 'part'
    /** 타이어=true(1본1행) / 부품=false(수량관리) */
    isSerialized: boolean("is_serialized").notNull(),

    brandCode: text("brand_code").references(() => brand.code),
    pattern: text("pattern"),
    /** 원문 보존 — 규격 파서를 나중에 고쳐 다시 돌릴 수 있어야 한다 */
    rawName: text("raw_name").notNull(),

    // --- 타이어 전용 (부품은 NULL) ---
    width: integer("width"), // 225
    aspectRatio: integer("aspect_ratio"), // 45
    rimInch: numeric("rim_inch", { precision: 4, scale: 1 }), // 17.0 (17.5 대비)
    loadIndex: text("load_index"),
    speedRating: text("speed_rating"),
    /** '여름'|'사계절'|'올웨더'|'겨울' — 모델명에서 판정 (src/lib/tire-attrs.ts) */
    season: text("season"),
    /** ⭐ 상담 필터 축. 손님이 "런플랫이요"라고 말한다 */
    isRunflat: boolean("is_runflat").notNull().default(false),
    isAcoustic: boolean("is_acoustic").notNull().default(false),
    isSuv: boolean("is_suv").notNull().default(false),

    // --- 부품 전용 (타이어는 NULL) ---
    partNo: text("part_no"), // 'MBA-039','SM188'
    /** ⭐ 적용 차종 — 부품 검색의 전부 */
    fitment: text("fitment"),
    position: text("position"), // '앞' | '뒤'

    category: text("category"),
    /** 제조사 바코드. SKU 단위라 같은 상품 4본은 값이 전부 같다 (D-02) */
    barcode: text("barcode"),
    /** ⭐ 기표가 (MARS 단가1) */
    listPrice: integer("list_price"),
    purchasePrice: integer("purchase_price"),
    supplierCode: text("supplier_code"),

    specParsed: boolean("spec_parsed").notNull().default(false),
    /**
     * ⭐ 한 번이라도 입고된 적이 있는가 (D-12 6번)
     *   false → 화면에 '⚪ 미등록' (0본이 아니다. 창고엔 있을 수 있다)
     *   true  → 숫자를 믿는다
     */
    stockTracked: boolean("stock_tracked").notNull().default(false),
    /**
     * 검색 결과에 보이는가. 단종·미취급 상품을 여기서 끈다 (2026-08-01).
     * ⚠️ 지우지 않는다. 기표가·규격·브랜드가 다 들어 있어서 지우면 손으로 다시 쳐야 한다.
     */
    isActive: boolean("is_active").notNull().default(true),
    /** 왜 숨겼는지 — 'no_price'(기표가 없음) | 'manual'(사람이 끔) */
    hiddenReason: text("hidden_reason"),
    createdAt,
    updatedAt,
  },
  (t) => [
    check("product_item_type", sql`${t.itemType} IN ('tire','part')`),
    index("idx_product_spec")
      .on(t.rimInch, t.width, t.aspectRatio)
      .where(sql`${t.isActive} AND ${t.itemType} = 'tire'`),
    index("idx_product_brand").on(t.brandCode).where(sql`${t.isActive}`),
    index("idx_product_barcode").on(t.barcode).where(sql`${t.barcode} IS NOT NULL`),
    // ⭐ 부품 검색의 전부: 적용 차종 부분검색
    index("idx_product_fitment").using("gin", sql`${t.fitment} gin_trgm_ops`),
    index("idx_product_partno").on(t.partNo).where(sql`${t.partNo} IS NOT NULL`),
    // 규격 + 계절로 좁히는 것이 상담에서 가장 흔한 조합이다
    index("idx_product_season").on(t.season).where(sql`${t.itemType} = 'tire' AND ${t.isActive}`),
  ],
);

/* ============================================================
 * 3-5. stock_item — 재고 (타이어와 부품을 한 테이블로)
 * ========================================================== */
export const stockItem = pgTable(
  "stock_item",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    stockNo: text("stock_no").notNull().unique(), // 'S26-000001'
    productId: bigint("product_id", { mode: "number" })
      .notNull()
      .references(() => product.id),
    /** 타이어=항상 1 / 부품=보유 수량 */
    qty: integer("qty").notNull().default(1),
    status: text("status").notNull().default("재고"),
    /** ⭐ 제조주차 'WWYY' — 1826 = 2026년 18주. 선입선출·노후화 경고의 근거 */
    dot: text("dot"),
    purchasePrice: integer("purchase_price"),
    location: text("location"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    soldAt: timestamp("sold_at", { withTimezone: true }),
    quoteId: bigint("quote_id", { mode: "number" }),
    /**
     * ⭐ NULL이면 화면에 숫자 대신 '미확인' (D-12 5번)
     *   부품 수량은 실물과 맞지 않는다. 0으로도, 틀린 숫자로도 넣지 않는다.
     */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: bigint("verified_by", { mode: "number" }).references(() => appUser.id),
    createdBy: bigint("created_by", { mode: "number" }).references(() => appUser.id),
    createdAt,
  },
  (t) => [
    check("stock_status", sql`${t.status} IN ('재고','보관중','판매완료','반품','폐기')`),
    check("stock_qty_positive", sql`${t.qty} >= 0`),
    index("idx_stock_avail").on(t.productId).where(sql`${t.status} = '재고'`),
    index("idx_stock_dot")
      .on(t.dot)
      .where(sql`${t.status} = '재고' AND ${t.dot} IS NOT NULL`),
  ],
);

/* ============================================================
 * 3-6. stock_movement — 입출고 이력
 * 재고가 실물과 어긋났을 때 "언제 누가 무엇을" 을 되짚는 유일한 수단.
 * ========================================================== */
export const stockMovement = pgTable(
  "stock_movement",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    stockItemId: bigint("stock_item_id", { mode: "number" })
      .notNull()
      .references(() => stockItem.id),
    type: text("type").notNull(),
    reason: text("reason"), // '판매','보관','폐기','실사조정'
    qtyDelta: integer("qty_delta").notNull().default(0),
    quoteId: bigint("quote_id", { mode: "number" }),
    memo: text("memo"),
    createdBy: bigint("created_by", { mode: "number" }).references(() => appUser.id),
    createdAt,
  },
  (t) => [
    check("movement_type", sql`${t.type} IN ('입고','출고','조정','반품')`),
    index("idx_movement_stock").on(t.stockItemId, t.createdAt),
  ],
);

/* ============================================================
 * 3-7. customer — 고객 ⭐ MARS 「연락처」 (D-10)
 * 「고객」은 회계 계정 2건일 뿐이다. 실제 명단은 「연락처」 2,603건.
 * ========================================================== */
export const customer = pgTable(
  "customer",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** ⭐ 'C583-012670' — D583(회계 계정)이 아니다 */
    marsContactNo: text("mars_contact_no").unique(),
    /** 원문 보존. '고태환[한진택배]'는 사장님이 손님을 기억하는 방식이다 — 지우지 않는다 */
    name: text("name").notNull(),
    /** 검색용 정규화 (괄호·공백 제거) */
    nameSearch: text("name_search"),
    /** 괄호 안 내용 복사 — 검색은 name·name_search·memo 를 전부 뒤진다 */
    memo: text("memo"),
    phone: text("phone"),
    type: text("type").notNull().default("개인"),
    grade: text("grade"),
    extraDiscountRate: numeric("extra_discount_rate", { precision: 5, scale: 4 }),
    /** 같은 전화 쓰는 묶음 72그룹. 합치지 않고 연결만 한다 */
    familyGroupId: bigint("family_group_id", { mode: "number" }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt,
  },
  (t) => [
    check("customer_type", sql`${t.type} IN ('개인','법인')`),
    index("idx_customer_phone").on(t.phone),
    index("idx_customer_name").using("gin", sql`${t.nameSearch} gin_trgm_ops`),
    index("idx_customer_family").on(t.familyGroupId).where(sql`${t.familyGroupId} IS NOT NULL`),
  ],
);
// ❌ email 컬럼 없음 — 실데이터 0건. 알림은 문자 단일 경로 (D-10)

/* ============================================================
 * 3-8. vehicle — 차량
 * ========================================================== */
export const vehicle = pgTable(
  "vehicle",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    marsVehicleNo: text("mars_vehicle_no").unique(), // 'V583-000001'
    customerId: bigint("customer_id", { mode: "number" })
      .notNull()
      .references(() => customer.id),
    plateNo: text("plate_no").notNull(), // 원문 '12가3456'
    plateNoNorm: text("plate_no_norm").notNull(), // 공백·하이픈 제거
    makerCode: text("maker_code").references(() => vehicleMaker.code),
    model: text("model"),
    year: integer("year"),
    mileage: integer("mileage"),
    mileageAt: timestamp("mileage_at", { withTimezone: true }),
    /** 순정규격 대신 이것을 쓴다 (D-04). 판매할 때마다 자동으로 쌓인다 */
    lastFittedSize: text("last_fitted_size"),
    lastVisitAt: timestamp("last_visit_at", { withTimezone: true }),
    memo: text("memo"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt,
  },
  (t) => [
    index("idx_vehicle_plate").on(t.plateNoNorm),
    /** ⭐ 고객은 "3456이요"라고 말한다. 뒷자리 검색이 실제로 더 자주 쓰인다 */
    index("idx_vehicle_plate_tail").using("btree", sql`right(${t.plateNoNorm}, 4)`),
    index("idx_vehicle_customer").on(t.customerId),
  ],
);

/* ============================================================
 * 3-9. service_item — 서비스·공임 (MARS 패스트핏 69건)
 * ========================================================== */
export const serviceItem = pgTable(
  "service_item",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    marsServiceNo: text("mars_service_no").unique(), // 'S001/1180'
    name: text("name").notNull(),
    shortName: text("short_name"),
    price: integer("price"),
    category: text("category"),

    /**
     * ⭐ 자동 계산 규칙 — 이게 없으면 매번 사람이 틀린다
     *   per_unit     본당       (장착 공임)
     *   per_2_units  2개당      (휠밸런스) → 4본이면 ⌈4÷2⌉ = 2회 청구
     *   per_job      건당       (얼라인먼트)
     */
    qtyRule: text("qty_rule").notNull().default("per_job"),
    rimMin: numeric("rim_min", { precision: 4, scale: 1 }),
    rimMax: numeric("rim_max", { precision: 4, scale: 1 }),
    /** NULL=공통 / true=수입 / false=국산 */
    forImported: boolean("for_imported"),

    isTireRelated: boolean("is_tire_related").notNull().default(false),
    /** 기본 체크 상태로 뜬다 — 빼는 건 쉽고 넣는 건 잊는다 (D-11 6번) */
    autoSuggest: boolean("auto_suggest").notNull().default(false),
    isFavorite: boolean("is_favorite").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    check("service_qty_rule", sql`${t.qtyRule} IN ('per_unit','per_2_units','per_job')`),
    index("idx_service_auto").on(t.isTireRelated, t.autoSuggest).where(sql`${t.isActive}`),
  ],
);

/* ============================================================
 * 3-10. price_rule — 할인율 규칙 (D-05)
 * 처음엔 비어 있다. 팔면서 채워진다.
 * 적용 우선순위: item(1) > pattern(2) > brand(3) > category(4) — 좁은 것이 이긴다
 * ========================================================== */
export const priceRule = pgTable(
  "price_rule",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    scope: text("scope").notNull(),
    target: text("target").notNull(),
    /** 매입처별로 다르면 사용 (미확인 사항) */
    supplierCode: text("supplier_code"),
    purchaseDiscountRate: numeric("purchase_discount_rate", { precision: 5, scale: 4 }),
    salesDiscountRate: numeric("sales_discount_rate", { precision: 5, scale: 4 }),
    priority: integer("priority").notNull(),
    updatedBy: bigint("updated_by", { mode: "number" }).references(() => appUser.id),
    updatedAt,
  },
  (t) => [
    check("price_rule_scope", sql`${t.scope} IN ('item','pattern','brand','category')`),
    uniqueIndex("uq_price_rule").on(t.scope, t.target, t.supplierCode),
    index("idx_price_rule_lookup").on(t.scope, t.target),
  ],
);

/* ============================================================
 * 3-11. quote / quote_item — 견적
 * ========================================================== */
export const quote = pgTable(
  "quote",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    quoteNo: text("quote_no").notNull().unique(), // 'Q26-0801-001'
    customerId: bigint("customer_id", { mode: "number" }).references(() => customer.id),
    vehicleId: bigint("vehicle_id", { mode: "number" }).references(() => vehicle.id),

    /**
     * ⭐ 상태가 재고를 움직인다 (2026-08-01 검토 반영)
     *   작성중·제시 → 재고는 그대로. 견적만 받고 간 손님 것을 빼면 안 된다
     *   성사        → 이 순간 재고 차감 + MARS 대기열 등록이 함께 일어난다
     *   취소        → 성사였다면 재고를 되돌린다
     * 정비사가 누르는 것은 [성사] 하나뿐이다. 출고 화면에서 또 스캔하지 않는다.
     */
    status: text("status").notNull().default("작성중"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: bigint("confirmed_by", { mode: "number" }).references(() => appUser.id),

    totalAmount: integer("total_amount").notNull().default(0),

    /**
     * ⭐ 결제 정보 (2026-08-01 검토 반영)
     * MARS 입력 항목은 ①고객 ②업무내용 ③결제정보다 (D-08).
     * 우리가 갖고 있지 않으면 4주차 대기열이 결제 부분을 복사해 줄 수 없다.
     */
    paymentMethod: text("payment_method"), // '현금','카드','계좌이체','외상','혼합'
    paidAmount: integer("paid_amount"),
    paymentMemo: text("payment_memo"),

    // --- MARS 연동 공통 필드 (모든 거래성 테이블 공통) ---
    marsStatus: text("mars_status").notNull().default("미전송"),
    marsSyncedAt: timestamp("mars_synced_at", { withTimezone: true }),
    marsRefNo: text("mars_ref_no"), // MARS 매출주문/송장 번호
    marsMemo: text("mars_memo"),

    createdBy: bigint("created_by", { mode: "number" }).references(() => appUser.id),
    createdAt,
    updatedAt,
  },
  (t) => [
    check("quote_status", sql`${t.status} IN ('작성중','제시','성사','취소')`),
    check(
      "quote_mars_status",
      sql`${t.marsStatus} IN ('미전송','전송완료','보류','해당없음')`,
    ),
    check(
      "quote_payment_method",
      sql`${t.paymentMethod} IS NULL OR ${t.paymentMethod} IN ('현금','카드','계좌이체','외상','혼합')`,
    ),
    /** ⭐ 이 인덱스가 MARS 입력 대기열 화면 그 자체다 */
    index("idx_quote_mars")
      .on(t.marsStatus, t.createdAt)
      .where(sql`${t.marsStatus} = '미전송'`),
    index("idx_quote_vehicle").on(t.vehicleId, t.createdAt),
    index("idx_quote_customer").on(t.customerId, t.createdAt),
  ],
);

export const quoteItem = pgTable(
  "quote_item",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    quoteId: bigint("quote_id", { mode: "number" })
      .notNull()
      .references(() => quote.id, { onDelete: "cascade" }),
    lineType: text("line_type").notNull(),

    productId: bigint("product_id", { mode: "number" }).references(() => product.id),
    serviceItemId: bigint("service_item_id", { mode: "number" }).references(
      () => serviceItem.id,
    ),
    /** 화면 표시용 스냅샷 — 나중에 상품명이 바뀌어도 그때 판 이름이 남는다 */
    description: text("description").notNull(),
    qty: integer("qty").notNull().default(1),

    // --- 계산 과정 전부 보존. 최종가만 남기면 마진 분석을 못 한다 ---
    listPrice: integer("list_price"),
    purchaseDiscountRate: numeric("purchase_discount_rate", { precision: 5, scale: 4 }),
    purchaseCost: integer("purchase_cost"), // owner 전용
    salesDiscountRate: numeric("sales_discount_rate", { precision: 5, scale: 4 }),
    appliedRuleScope: text("applied_rule_scope"), // 'item'|'brand'|'수동입력'
    customerDiscountRate: numeric("customer_discount_rate", { precision: 5, scale: 4 }),
    suggestedPrice: integer("suggested_price"),
    /** ⭐ 실제 판매가 */
    finalPrice: integer("final_price").notNull(),
    margin: integer("margin"), // owner 전용
    adjustedBy: bigint("adjusted_by", { mode: "number" }).references(() => appUser.id),

    createdAt,
  },
  (t) => [
    check("quote_item_line_type", sql`${t.lineType} IN ('tire','service','custom')`),
    index("idx_quote_item_quote").on(t.quoteId),
  ],
);

/* ============================================================
 * 3-12. import_issue — 이관 보정 대기 목록
 * 자동 처리가 안 된 건을 한 화면에 모아 사장님이 정리한다 (약 254건).
 * 이걸 안 만들면 이상 데이터가 그대로 운영에 들어가고 나중엔 못 찾는다.
 * ========================================================== */
export const importIssue = pgTable(
  "import_issue",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** 'spec_parse' | 'plate' | 'dup_customer' | 'maker' | 'dot' | 'stock' */
    kind: text("kind").notNull(),
    refTable: text("ref_table").notNull(),
    refId: bigint("ref_id", { mode: "number" }),
    rawValue: text("raw_value"),
    suggestion: text("suggestion"),
    detail: text("detail"),
    status: text("status").notNull().default("대기"),
    resolvedBy: bigint("resolved_by", { mode: "number" }).references(() => appUser.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    check("import_issue_status", sql`${t.status} IN ('대기','처리','무시')`),
    index("idx_import_issue_open").on(t.kind).where(sql`${t.status} = '대기'`),
  ],
);
