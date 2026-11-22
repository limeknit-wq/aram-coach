// 게임 없이 테스트하는 모드.
// - 롤 Live Client API 대신 가짜 게임 상태(챔피언·골드·아이템·죽음)를 돌려줍니다 → AI 세팅·템 추천·다시 세팅이 실제로 돌아감
// - 가짜 게임 창(overlay.cs 의 TestGameForm)이 이 상태의 증강 카드를 실제 게임과 같은 위치에 그립니다
//   → 화면 감시(OCR)·오버레이·카드 클릭 기록이 실제 게임과 똑같이 동작
import { augments, champions, itemById } from "./data.js";

export const TEST_TITLE = "아수라장 코치 테스트 게임";

export const test = {
  active: false,
  startedAt: 0,
  me: "Pantheon",
  allies: ["Lux", "Malphite", "Sona", "Darius"],
  enemies: ["Rammus", "Taric", "TahmKench", "Hecarim", "Tryndamere"],
  gold: 1400,
  level: 3,
  items: [], // [{ id, slot }]
  dead: false,
  deadAt: 0,
  cards: [], // 지금 화면의 증강 이름
  showCards: false,
  offerNo: 0,
  rarity: "실버",
};

const RARITY_ORDER = ["실버", "골드", "프리즘"];

async function pool(rarity) {
  const { augments: list } = await augments();
  // 카드에 그리기 좋은 것만: 이름이 있고 너무 길지 않은 것
  return list.filter((a) => a.rarity === rarity && a.name && a.name.length <= 12 && !/[?]/.test(a.name) && a.desc);
}
const pickRandom = (arr, n, not = []) => {
  const c = arr.filter((a) => !not.includes(a.name));
  const out = [];
  while (out.length < n && c.length) out.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]);
  return out;
};

async function newOffer() {
  test.rarity = RARITY_ORDER[test.offerNo % 3];
  test.offerNo++;
  test.cards = pickRandom(await pool(test.rarity), 3).map((a) => a.name);
  test.showCards = true;
}

/** 테스트 조작. 반환: 바뀐 상태 */
export async function testAction(what, arg) {
  switch (what) {
    case "start":
      Object.assign(test, { active: true, startedAt: Date.now(), gold: 1400, level: 3, items: [], dead: false, offerNo: 0 });
      await newOffer(); // 실제 게임처럼 시작하자마자 첫 증강
      break;
    case "end":
      Object.assign(test, { active: false, showCards: false, cards: [] });
      break;
    case "offer": await newOffer(); break;
    case "reroll": {
      const i = Number(arg);
      if (!test.showCards || !(i >= 0 && i < test.cards.length)) break;
      const [a] = pickRandom(await pool(test.rarity), 1, test.cards);
      if (a) test.cards[i] = a.name;
      break;
    }
    case "hide": test.showCards = false; break; // 카드를 고르면 선택 화면이 닫힘
    case "dead":
      test.dead = !test.dead; test.deadAt = Date.now();
      break;
    case "gold": test.gold += Number(arg) || 1000; break;
    case "buy": {
      const it = await itemById(arg);
      if (!it) break;
      const used = new Set(test.items.map((x) => x.slot));
      let slot = 0; while (used.has(slot) && slot < 6) slot++;
      if (slot >= 6) break;
      test.items.push({ id: String(it.id), slot });
      test.gold = Math.max(0, test.gold - (it.gold?.total || 0));
      break;
    }
    case "clearItems": test.items = []; break;
  }
  return testState();
}

export function testState() {
  return { active: test.active, title: TEST_TITLE, cards: test.cards, showCards: test.showCards, gold: test.gold, dead: test.dead, items: test.items, rarity: test.rarity, offerNo: test.offerNo };
}

/** 증강 설명(카드에 그릴 글) */
export async function cardDetails() {
  const { augments: list } = await augments();
  return test.cards.map((n) => {
    const a = list.find((x) => x.name === n);
    return { name: n, desc: (a?.desc || "").replace(/\s+/g, " ").replace(/\?/g, "").slice(0, 70), tags: a?.tags || [] };
  });
}

// ---------- 가짜 Live Client API 응답 ----------
async function player(id, team, i, isMe) {
  const c = (await champions()).find((x) => x.id === id);
  const items = [];
  if (isMe) for (const it of test.items) { const d = await itemById(it.id); items.push({ itemID: Number(it.id), displayName: d?.name || it.id, slot: it.slot, count: 1 }); }
  const respawn = isMe && test.dead ? Math.max(0, 15 - (Date.now() - test.deadAt) / 1000) : 0;
  return {
    championName: c?.name || id,
    rawChampionName: `game_character_displayname_${id}`,
    riotId: isMe ? "테스트#TEST" : `${team}${i}#TEST`,
    summonerName: isMe ? "테스트" : `${team}${i}`,
    team, level: test.level, isDead: isMe ? test.dead : false, respawnTimer: respawn,
    scores: { kills: 0, deaths: 0, assists: 0 },
    items,
    summonerSpells: { summonerSpellOne: { displayName: "점멸" }, summonerSpellTwo: { displayName: "표식" } },
  };
}

export async function fakeLive(path) {
  if (!test.active) throw new Error("테스트 꺼짐");
  const order = [test.me, ...test.allies], chaos = test.enemies;
  const players = [
    ...(await Promise.all(order.map((id, i) => player(id, "ORDER", i, i === 0)))),
    ...(await Promise.all(chaos.map((id, i) => player(id, "CHAOS", i, false)))),
  ];
  if (path.startsWith("/liveclientdata/playerlist")) return players;
  if (path.startsWith("/liveclientdata/allgamedata")) {
    return {
      activePlayer: { riotId: "테스트#TEST", summonerName: "테스트", currentGold: test.gold, level: test.level, championStats: { attackDamage: 80, abilityPower: 0, armor: 40, magicResist: 32, maxHealth: 900, abilityHaste: 0, attackSpeed: 0.64, critChance: 0, moveSpeed: 345 } },
      allPlayers: players,
      events: { Events: [] },
      gameData: { gameMode: "ARAM", gameTime: (Date.now() - test.startedAt) / 1000 },
    };
  }
  throw new Error("테스트: 지원하지 않는 경로 " + path);
}
