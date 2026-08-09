/**
 * ⭐ MARS 차량 제조사 목록 (사장님 제보 2026-08-09)
 *
 *   "제조사의 경우 MARS 의 데이터베이스의 목록에 포함되지 않으면 입력이 되지 않는 것을 확인."
 *
 * MARS 차량 카드의 「제조사」는 자유 입력이 아니라 **이 목록에서 고르는 칸**이다.
 * 목록 밖 이름으로 차량을 만들려 하면 MARS 등록이 실패한다.
 * 원본: 사장님이 MARS 에서 수출한 「차량 제조사」 엑셀 (2026-08-09, 180개).
 * 철자 그대로 둔다 — 「CITROÔN」「Repl Car」 같은 것도 MARS 에 실제로 그렇게 있다.
 *
 * 한글 이름을 앞에 둔다 — 현대·기아 손님이 대부분이다.
 */
export const MARS_MAKERS: readonly string[] = [
  // ── 한글 ──
  "현대", "현대자동차", "기아", "기아자동차", "제네시스", "쌍용", "KG모빌리티", "KG모빌리티(쌍용)",
  "르노삼성", "르노코리아", "르노 (삼성) 코리아", "르노", "한국GM", "쉐보레", "시보레", "벤츠",
  "기타", "닛산", "다이하쓰", "닷지", "도요타", "동풍자동차", "란치아", "람보르기니", "랜드로버",
  "렉서스", "로버", "로터스", "롤스로이스", "링컨", "마세라티", "마스타", "마이바흐", "마쯔다",
  "맥라렌", "머큐리", "미니", "미쯔비시", "미쯔오카", "벤틀리", "볼보", "부가티", "뷰익", "사브",
  "사이언", "새턴", "선롱버스", "스마트", "스바루", "스즈키", "스카니아", "스파이커", "시트로엥",
  "아우디", "알파로메오", "어울림모터스", "어큐라", "에스턴마틴", "오펠", "올스모빌", "이베코",
  "이스즈", "인피니티", "재규어", "중한자동차", "지프", "캐딜락", "코닉세그", "크라이슬러",
  "타타대우", "테슬라", "파가니", "팬더", "페라리", "포드", "포르쉐", "포톤", "폭스바겐", "폰티악",
  "폴스타", "푸조", "피아트", "허머", "혼다", "히노",
  // ── 영문 ──
  "ABARTH", "ALFA ROMEO", "ALPINA", "ALPINE", "AMT", "ARO", "AUDI", "AUSTIN", "AUTOBIANCHI",
  "BARKAS", "BEDFORD", "BENTLEY", "BERTONE", "BMW", "BORGWARD", "BUGATTI", "CADILLAC", "CHEVROLET",
  "CHRYSLER", "CITROEN\\PEUGEOT", "CITROÔN", "DACIA", "DAEWOO", "DAF", "DAIHATSU", "DAIMLER", "DS",
  "FERRARI", "FIAT", "FORD", "FORD USA", "FSO", "GIGANT", "GLAS", "GMC", "HENDRICKSON", "HITACHI",
  "HONDA", "HYUNDAI", "INFINITI", "INNOCENTI", "JAGUAR", "JEEP", "KIA", "KUBOTA", "LADA",
  "LAMBORGHINI", "LANCIA", "LAND ROVER", "LDV", "LEXUS", "LINCOLN", "MAN", "MASERATI", "MASTA",
  "MAZDA", "MERCEDES-BENZ", "MERITOR", "MINI", "MITSUBISHI", "MOSKVICH", "NIIGATA", "NISSAN", "NSU",
  "OPEL", "PEUGEOT", "PIAGGIO", "Polestar", "PORSCHE", "PROTON", "RENAULT", "Repl Car",
  "ROLLS-ROYCE", "SAAB", "SEAT", "SEMISYSCO", "SKODA", "SMART", "SMB", "STA", "SUBARU", "SUZUKI",
  "TALBOT", "TESLA", "TOYOTA", "TRABANT", "TRAILOR", "TRIUMPH", "VAUXHALL", "VOGELE", "VOLKSWAGEN",
  "VOLVO", "VW", "WARTBURG", "ZASTAVA",
];

/** 목록에 있는 이름인가 — 앞뒤 공백만 눈감아 준다 (철자는 MARS 그대로여야 한다) */
export function isMarsMaker(name: string): boolean {
  const n = name.trim();
  return n !== "" && MARS_MAKERS.includes(n);
}

/** 잘못 친 이름과 비슷한 후보 — 오류 안내에 붙여 준다 */
export function makerSuggestions(input: string, max = 4): string[] {
  const n = input.trim().toLowerCase();
  if (!n) return [];
  return MARS_MAKERS.filter((m) => m.toLowerCase().includes(n)).slice(0, max);
}

export const MARS_MAKER_LIST_ID = "mars-makers";

/** 제조사 입력칸 옆에 한 번 렌더하면 브라우저가 치는 대로 목록을 걸러 보여준다 */
export function MarsMakerDatalist() {
  return (
    <datalist id={MARS_MAKER_LIST_ID}>
      {MARS_MAKERS.map((m) => (
        <option key={m} value={m} />
      ))}
    </datalist>
  );
}
