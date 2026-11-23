import { wikiDescriptions, wikiCredit } from "./augwiki.js";

export const CD = "https://raw.communitydragon.org/latest";

const RARITY = { kSilver: "실버", kGold: "골드", kPrismatic: "프리즘" };

function clean(s) {
  return String(s || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/%i:[a-zA-Z]+%/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function resolveVars(text, values) {
  // @Var@, @Var*100@, @spell.Name:Var*100@ 형태 치환. 값이 없으면 '?' 로 둡니다.
  return text.replace(/@([^@\s]+)@/g, (_, expr) => {
    const m = expr.match(/^(?:spell\.[^:]+:)?([A-Za-z0-9_]+)(?:\*([\d.]+))?$/);
    if (!m) return "?";
    const key = Object.keys(values || {}).find((k) => k.toLowerCase() === m[1].toLowerCase());
    const v = values?.[key];
    if (v == null) return "?";
    const num = (Array.isArray(v) ? v[1] ?? v[0] : v) * (m[2] ? Number(m[2]) : 1);
    return Number.isFinite(num) ? String(Math.round(num * 100) / 100) : "?";
  });
}

// 고정 수치로만 구성된 계산식을 해석하고 레벨·상태 의존식은 보류합니다.
function spellValues(spell) {
  const values = { ...spell?.dataValues };
  for (const row of spell?.mDataValues || []) {
    if (row.mName && Array.isArray(row.mValues)) values[row.mName] ??= row.mValues;
  }
  for (const [name, calc] of Object.entries(spell?.mSpellCalculations || {})) {
    if (calc.mMultiplier || calc.__type !== "GameCalculation" || !calc.mFormulaParts?.length) continue;
    const parts = calc.mFormulaParts.map((part) => {
      if (part.__type === "NumberCalculationPart") return part.mNumber;
      if (part.__type === "NamedDataValueCalculationPart") {
        const v = values[part.mDataValue];
        return Array.isArray(v) && new Set(v.slice(1)).size === 1 ? v[1] : typeof v === "number" ? v : undefined;
      }
    });
    if (parts.every(Number.isFinite)) values[name] ??= parts.reduce((a, b) => a + b, 0);
  }
  return values;
}

export async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

export async function buildGameData(LANG = "ko_kr", load = getJson, wiki = wikiDescriptions) {
  const [cherryEn, lists, cherry, arena, strings] = await Promise.all([
    load(`${CD}/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json`), // 영문 이름 (영어 클라이언트 화면 인식용)
    load(`${CD}/plugins/rcp-be-lol-game-data/global/${LANG}/v1/augment-lists.json`),
    load(`${CD}/plugins/rcp-be-lol-game-data/global/${LANG}/v1/cherry-augments.json`),
    load(`${CD}/cdragon/arena/${LANG}.json`),
    load(`${CD}/game/${LANG}/data/menu/en_us/lol.stringtable.json`),
  ]);

  const st = strings.entries || strings;
  const stKeys = Object.keys(st);
  // KIWI = 아수라장, KIWI_JADE = 아수라장의 다른 증강 풀(어느 쪽이 라이브인지 패치마다 다를 수 있어 합칩니다)
  const kiwiLists = lists.filter((l) => /^KIWI/.test(l.modeName));
  if (!kiwiLists.length) throw new Error("augment-lists.json 에 KIWI(증강 칼바람) 목록이 없습니다.");
  const pools = new Map();
  for (const l of kiwiLists) for (const p of l.augmentList) pools.set(p, [...(pools.get(p) || []), l.modeName]);
  const kiwi = { augmentList: [...pools.keys()] };

  const cherryByName = new Map(cherry.map((a) => [a.augmentNameId.toLowerCase(), a]));
  const enByName = new Map(cherryEn.map((a) => [a.augmentNameId.toLowerCase(), a.nameTRA?.trim()]));
  const arenaByName = new Map(arena.augments.map((a) => [a.apiName.toLowerCase(), a]));

  function descCandidates(base) {
    const direct = [
      `kiwi_${base}_tooltip`, `kiwi_aram_${base}_tooltip`, `kiwi_augment_${base}_tooltip`,
      `kiwi_${base}_summary`, `kiwi_aram_${base}_summary`, `kiwi_augment_${base}_description`,
      `augment_${base}_tooltip`, `augment_${base}_summary`, `cherry_${base}_tooltip`,
      `cherry_aram_${base}_tooltip`, `cherry_${base}_summary`, `${base}_tooltip`, `${base}_description`,
    ].filter((k) => st[k]);
    if (direct.length) return direct;
    // 느슨한 탐색: 키에 이름이 포함되고 설명류 접미사를 가진 것
    return stKeys.filter(
      (k) => k.includes(base) && /(tooltip|summary|description|_desc)$/.test(k) && !/(max|buffbar|milestone|bark|quest_finished)/.test(k)
    );
  }

  // "{{Kiwi_GlassCannon_Summary}}" 처럼 다른 문자열을 참조하는 부분을 펼칩니다.
  function expandRefs(text, depth = 0) {
    if (depth > 3) return text;
    return String(text || "").replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (m, key) => {
      const v = st[key.toLowerCase()];
      return v ? expandRefs(v, depth + 1) : "";
    });
  }

  // 여러 후보 중 '실제 효과 설명'에 가까운 문장을 고릅니다 (값 누락 '?' 가 적고, 진행 수치 표시줄이 아닌 것).
  function bestDesc(keys, values) {
    let best = "", bestScore = -Infinity;
    for (const k of keys) {
      const text = clean(resolveVars(expandRefs(st[k]), values));
      if (!text) continue;
      const q = (text.match(/\?/g) || []).length;
      const statLine = /^[^\n.]{0,15}:\s*\?/.test(text) ? 200 : 0; // "입힌 피해량: ?" 같은 표시줄
      const score = Math.min(text.length, 300) - q * 25 - statLine + (k.startsWith("kiwi") ? 20 : 0);
      if (score > bestScore) { bestScore = score; best = text; }
    }
    return best;
  }

  const out = [];
  let described = 0;
  for (const path of kiwi.augmentList) {
    const apiName = path.split("/").pop();
    const c = cherryByName.get(apiName.toLowerCase());
    const base = apiName.toLowerCase().replace(/^aram_/, "");
    const ar = arenaByName.get(apiName.toLowerCase()) || arenaByName.get(base);
    const values = spellValues(ar);
    let desc = bestDesc(descCandidates(base), values);
    const arDesc = clean(resolveVars(ar?.desc || ar?.tooltip || "", values));
    if (arDesc && (!desc || (desc.match(/\?/g) || []).length > (arDesc.match(/\?/g) || []).length)) desc = arDesc;
    desc = desc.replace(/\{\{[^}]*\}\}/g, "").trim();
    if (desc) described++;
    out.push({
      id: c?.id ?? null,
      apiName,
      name: c?.nameTRA?.trim() || ar?.name?.trim() || apiName,
      nameEn: enByName.get(apiName.toLowerCase()) || undefined,
      rarity: RARITY[c?.rarity] || c?.rarity || "알 수 없음",
      tags: (c?.augmentDisplayTags || []).map((t) => t.replace(/^k/, "")),
      pools: pools.get(path),
      // 아이콘: CommunityDragon 경로 (UI에서 사용)
      icon: c?.augmentLargeIconPath
        ? `${CD}/plugins/rcp-be-lol-game-data/global/default/${c.augmentLargeIconPath.replace(/^\/lol-game-data\/assets\//i, "").toLowerCase()}`
        : undefined,
      desc,
    });
  }

  // ---------- 귀빈(Guest of Honor) 이벤트: 판마다 하나씩 붙는 특수 규칙 ----------
  // 게임 데이터(kiwi.bin)의 이벤트 정의에서 제목/설명 문자열 키를 읽어 한글로 바꿉니다.
  const kiwiBin = await load(`${CD}/game/maps/modespecificdata/kiwi.bin.json`);
  const events = [];
  for (const v of Object.values(kiwiBin)) {
    const tra = v?.DefaultTra;
    if (!tra?.title || !/^Kiwi_GoH_/i.test(tra.title)) continue;
    const id = tra.title.replace(/^Kiwi_GoH_|_Title$/gi, "");
    const name = st[tra.title.toLowerCase()];
    if (!name) continue; // 문자열이 없는 이벤트는 아직 미출시로 보고 제외
    const short = clean(expandRefs(st[String(tra["{bff2f361}"] || "").toLowerCase()]));
    const long = clean(expandRefs(st[String(tra["{3b7aa707}"] || "").toLowerCase()])).replace(/%i:[a-zA-Z]+%/g, "");
    const ev = { id, name: name.trim(), short, desc: long };
    if (/heartsteel/i.test(id)) {
      // 멤버별 스티커 효과
      ev.stickers = stKeys
        .filter((k) => /^kiwi_goh_heartsteel_?augmentmodifier_[a-z]+_description$/.test(k))
        .map((k) => clean(st[k]).replace(/%i:[a-zA-Z]+%/g, ""));
    }
    events.push(ev);
  }
  const incomplete = out.filter(a => a.nameEn && (!a.desc || a.desc.includes("?")));
  if (incomplete.length) {
    const descriptions = await wiki().catch(() => new Map());
    for (const a of incomplete) {
      const text = descriptions.get(a.nameEn.toLowerCase());
      if (text) a.wikiDesc = text;
    }
  }
  return { wikiCredit, mode: "KIWI (증강 칼바람 / ARAM: Mayhem)", lang: LANG, builtAt: new Date().toISOString(), augments: out, events };
}
