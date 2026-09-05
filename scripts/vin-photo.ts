/**
 * 사진에서 차량 정보 읽기 — **매장 PC 에서 돌린다** (2026-09-05, 사장님 제안)
 *
 *   npx tsx scripts/vin-photo.ts --file "C:/…/카드.jpg"   손으로 시험할 때
 *   npx tsx scripts/vin-photo.ts --job 42                 앱의 「사진으로 읽기」가 부르는 길
 *
 * 🔴 **차대번호를 해독하지 않는다.** 17자리에서 차종을 알아내는 것은 불가능하다
 *    (4~9자리가 제작사만 아는 비공개 자료 — 09-04 결론). 대신 **B필러 차량 카드와
 *    자동차등록증에 적힌 차명을 그대로 읽는다** (사장님 지적). 해독을 우회하는 것이다.
 *
 * 🔴 왜 매장 PC 인가: 클로드 **구독**이 이 PC 에만 로그인되어 있다 (API 키는 없다).
 *    구독이라 추가 요금이 없다. 앱은 주문만 남기고 읽는 것은 늘 여기다.
 *
 * 🔴 사진은 읽고 나면 **즉시 지운다** (`vin_scan.image = NULL`). 등록증에는
 *    소유자 이름·주소가 찍히기 때문에 창고에 남기지 않는다.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

/** 🔴 인자는 ASCII 만 (한글 키를 쓰면 CLI 가 깨진다) — ai-cli.ts 의 규칙 그대로 */
const BASE_PROPS = {
  vin: { type: "string", description: "17-character VIN exactly as printed, or empty" },
  carName: { type: "string", description: "model name in Korean as printed (e.g. 쏘렌토), or empty" },
  modelCode: { type: "string", description: "type/model code as printed (e.g. MQ4, CN7), or empty" },
  year: { type: "integer", description: "model year printed on the document, or 0" },
  tireFront: { type: "string", description: "front tire size exactly as printed (e.g. 235/55R19), or empty" },
  tireRear: { type: "string", description: "rear tire size, or empty" },
  psiFront: { type: "number", description: "front tire pressure as printed, with its unit kept in psiUnit" },
  psiRear: { type: "number", description: "rear tire pressure, or 0" },
  unread: { type: "array", items: { type: "string" }, description: "fields you could not read" },
};
const SCHEMA = {
  type: "object",
  properties: { ...BASE_PROPS, source: { type: "string", enum: ["등록증", "차량카드", "기타"] } },
  required: ["source", "unread"],
  additionalProperties: false,
};

/**
 * ⭐ 판매등록 모드 (2026-09-05, 사장님 「사진 세 장」) — 번호판·계기판 사진도 오고,
 *    **차량번호가 조회 열쇠**라 읽어야 한다. 주소·전화는 여전히 금지.
 */
const SALE_SCHEMA = {
  type: "object",
  properties: {
    ...BASE_PROPS,
    plateNo: { type: "string", description: "Korean license plate exactly as printed (e.g. 12가3456), or empty" },
    odoKm: { type: "integer", description: "odometer reading in km if the photo is a dashboard, or 0" },
    ownerName: { type: "string", description: "owner name ONLY if the photo is a vehicle registration doc, or empty" },
    source: { type: "string", enum: ["등록증", "차량카드", "번호판", "계기판", "기타"] },
  },
  required: ["source", "unread"],
  additionalProperties: false,
};

const SYSTEM = `당신은 자동차 서류·라벨을 읽는 사람입니다.
사진 한 장을 보고, 거기 **적혀 있는 글자만** 그대로 옮겨 적습니다.

■ 무엇을 읽나
· 차대번호(17자리) · 차명 · 형식(모델 코드) · 연식
· 타이어 규격(앞/뒤)과 공기압 — 문틀 라벨에 적혀 있으면
· 어느 것을 보고 읽었는지: 등록증 / 차량카드 / 기타

■ 반드시 지킬 것
1. 🔴 **안 보이면 비우세요. 절대 지어내지 마세요.**
   흐릿해서 확신이 없으면 그 칸을 비우고 unread 에 무엇을 못 읽었는지 적으세요.
   틀린 값은 없는 것보다 나쁩니다.
2. 🔴 **소유자 이름·주소·전화번호·차량번호는 읽지도 말고 적지도 마세요.**
   등록증에 보이더라도 그 칸들은 무시하세요.
3. 글자를 고치지 마세요. 적힌 그대로 옮기세요.
   차대번호에 I·O·Q 는 쓰이지 않습니다 — 그렇게 보이면 1·0 입니다.
4. 공기압은 적힌 숫자를 그대로 주세요 (psi 든 kPa 든 바꾸지 마세요).`;

const SALE_SYSTEM = `당신은 타이어 매장의 차량 접수를 돕는 사람입니다.
사진 한 장을 보고 그것이 무엇인지(차량 번호판 / 계기판 / B필러 차량카드 / 자동차등록증)
판단한 뒤, 거기 **적혀 있는 글자만** 그대로 옮겨 적습니다.

■ 사진 종류별로 읽을 것
· 번호판 사진 → plateNo (예: 12가3456, 서울12가3456), source="번호판"
· 계기판 사진 → odoKm (주행 누적거리 km 숫자만. trip A/B 가 아니라 총 주행거리), source="계기판"
· B필러 차량카드 → 차대번호·차명·형식·연식·타이어 규격·공기압, source="차량카드"
· 자동차등록증 → 위 항목들 + 차량번호(plateNo) + 소유자 성명(ownerName), source="등록증"

■ 반드시 지킬 것
1. 🔴 **안 보이면 비우세요. 절대 지어내지 마세요.** 흐릿하면 비우고 unread 에 적으세요.
   틀린 값은 없는 것보다 나쁩니다 — 틀린 번호판은 엉뚱한 손님을 불러옵니다.
2. 🔴 **주소·전화번호는 읽지도 적지도 마세요.** 소유자 이름은 등록증일 때만,
   ownerName 칸에만 적으세요.
3. 글자를 고치지 마세요. 차대번호에 I·O·Q 는 쓰이지 않습니다 — 1·0 입니다.
4. 공기압은 적힌 숫자 그대로 (psi 든 kPa 든 바꾸지 마세요).`;

interface Raw {
  vin?: string;
  carName?: string;
  modelCode?: string;
  year?: number;
  tireFront?: string;
  tireRear?: string;
  psiFront?: number;
  psiRear?: number;
  source?: string;
  unread?: string[];
  /* 판매등록 모드 전용 */
  plateNo?: string;
  odoKm?: number;
  ownerName?: string;
}

type Mode = "제원" | "판매등록";

/**
 * 🔴 **차대번호만 한 번 더 읽어 맞춰 본다** (2026-09-05, 실제로 틀린 것을 보고 넣었다).
 *
 * 흐린 사진에서 `KNAPB8…` 을 `KNAPB6…` 로 읽었는데, 17자리 모양은 맞아서
 * 검사를 **조용히 통과**했다. 한 글자 바뀐 차대번호는 다른 차다 —
 * 그러면 엉뚱한 차의 규격이 나간다. 그래서 두 번 읽어 **다르면 「확실하지 않다」고 말한다.**
 * (틀린 값을 맞다고 내놓는 것보다, 모르겠다고 하는 편이 낫다.)
 */
const VIN_SYSTEM = `당신은 자동차 서류·라벨에서 차대번호만 읽는 사람입니다.
사진에서 17자리 차대번호를 **한 글자씩 또박또박** 읽어 그대로 옮겨 적으세요.

· 차대번호에 I·O·Q 는 쓰이지 않습니다 — 그렇게 보이면 1·0 입니다.
· 8과 B, 0과 D, 5와 S, 2와 Z 를 특히 조심해서 보세요.
· 🔴 확신이 없으면 **비우세요.** 틀린 번호는 없는 것보다 나쁩니다.
· 🔴 소유자 이름·주소·전화번호·차량번호는 읽지 마세요.`;

const VIN_SCHEMA = {
  type: "object",
  properties: { vin: { type: "string", description: "17-character VIN, or empty if unsure" } },
  required: ["vin"],
  additionalProperties: false,
};

/** 사진 한 장을 읽어 온다. 임시 폴더만 열어 주고 끝나면 지운다 */
async function readPhoto(buf: Buffer, ext: string, onLog: (s: string) => void, mode: Mode = "제원") {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const { generateJsonViaCli } = await import("../src/lib/ai-cli");

  const dir = await mkdtemp(path.join(os.tmpdir(), "tyremore-vin-"));
  const name = `card${ext}`;
  await writeFile(path.join(dir, name), buf);
  try {
    /* 라벨 한 장 읽기라 무겁게 갈 이유가 없다 */
    const first = await generateJsonViaCli<Raw>({
      system: mode === "판매등록" ? SALE_SYSTEM : SYSTEM,
      user: `사진 ${name} 을 Read 로 열어 보고, 적혀 있는 차량 정보를 옮겨 적어 주세요.`,
      schema: mode === "판매등록" ? SALE_SCHEMA : SCHEMA,
      model: "sonnet",
      effort: "low",
      timeoutMs: 120_000,
      imageDir: dir,
      onLog,
    });

    /* 차대번호가 나왔으면 그것만 한 번 더 읽어 맞춰 본다 (몇 초면 끝난다) */
    let vinAgreed = true;
    const v1 = (first.data.vin ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (v1) {
      try {
        const second = await generateJsonViaCli<{ vin?: string }>({
          system: VIN_SYSTEM,
          user: `사진 ${name} 을 Read 로 열어 차대번호만 읽어 주세요.`,
          schema: VIN_SCHEMA,
          model: "sonnet",
          effort: "low",
          timeoutMs: 90_000,
          imageDir: dir,
          onLog,
        });
        const v2 = (second.data.vin ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        vinAgreed = v2 === v1;
        if (!vinAgreed) onLog(`두 번 읽은 차대번호가 다릅니다 (${v1} / ${v2})`);
      } catch {
        /* 두 번째가 실패하면 「맞춰 보지 못했다」로 둔다 — 첫 값을 버리지는 않는다 */
        vinAgreed = false;
      }
    }
    return { data: first.data, vinAgreed };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const args = process.argv.slice(2);
  const agent = args.includes("--agent");
  const val = (k: string) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const say = (s: string) => console.log(s);

  /* 🔴 db 를 들여오기 전에 정해야 한다 — 구독으로 부른다 */
  if (!args.includes("--api")) process.env.AI_PROVIDER = "cli";

  const file = val("--file");
  const jobId = val("--job") ? Number(val("--job")) : null;
  /* 손시험용 모드 — 앱 주문은 payload 의 mode 를 쓴다 */
  const cliMode: Mode = val("--mode") === "판매등록" ? "판매등록" : "제원";

  /* ── 손으로 시험하는 길: 파일 하나를 그대로 읽어 본다 ── */
  if (file) {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const { cleanRead, crossCheck } = await import("../src/lib/vin-photo-core");
    const buf = await readFile(file);
    let r: Awaited<ReturnType<typeof readPhoto>>;
    try {
      r = await readPhoto(buf, path.extname(file).toLowerCase() || ".jpg", say, cliMode);
    } catch (e) {
      say(`❌ ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
      return;
    }
    say(`\n── 모델이 읽은 것(날것) ──\n${JSON.stringify(r.data, null, 2)}`);
    const clean = cleanRead(r.data, new Date(), cliMode);
    say(`\n── 검사를 통과한 것 ──\n${JSON.stringify(clean, null, 2)}`);
    const warn = crossCheck(clean, r.vinAgreed);
    if (warn.length) say(`\n⚠️ ${warn.join("\n⚠️ ")}`);
    return;
  }

  if (!jobId) {
    const msg = "무엇을 읽을지 알려 주세요 (--file <사진> 또는 --job 42)";
    say(agent ? `ERROR=${msg}` : `❌ ${msg}`);
    process.exitCode = 1;
    return;
  }

  /* ── 앱이 부르는 길 ── */
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  let scanId: number | null = null;
  try {
    const [job] = await sql<{ payload: unknown }[]>`
      SELECT payload FROM blog_job WHERE id = ${jobId}`;
    /* 🔴 글자로 한 겹 싸여 오는 경우도 받아 낸다 — 예전에 그렇게 들어간 줄이 있다 */
    let payload = job?.payload as { scanId?: number; mode?: string } | string | null;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload) as { scanId?: number; mode?: string };
      } catch {
        payload = null;
      }
    }
    const p = payload as { scanId?: number; mode?: string } | null;
    scanId = Number(p?.scanId ?? 0) || null;
    /* ⭐ 읽기 용도 (2026-09-05) — 판매등록 주문이면 번호판·계기판·소유자 이름까지 읽는다 */
    const jobMode: Mode = p?.mode === "판매등록" ? "판매등록" : "제원";
    if (!scanId) {
      say(agent ? "ERROR=어느 사진인지 알 수 없습니다" : "❌ 어느 사진인지 알 수 없습니다");
      process.exitCode = 1;
      return;
    }

    const [row] = await sql<{ image: string | null }[]>`
      SELECT image FROM vin_scan WHERE id = ${scanId}`;
    if (!row?.image) {
      await sql`UPDATE vin_scan SET status='실패', error='사진이 없습니다', finished_at=now() WHERE id=${scanId}`;
      say(agent ? "ERROR=사진이 없습니다" : "❌ 사진이 없습니다");
      process.exitCode = 1;
      return;
    }
    await sql`UPDATE vin_scan SET status='실행중' WHERE id=${scanId}`;

    /* dataURL 이면 앞머리를 떼고, 확장자를 알아낸다 */
    const m = row.image.match(/^data:image\/([a-z]+);base64,(.*)$/is);
    const ext = m ? `.${m[1] === "jpeg" ? "jpg" : m[1]}` : ".jpg";
    const b64 = m ? m[2] : row.image;
    const buf = Buffer.from(b64, "base64");
    say(`사진 ${Math.round(buf.length / 1024)}KB 를 읽습니다`);

    const { cleanRead, crossCheck } = await import("../src/lib/vin-photo-core");
    let r: Awaited<ReturnType<typeof readPhoto>>;
    try {
      r = await readPhoto(buf, ext, say, jobMode);
    } catch (e) {
      /* 🔴 실패해도 사진은 지운다 — 창고에 남기지 않는다 */
      const msg = e instanceof Error ? e.message : String(e);
      await sql`
        UPDATE vin_scan SET status='실패', error=${msg}, image=NULL, finished_at=now()
        WHERE id=${scanId}`;
      say(agent ? `ERROR=${msg}` : `❌ ${msg}`);
      process.exitCode = 1;
      return;
    }
    const clean = cleanRead(r.data, new Date(), jobMode);
    const warn = crossCheck(clean, r.vinAgreed);
    const result = { ...clean, warn, vinAgreed: r.vinAgreed };

    /**
     * 🔴 결과를 적고 **사진을 그 자리에서 지운다.** 등록증에는 소유자 이름·주소가
     *    찍히므로 창고에 남기지 않는다.
     */
    await sql`
      UPDATE vin_scan
      SET status='완료', result=${sql.json(result)}, image=NULL, error=NULL, finished_at=now()
      WHERE id=${scanId}`;

    const got = [clean.plateNo && "차량번호", clean.odoKm && "주행거리", clean.vin && "차대번호", clean.carName && "차명", clean.modelCode && "형식", clean.year && "연식", clean.tireFront && "타이어"]
      .filter(Boolean)
      .join("·");
    say(`읽었습니다 — ${got || "읽어낸 것이 없습니다"}${clean.dropped.length ? ` (버린 값 ${clean.dropped.length}개)` : ""}`);
  } finally {
    await sql.end();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (process.argv.includes("--agent")) console.log(`ERROR=${msg.split("\n")[0]}`);
    console.error(e);
    process.exit(1);
  });
