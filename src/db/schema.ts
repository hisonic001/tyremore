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
  date,
  index,
  integer,
  jsonb,
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
 * 3-1b. app_setting — 키-값 설정 (2026-08-10)
 * MARS 평가 리포트의 정비사 열람 허용(mars_report_tech)과
 * 분기별 미쉐린 타겟 수량(mars_target_2026Q3 …)을 담는다.
 * ========================================================== */
export const appSetting = pgTable("app_setting", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt,
});

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
  /**
   * ⭐ MARS 「단가1」이 VAT를 뺀 값인가 (사장님 확인 2026-08-01)
   * 미쉐린은 VAT 미포함이라 화면에 그대로 띄우면 고객에게 낮은 금액을 말하게 된다.
   * true면 1회 이관 때 자동으로 1.1을 곱해 `list_price`에 넣었다.
   * ⚠️ 이관은 끝났다 (2026-08-04). 지금은 「안 받는 것 숨기기」 화면에서 사람이 켜고 끈다.
   */
  priceExcludesVat: boolean("price_excludes_vat").notNull().default(false),
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
    /** 원문 보존 — 규격 파서를 나중에 고쳐 다시 돌릴 수 있어야 한다. MARS 입력의 기준 */
    rawName: text("raw_name").notNull(),
    /**
     * ⭐ 사장님이 정한 화면 표시 이름 (2026-08-01)
     * MARS 원문에는 `PILSP3`, `PRIM MXM4`, `P SPT CUP2` 같은 축약이 섞여 있어
     * 자동으로는 펼 수 없다. 값이 있으면 이것을 우선 표시한다.
     * ⚠️ `raw_name`·`pattern` 은 그대로 둔다 — MARS 입력은 원문으로 해야 한다 (D-08)
     */
    displayName: text("display_name"),

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
    /**
     * ⭐ OE 마킹 — 어느 차 순정인가 (2026-08-01)
     * MARS 상품명에 마킹이 빠진 것이 많아(4,152건 중 약 200건만 표기) 이름만으로는 못 채운다.
     * 콤마로 구분해 담는다: 'MO,GRNX'
     */
    oeMarks: text("oe_marks"),
    /**
     * ⭐ 사람이 고친 세부사항 (2026-08-01)
     *
     * 계절·런플랫·흡음재·SUV·OE마킹은 상품명에서 자동으로 판정한다.
     * 그런데 MARS 이름이 축약·누락투성이라 **틀린 것이 많다**.
     * 사장님이 고친 값을 여기 남겨 두고, **판정 규칙을 고쳐 다시 돌릴 때 덮어씌운다**
     * (`scripts/backfill-attrs.ts`). 안 그러면 규칙을 손볼 때마다 애써 고친 것이 날아간다.
     *   { "season": "겨울", "isRunflat": true, "oeMarks": "MO" }
     *
     * ⚠️ 원래는 「MARS 재이관 뒤에 다시 씌운다」는 뜻이었다. 재이관은 없다 (2026-08-04) —
     *    이제는 **자동 판정을 다시 돌릴 때**를 위한 장치다. 쓰임은 같고 이유만 바뀌었다.
     */
    attrsOverride: jsonb("attrs_override"),

    // --- 부품 전용 (타이어는 NULL) ---
    partNo: text("part_no"), // 'MBA-039','SM188'
    /** ⭐ 적용 차종 — 부품 검색의 전부 */
    fitment: text("fitment"),
    position: text("position"), // '앞' | '뒤'

    category: text("category"),
    /** ⭐ 재주문점 (2026-08-11 부품 재고관리) — 이 수량 이하면 「부족」. NULL = 알림 안 함 */
    minQty: integer("min_qty"),
    /** 제조사 바코드. SKU 단위라 같은 상품 4본은 값이 전부 같다 (D-02) */
    barcode: text("barcode"),
    /**
     * ⭐ 기표가 — 화면에 띄우고 견적 계산에 쓰는 값. **VAT 포함** (2026-08-01)
     * 고객에게 말하는 금액이므로 세금이 들어 있어야 한다.
     */
    listPrice: integer("list_price"),
    /**
     * MARS 「단가1」 원본 (VAT 미포함).
     * 원가·마진 계산에 이쪽이 필요하다. 거래처 상품목록을 올리면 함께 갱신된다.
     */
    listPriceExcl: integer("list_price_excl"),
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
 * product_barcode — 실제로 찍히는 바코드 ⭐ (2026-08-01)
 *
 * 🔴 MARS 의 `barcode` 컬럼은 **실제 라벨 바코드가 아니다.** 품번을 복사해 놓은 값이다.
 *    한국타이어  DB `HK1033085`  ←→  실제 라벨 `8808563590301` (EAN-13)
 *    미쉐린      DB `441358`     ←→  실제 라벨 `441358261D590A`
 *    미쉐린만 앞자리가 우연히 맞아 동작했을 뿐이다.
 *
 * 브랜드마다 체계가 다르고 미리 다 알 수 없다.
 * → **찍으면서 채운다.** 못 찾은 바코드는 그 자리에서 상품과 이어 주면
 *   다음부터 자동으로 인식된다 (D-05·D-02 와 같은 철학).
 * ========================================================== */
export const productBarcode = pgTable(
  "product_barcode",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** 스캔된 문자열, 또는 그 앞부분 */
    code: text("code").notNull(),
    productId: bigint("product_id", { mode: "number" })
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    /**
     * 'exact'  — 이 값이 통째로 그 상품 (EAN-13 처럼 상품마다 고정)
     * 'prefix' — 이 값으로 시작하면 그 상품 (미쉐린처럼 뒤에 개별번호가 붙는 경우)
     */
    kind: text("kind").notNull().default("exact"),
    memo: text("memo"),
    createdBy: bigint("created_by", { mode: "number" }).references(() => appUser.id),
    createdAt,
  },
  (t) => [
    check("product_barcode_kind", sql`${t.kind} IN ('exact','prefix')`),
    uniqueIndex("uq_product_barcode").on(t.code),
    index("idx_product_barcode_product").on(t.productId),
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
    /**
     * ⭐ 라벨 바코드의 개별 식별자 (2026-08-01)
     * 미쉐린 라벨 `441358261D590A` 의 뒤 8자리 `261D590A`.
     * D-02 는 "바코드가 SKU 단위라 개별 본을 구분 못 한다"고 봤는데,
     * 라벨 바코드에는 본마다 다른 값이 들어 있어 **한 본을 물리적으로 특정**할 수 있다.
     * 보관 서비스(2개월차)에서 스티커를 대신할 수 있다.
     */
    serial: text("serial"),
    purchasePrice: integer("purchase_price"),
    /**
     * ⭐ 이 본이 어느 매입 줄에서 왔는지 (2026-08-09, 매입 내역 수정·지우기).
     *    입고를 되돌릴 때 정확히 이 줄의 본만 지울 수 있다. 예전 재고는 비어 있다.
     */
    purchaseItemId: bigint("purchase_item_id", { mode: "number" }),
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
    /** ⭐ MARS 고객 생성 필수 항목 (2026-08-02) */
    address: text("address"),

    /**
     * ⭐ 개인정보 동의 — 종이 「차량 점검 및 주문 보고서」에서 손님이 고르고 서명한 것
     *
     * 🔴 **프로그램이 대신 정하지 않는다.** 손님이 종이에 표시한 그대로 옮겨 적을 뿐이다.
     *    MARS 고객 등록 화면에는 동의 체크와 「고객 서명」 칸이 있는데,
     *    서명받지 않은 것을 「수락된 동의」로 넣으면 안 된다.
     *
     * MARS 로 옮길 때:
     *   비즈니스 목적의 동의        ← consent_privacy (필수 동의)
     *   제3자 제공 및 국외 이전 동의  ← consent_privacy (필수 동의문에 포함돼 있다)
     *   마케팅 및 광고 목적의 동의   ← consent_marketing (선택)
     */
    consentPrivacy: boolean("consent_privacy"),
    consentMarketing: boolean("consent_marketing"),
    michelinMember: boolean("michelin_member"),
    /** 종이에 서명받은 시각. 비어 있으면 MARS 고객 생성을 하지 않는다 */
    consentSignedAt: timestamp("consent_signed_at", { withTimezone: true }),

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
    /** MARS 「제조사」 칸에 그대로 치는 글자. 코드로 못 맞추는 이름이 많다 */
    makerName: text("maker_name"),
    model: text("model"),
    year: integer("year"),

    /**
     * ⭐ MARS 차량 등록 필수 항목 (2026-08-02)
     * MARS 는 영문으로 받는다 — Fuel(가솔린) · Diesel · Hybrid · BEV(전기) · LPG
     */
    fuelType: text("fuel_type"),
    /** 종이 보고서의 「차량 형태」 — 승용 / SUV / 소형트럭 / 밴·소형버스 / 기타 */
    bodyType: text("body_type"),
    /** 차대번호 */
    vin: text("vin"),

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

    /**
     * ⭐ 실제로 정비한 날 (사장님 지시 2026-08-02)
     *
     *   "입력은 오늘 해도 실제 정비는 이전에 했을 수도 있음.
     *    default 값은 오늘이지만 app 에서 입력받을 때 수정도 가능하도록 해야 함"
     *
     * MARS 매출 주문의 **문서 날짜·완료 일자**에 그대로 들어간다.
     * 등록한 날(created_at)과 다를 수 있으므로 따로 둔다.
     */
    workDate: date("work_date"),
    /**
     * ⭐ 판매 등록 때 입력한 주행거리 (사장님 요청 2026-08-08 — "정비내역 카드에서 차량 키로수도").
     *    차량 카드의 최신값과 달리 「그때 몇 km 였나」가 남는다. 과거 건은 NULL.
     */
    mileage: integer("mileage"),
    confirmedBy: bigint("confirmed_by", { mode: "number" }).references(() => appUser.id),

    totalAmount: integer("total_amount").notNull().default(0),

    /**
     * ⭐ 결제 정보 (2026-08-01 검토 반영)
     * MARS 입력 항목은 ①고객 ②업무내용 ③결제정보다 (D-08).
     * 우리가 갖고 있지 않으면 4주차 대기열이 결제 부분을 복사해 줄 수 없다.
     */
    paymentMethod: text("payment_method"), // '현금','카드','계좌이체','외상','혼합','서비스'(무상)
    paidAmount: integer("paid_amount"),
    paymentMemo: text("payment_memo"),

    // --- MARS 연동 공통 필드 (모든 거래성 테이블 공통) ---
    marsStatus: text("mars_status").notNull().default("미전송"),
    marsSyncedAt: timestamp("mars_synced_at", { withTimezone: true }),
    marsRefNo: text("mars_ref_no"), // MARS 송장(SI) 번호 — 주문 번호는 아래 marsOrderNo 로 (2026-08-18)
    /**
     * ⭐ MARS 매출 주문(SO) 번호 (2026-08-18 근본 개선 단계2).
     *    주문을 만들자마자 기록한다 — 중간에 죽어도 초안 번호가 남아,
     *    재시도가 새 주문을 또 만들지 않고 그 초안을 이어서 쓴다.
     */
    marsOrderNo: text("mars_order_no"),
    marsMemo: text("mars_memo"),

    /**
     * ⭐ 거래처 판매의 거래처 이름 (2026-08-17)
     *
     * 전에는 `mars_memo` 에 「거래처 금호」 글자로만 남았다. 그런데 그 칸은 MARS
     * 기능들이 덮어쓴다 — markEntered·holdMars 는 통째로 대체하고,
     * marsMismatchNote 는 「거래처 금호 · 수정됨 …」으로 이어붙인다.
     * 거래처 이름이 날아가거나, 외상 장부에서 한 거래처가 둘로 갈렸다.
     *
     * ⚠️ supplier 표에 외래키로 안 묶는다 — purchase_invoice.supplier 와 같은 이유
     *    (옛 기록이 갈라진다). 대신 거래처 이름을 고치면 여기도 같이 고친다
     *    (src/lib/supplier.ts updateSupplier).
     */
    supplierName: text("supplier_name"),

    /**
     * ⭐ 전기 후 차량 점검을 제출한 시각 (2026-08-02)
     *
     * 사장님: "이것도 꼭 해야 하는 작업이야."
     * 전기가 끝나야 들어갈 수 있는 화면이라 매출 주문 입력과 **별개 단계**다.
     * 비어 있으면 아직 안 한 것이다.
     *
     * 필수 항목 5개 (사장님 확인): 타이어 · 브레이크 패드(디스크 제외) ·
     * 얼라인먼트 · 배터리 · 엔진오일
     */
    vehicleCheckAt: timestamp("vehicle_check_at", { withTimezone: true }),

    /**
     * ⭐ 어느 바퀴를 갈았는지 (사장님 요청 2026-08-05) — 판매 등록의 체크박스로 받는다.
     *    「전륜 좌측,전륜 우측」처럼 쉼표로 잇는다. 비어 있으면 점검표는
     *    본수로 짐작한다(1본=앞왼쪽, 2본=앞, 4본=전부 — wheelsFor).
     */
    tyrePositions: text("tyre_positions"),

    createdBy: bigint("created_by", { mode: "number" }).references(() => appUser.id),
    createdAt,
    updatedAt,
  },
  (t) => [
    check("quote_status", sql`${t.status} IN ('작성중','제시','성사','취소')`),
    check(
      "quote_mars_status",
      // 수동처리 = 대기열에서 빼고 MARS 에 직접 넣는 것 (2026-08-05)
      // 해당없음 = MARS 에 아예 안 가는 판매 — 거래처 판매 (2026-08-05)
      sql`${t.marsStatus} IN ('미전송','전송완료','보류','해당없음','수동처리')`,
    ),
    check(
      "quote_payment_method",
      // 서비스 = 무상 (사장님 요청 2026-08-07 — 단골 무상 점검·가벼운 서비스). MARS 에 안 간다
      // 지역화폐 (사장님 요청 2026-08-10) — MARS 에는 현금으로 들어간다
      // 혼합 = 결제수단 2개 이상 — 수단별 금액은 quote_payment 에 (2026-08-10)
      sql`${t.paymentMethod} IS NULL OR ${t.paymentMethod} IN ('현금','카드','계좌이체','지역화폐','외상','혼합','서비스')`,
    ),
    /** ⭐ 이 인덱스가 MARS 입력 대기열 화면 그 자체다 */
    index("idx_quote_mars")
      .on(t.marsStatus, t.createdAt)
      .where(sql`${t.marsStatus} = '미전송'`),
    index("idx_quote_vehicle").on(t.vehicleId, t.createdAt),
    index("idx_quote_customer").on(t.customerId, t.createdAt),
    // 외상 장부가 거래처별로 묶어 볼 때 쓴다 (2026-08-17)
    index("idx_quote_supplier").on(t.supplierName).where(sql`${t.supplierName} IS NOT NULL`),
  ],
);

/* ============================================================
 * quote_payment — 분할 결제 (사장님 요청 2026-08-10)
 * "결제시 결제수단을 1개 이상 고르게 할 수 있으며 동시에 반영가능하게"
 * 결제수단 2개 이상이면 수단별 금액이 여기 한 줄씩. 합은 quote.total_amount 와
 * 같아야 한다(saveSale 이 검증). 그때 quote.payment_method = '혼합'.
 * 1개짜리 결제는 이 표를 안 쓴다 — quote.payment_method 하나로 끝.
 * ========================================================== */
export const quotePayment = pgTable(
  "quote_payment",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    quoteId: bigint("quote_id", { mode: "number" })
      .notNull()
      .references(() => quote.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    amount: integer("amount").notNull(),
    createdAt,
  },
  (t) => [
    check("quote_payment_method_check", sql`${t.method} IN ('현금','카드','계좌이체','지역화폐')`),
    // 마이너스 허용 — 카드 취소·환불 (사장님 요청 2026-08-21, scripts/add-negative-payment.ts). 0 만 막는다
    check("quote_payment_amount_check", sql`${t.amount} <> 0`),
    index("idx_quote_payment_quote").on(t.quoteId),
  ],
);

/* ============================================================
 * receivable_payment — 외상 수금 (사장님 선택 2026-08-11)
 * 외상 판매(quote.payment_method='외상')의 수금 기록.
 * 잔액 = quote.total_amount − SUM(amount) 파생값 — 별도 잔액 컬럼 없음.
 * ========================================================== */
export const receivablePayment = pgTable(
  "receivable_payment",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    quoteId: bigint("quote_id", { mode: "number" })
      .notNull()
      .references(() => quote.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    method: text("method").notNull(),
    paidOn: date("paid_on")
      .notNull()
      .default(sql`(now() AT TIME ZONE 'Asia/Seoul')::date`),
    memo: text("memo"),
    createdAt,
  },
  (t) => [
    check("receivable_payment_amount_check", sql`${t.amount} > 0`),
    check("receivable_payment_method_check", sql`${t.method} IN ('현금','카드','계좌이체','지역화폐')`),
    index("idx_receivable_quote").on(t.quoteId),
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
    /**
     * ⭐ 줄별 메모 (사장님 지시 2026-08-07) — MARS 자동 입력이 **이 줄의 「설명 2」**에 넣는다.
     *    전에는 판매 전체 메모(quote.payment_memo) 하나를 첫 줄 설명 2 에 넣었는데,
     *    이제 결제 메모는 우리 기록용으로만 남고 MARS 에는 안 들어간다.
     */
    memo: text("memo"),
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
    // 'use' = 정비에 쓴 부품 소모 — 0원 줄, 재고만 차감, MARS 제외 (2026-08-11)
    check("quote_item_line_type", sql`${t.lineType} IN ('tire','service','custom','use')`),
    index("idx_quote_item_quote").on(t.quoteId),
  ],
);

/* ============================================================
 * supplier — 거래처 (2026-08-03)
 *
 * 사장님 요청: "설정에 거래처 추가 수정 삭제가 가능한 기능도 추가해줘"
 *
 * 그동안 거래처는 `purchase_invoice.supplier` 에 **글자로만** 있었다.
 * 그래서 아직 거래한 적 없는 곳은 미리 넣어 둘 수 없었고,
 * 「쌍성」·「쌍성 타이어」처럼 갈라진 이름을 합칠 방법도 없었다.
 *
 * ⚠️ `purchase_invoice.supplier` 는 글자 그대로 둔다. 외래키로 묶으면 옛 인보이스 때문에
 *    거래처를 손대기가 어려워진다. 대신 **이름을 바꾸면 인보이스도 같이 바꾼다**
 *    (`renameSupplier`) — 매입 내역이 갈라지지 않게.
 * ========================================================== */
export const supplier = pgTable(
  "supplier",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: text("name").notNull(),
    /**
     * 공백·대소문자를 지운 이름. 「쌍성 타이어」와 「쌍성타이어」가 따로 생기는 것을
     * DB 차원에서 막는다 — 화면 경고만으로는 언젠가 뚫린다.
     */
    nameKey: text("name_key").notNull(),
    phone: text("phone"),
    memo: text("memo"),
    /** 거래를 끊은 곳. 지우지 않고 숨긴다 — 옛 매입 내역이 남아 있다 */
    isActive: boolean("is_active").notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [uniqueIndex("uq_supplier_key").on(t.nameKey)],
);

/* ============================================================
 * supplier_item_code — 거래처가 쓰는 품번 ⭐ (2026-08-04)
 *
 * 사장님이 금호 「자재검색」 목록을 주시면서 드러난 문제:
 *
 *   같은 타이어인데 **품번이 곳마다 다르다.**
 *     금호 자재코드   2387392
 *     우리(MARS) 품번  KM2284552
 *   인보이스에는 금호 코드가 찍혀 나오니 우리 상품을 못 찾는다.
 *   → "이미 있는데도 못 알아본다" (사장님 지적 2026-08-03)
 *
 * 🔴 **`product.mars_item_no` 를 고치지 않는다.** 그건 MARS 입력의 기준이라
 *    바꾸면 D-08(원문 보존)이 깨지고 MARS 로 넘길 때 품번이 틀어진다.
 *    대신 「이 거래처는 이 상품을 이렇게 부른다」를 옆에 적어 둔다.
 *
 * ⚠️ 상품이 지워지면 같이 지운다 — 가리키는 곳이 없는 사전은 쓰레기다.
 *    거래처는 글자로 둔다 (`supplier` 테이블과 같은 이유 — 옛 자료가 묶여 버린다).
 * ========================================================== */
export const supplierItemCode = pgTable(
  "supplier_item_code",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** '금호' · '미쉐린' · '콘티넨탈' */
    supplier: text("supplier").notNull(),
    /** 그 거래처의 품번 (금호 자재코드 `2387392`) */
    code: text("code").notNull(),
    productId: bigint("product_id", { mode: "number" })
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    /** 거래처가 부르는 이름 그대로 — 나중에 사람이 확인할 때 근거가 된다 */
    supplierName: text("supplier_name"),
    /** 어떻게 이어졌나 — '품번' | '규격+패턴' | '손으로' */
    matchedBy: text("matched_by"),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("uq_supplier_item_code").on(t.supplier, t.code),
    index("idx_supplier_item_product").on(t.productId),
  ],
);

/* ============================================================
 * mars_run — MARS 자동 입력 실행 요청 ⭐ (사장님 요청 2026-08-04)
 *
 *   "MARS에 자동으로 입력하는 방법이 npm 으로 시작하는 콘솔 명령어라는 점이
 *    불편함. 웹페이지에 버튼이라도 따로 있었으면 좋겠음."
 *
 * 🔴 웹서버(Vercel)는 MARS 를 **직접 조작할 수 없다.** MARS 로그인과 크롬
 *    프로필이 사장님 PC 에 있고, 자격증명은 PC 밖으로 내보내지 않는다 (D-08).
 *    그래서 버튼은 여기에 **요청만 남기고**, PC 에서 도는 mars-agent 가
 *    받아서 mars-fill 을 돌린 뒤 진행 로그를 되쓴다. 화면은 그걸 보여준다.
 * ========================================================== */
export const marsRun = pgTable(
  "mars_run",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** '입력' = 매출 주문 자동 입력 · '점검' = 전기 후 차량 점검 */
    kind: text("kind").notNull().default("입력"),
    status: text("status").notNull().default("대기"),
    /** 실행 화면에 그대로 보여주는 진행 로그 */
    log: text("log"),
    requestedBy: bigint("requested_by", { mode: "number" }).references(() => appUser.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    // 자가점검 = 아침 화면 구조 확인 (2026-08-10 — 자동입력 개선 전략)
    check("mars_run_kind", sql`${t.kind} IN ('입력','점검','자가점검','대사')`),
    check("mars_run_status", sql`${t.status} IN ('대기','실행중','완료','실패')`),
    index("idx_mars_run_open").on(t.status).where(sql`${t.status} IN ('대기','실행중')`),
  ],
);

/* ============================================================
 * mars_attempt — MARS 입력 시도별 단계 이력 ⭐ (2026-08-18 근본 개선 단계2)
 *
 * 판매 1건 = 8단계 파이프라인인데 어디까지 갔는지 DB 에 안 남아
 * 재시도가 항상 처음부터였다. 시도마다 한 줄 — 단계가 나아갈 때마다 갱신.
 * 상태 기계(quote.mars_status)와 별개의 **부가 기록**이다 — 전이는 여전히
 * markEntered/holdMars/queueForMars 만 한다.
 * ========================================================== */
export const marsAttempt = pgTable(
  "mars_attempt",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    quoteId: bigint("quote_id", { mode: "number" })
      .notNull()
      .references(() => quote.id, { onDelete: "cascade" }),
    marsRunId: bigint("mars_run_id", { mode: "number" }),
    /** 시작→고객확인→고객생성→차량생성→주문생성→줄입력→합계검증→전기→송장확인→점검→완료 */
    stage: text("stage").notNull().default("시작"),
    orderNo: text("order_no"),
    invoiceNo: text("invoice_no"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("idx_mars_attempt_quote").on(t.quoteId, t.id.desc())],
);

/* ============================================================
 * purchase_invoice — 매입 인보이스 (2026-08-01)
 *
 * 발주해서 출고된 물건의 명세다. 실물이 오기 전에 미리 등록해 두고,
 * 도착해서 스캔하면 재고로 확정된다.
 *
 * ⭐ 인보이스에는 재고보다 값진 것이 있다 — **매입 할인율과 실매입가**.
 *    D-05에서 "매입 할인율은 쓰면서 채운다"고 했는데, 채우는 것조차 자동이 된다.
 * ========================================================== */
export const purchaseInvoice = pgTable(
  "purchase_invoice",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    supplier: text("supplier").notNull(), // '미쉐린'
    /** 발행번호 — 같은 인보이스를 두 번 올리는 것을 막는다 */
    invoiceNo: text("invoice_no").notNull().unique(),
    orderNo: text("order_no"),
    issuedAt: text("issued_at"), // '2026-07-31'
    totalQty: integer("total_qty"),
    subtotal: integer("subtotal"), // VAT 미포함
    vat: integer("vat"),
    total: integer("total"),
    /**
     * '입고대기' — 올렸지만 실물이 아직 안 왔다
     * '부분입고' — 일부만 도착
     * '입고완료' — 전부 도착
     * '취소'
     */
    status: text("status").notNull().default("입고대기"),
    fileName: text("file_name"),
    /** 원문 — 나중에 파서를 고쳐 다시 읽을 수 있어야 한다 (엑셀 원본 보존과 같은 이유) */
    rawText: text("raw_text"),
    createdBy: bigint("created_by", { mode: "number" }).references(() => appUser.id),
    createdAt,
    updatedAt,
  },
  (t) => [
    check("invoice_status", sql`${t.status} IN ('입고대기','부분입고','입고완료','취소')`),
    index("idx_invoice_open").on(t.status, t.issuedAt).where(sql`${t.status} <> '입고완료'`),
  ],
);

export const purchaseInvoiceItem = pgTable(
  "purchase_invoice_item",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    invoiceId: bigint("invoice_id", { mode: "number" })
      .notNull()
      .references(() => purchaseInvoice.id, { onDelete: "cascade" }),
    /** 미쉐린 CAI = MARS 품번. 이것으로 상품과 잇는다 */
    cai: text("cai").notNull(),
    productId: bigint("product_id", { mode: "number" }).references(() => product.id),
    /** 인보이스에 적힌 그대로 — 상품을 못 찾아도 무엇인지는 남는다 */
    description: text("description").notNull(),
    qty: integer("qty").notNull(),
    /** ⭐ 실제로 도착해 확정한 수량 */
    receivedQty: integer("received_qty").notNull().default(0),
    /**
     * ⭐ 담을 때 적어 두는 DOT (사장님 요청 2026-08-08 — 직접담기에서 DOT 다른
     *    물건을 줄로 나눠 담기). 전량 입고가 이 값을 재고에 그대로 박는다.
     */
    dot: text("dot"),
    /**
     * ⭐ 입고 확정을 누른 순간 (사장님 지시 2026-08-08).
     *    "전량입고 혹은 입고확정 버튼을 누르는 때가 입고가 되는 순간이며 …
     *     입고 되는 순간을 기점으로 입고 날짜와 입고 내역을 기록해줘."
     *    매입 내역은 이 시각 기준으로 묶인다 — 발행일·업로드일이 아니라.
     */
    receivedAt: timestamp("received_at", { withTimezone: true }),
    unitListPrice: integer("unit_list_price"), // 기준단가 (VAT 미포함)
    discountRate: numeric("discount_rate", { precision: 5, scale: 4 }), // 0.3800
    supplyAmount: integer("supply_amount"), // 공급가액
    /** 본당 실매입가 = 공급가액 ÷ 수량 */
    unitCost: integer("unit_cost"),
    createdAt,
  },
  (t) => [
    check("invoice_item_qty", sql`${t.qty} > 0`),
    check("invoice_item_received", sql`${t.receivedQty} >= 0`),
    index("idx_invoice_item_invoice").on(t.invoiceId),
    index("idx_invoice_item_cai").on(t.cai),
    /** 입고 화면에서 "아직 안 온 것" 을 찾는다 */
    index("idx_invoice_item_pending").on(t.productId).where(sql`${t.receivedQty} < ${t.qty}`),
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

/* ============================================================
 * 3-13. 돈 관리 (ERP 1단계, 사장님 승인 2026-08-24)
 * fin_upload — 업로드 배치(원본 CSV 보존) · cash_txn — 자금 움직임
 * (법인카드 사용 + 통장 입출금). 실제 생성은 scripts/add-fin-tables.ts.
 * 세금계산서·카드매출 표는 ERP 2~3단계에서 추가된다.
 * ========================================================== */
export const finUpload = pgTable(
  "fin_upload",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    source: text("source").notNull(),
    accountLabel: text("account_label"),
    fileName: text("file_name").notNull(),
    /** 원본 시트 CSV — 파서를 고쳐 다시 읽을 수 있게 (purchase_invoice.raw_text 전례) */
    rawText: text("raw_text").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    newCount: integer("new_count").notNull().default(0),
    dupCount: integer("dup_count").notNull().default(0),
    periodFrom: date("period_from"),
    periodTo: date("period_to"),
    status: text("status").notNull().default("반영"),
    createdBy: bigint("created_by", { mode: "number" }).references(() => appUser.id),
    createdAt,
  },
  (t) => [
    check(
      "fin_upload_source",
      sql`${t.source} IN ('홈택스매출','홈택스매입','법인카드','통장','카드매출승인','카드매출입금','토스포스')`,
    ),
    check("fin_upload_status", sql`${t.status} IN ('반영','취소')`),
  ],
);

export const cashTxn = pgTable(
  "cash_txn",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** '법인카드'(사용 = 지출) | '통장'(입출금) */
    source: text("source").notNull(),
    accountLabel: text("account_label").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /** 가맹점명 / 「[적요] 내용」 원문 보존 */
    description: text("description").notNull(),
    inAmount: integer("in_amount").notNull().default(0),
    outAmount: integer("out_amount").notNull().default(0),
    /** 통장만 — 거래 후 잔액 (중복 방지 열쇠의 핵심) */
    balance: bigint("balance", { mode: "number" }),
    approvalNo: text("approval_no"),
    /** 가맹점 사업자번호 (KB 확인서에 있음 — 매입 대조용) */
    bizNo: text("biz_no"),
    installment: text("installment"),
    branch: text("branch"),
    /** 통장 입금인코드 — 카드 정산 식별용 */
    payerCode: text("payer_code"),
    dedupKey: text("dedup_key").notNull(),
    /** 경비 분류 (ERP 6단계에서 쓴다) */
    category: text("category"),
    reconStatus: text("recon_status").notNull().default("미대조"),
    isActive: boolean("is_active").notNull().default(true),
    uploadId: bigint("upload_id", { mode: "number" }).references(() => finUpload.id),
    memo: text("memo"),
    createdAt,
  },
  (t) => [
    uniqueIndex("cash_txn_dedup_key_key").on(t.dedupKey),
    check("cash_txn_source", sql`${t.source} IN ('법인카드','통장')`),
    check("cash_txn_recon", sql`${t.reconStatus} IN ('미대조','제안','확정','무시')`),
    index("idx_cash_txn_month").on(t.source, t.occurredAt).where(sql`${t.isActive}`),
  ],
);

/* ============================================================
 * 3-14. 돈 관리 — 세금계산서·대조 (ERP 2단계, 2026-08-24)
 * tax_invoice — 홈택스 전자세금계산서 목록, recon_match — 외부 자료 ↔ 앱 기록 연결.
 * 실제 생성은 scripts/add-tax-invoice.ts · add-recon-match.ts.
 * ⚠️ supplier.biz_no 컬럼도 add-tax-invoice.ts 가 더한다 (여기 supplier 정의에는
 *    아직 없음 — 접근은 전부 raw SQL. 다음 스키마 정리 때 정의에 흡수).
 * ========================================================== */
export const taxInvoice = pgTable(
  "tax_invoice",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** '매출' | '매입' */
    direction: text("direction").notNull(),
    /** 국세청 승인번호 — 재업로드 중복 방지의 전부 */
    approvalNo: text("approval_no").notNull(),
    writeDate: date("write_date").notNull(),
    issueDate: date("issue_date"),
    /** 상대방 사업자번호 (숫자만; 매입=공급자, 매출=공급받는자) */
    counterpartyBizNo: text("counterparty_biz_no").notNull(),
    counterpartyName: text("counterparty_name").notNull(),
    supplyAmount: integer("supply_amount").notNull(),
    vat: integer("vat").notNull().default(0),
    total: integer("total").notNull(),
    itemSummary: text("item_summary"),
    reconStatus: text("recon_status").notNull().default("미대조"),
    isActive: boolean("is_active").notNull().default(true),
    uploadId: bigint("upload_id", { mode: "number" }).references(() => finUpload.id),
    memo: text("memo"),
    createdAt,
  },
  (t) => [
    uniqueIndex("tax_invoice_approval_no_key").on(t.approvalNo),
    check("tax_invoice_direction", sql`${t.direction} IN ('매출','매입')`),
    check("tax_invoice_recon", sql`${t.reconStatus} IN ('미대조','제안','확정','무시')`),
    index("idx_tax_invoice_biz").on(t.counterpartyBizNo),
  ],
);

export const reconMatch = pgTable(
  "recon_match",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** '매입계산서'|'매출계산서'|'이체입금'|'카드정산입금'|'카드승인'|'매입지급'|'포스결제' */
    kind: text("kind").notNull(),
    /** FK 없는 범용 참조 (import_issue 전례) — 확정 액션이 코드로 검증 */
    srcTable: text("src_table").notNull(),
    srcId: bigint("src_id", { mode: "number" }).notNull(),
    refTable: text("ref_table").notNull(),
    refId: bigint("ref_id", { mode: "number" }).notNull(),
    /** 이 연결에 배분된 금액 (월합계 계산서 1:N 대비) */
    amount: integer("amount").notNull(),
    status: text("status").notNull().default("제안"),
    confidence: text("confidence"),
    method: text("method").notNull().default("자동"),
    confirmedBy: bigint("confirmed_by", { mode: "number" }).references(() => appUser.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    check("recon_match_kind", sql`${t.kind} IN ('매입계산서','매출계산서','이체입금','카드정산입금','카드승인','매입지급','포스결제')`),
    check("recon_match_status", sql`${t.status} IN ('제안','확정')`),
    index("idx_recon_src").on(t.srcTable, t.srcId),
    index("idx_recon_ref").on(t.refTable, t.refId),
  ],
);

/* ============================================================
 * 3-15. 돈 관리 — 카드 매출 (ERP 3단계, 2026-08-24)
 * 🔴 여신금융협회 실파일이 합계 형식이라 표도 합계 단위다:
 *    card_day 일별 승인·취소 합계 / card_deposit 월별·카드사별 정산.
 * 실제 생성은 scripts/add-card-sales.ts. 재업로드는 덮어쓰기(최신이 정답).
 * ========================================================== */
export const cardDay = pgTable(
  "card_day",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    day: date("day").notNull(),
    totalAmount: integer("total_amount").notNull(),
    totalCnt: integer("total_cnt").notNull().default(0),
    approvedAmount: integer("approved_amount").notNull().default(0),
    approvedCnt: integer("approved_cnt").notNull().default(0),
    /** 파일 그대로 — 취소는 음수 */
    cancelledAmount: integer("cancelled_amount").notNull().default(0),
    cancelledCnt: integer("cancelled_cnt").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    uploadId: bigint("upload_id", { mode: "number" }).references(() => finUpload.id),
    createdAt,
  },
  (t) => [uniqueIndex("card_day_day_key").on(t.day)],
);

export const cardDeposit = pgTable(
  "card_deposit",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** 'YYYY-MM' (매출월) */
    month: text("month").notNull(),
    cardCo: text("card_co").notNull(),
    saleCnt: integer("sale_cnt").notNull().default(0),
    saleAmount: integer("sale_amount").notNull(),
    /** 부가세 대리납부 — 수수료 = 매출 − 대리납부 − 입금 */
    vatAgency: integer("vat_agency").notNull().default(0),
    depositAmount: integer("deposit_amount").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    uploadId: bigint("upload_id", { mode: "number" }).references(() => finUpload.id),
    createdAt,
  },
  (t) => [uniqueIndex("card_deposit_month_card_co_key").on(t.month, t.cardCo)],
);

/* ============================================================
 * 3-16. party_alias — 이름 별명 사전 (사장님 요청 2026-08-24)
 * 계산서 상호·통장 입금자명이 앱 이름과 달라도, 한 번 이어주면 기억한다.
 * 실제 생성은 scripts/add-party-alias.ts.
 * ========================================================== */
export const partyAlias = pgTable(
  "party_alias",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** 정규화된 외부 이름 (공백·㈜ 등 제거, 소문자) — normName(recon-data) 규칙 */
    aliasKey: text("alias_key").notNull(),
    aliasRaw: text("alias_raw").notNull(),
    /** 'S:미쉐린' (거래처) · 'C:123' (고객) */
    partyKey: text("party_key").notNull(),
    partyLabel: text("party_label").notNull(),
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("party_alias_alias_key_key").on(t.aliasKey)],
);
