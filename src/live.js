// 롤 클라이언트의 Live Client Data API (게임 중 PC에서만 열림, 읽기 전용)
// https://developer.riotgames.com/docs/lol#game-client-api
import https from "node:https";
import { champions, damageProfile, itemById, norm } from "./data.js";
import { keyFromChampionIds, loadingGame } from "./lcu.js";
import { fakeLive, test } from "./testmode.js";

const PORT = process.env.LOL_LIVE_PORT || 2999;
const agent = new https.Agent({ rejectUnauthorized: false }); // 클라이언트가 자체 서명 인증서를 씀

function getLive(path) {
  if (test.active) return fakeLive(path); // 게임 없이 테스트하는 중
  return new Promise((resolve, reject) => {
    const req = https.get({ host: "127.0.0.1", port: PORT, path, agent, timeout: 3000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`라이브 API ${res.statusCode}: ${body.slice(0, 200)}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

const STAT_KEYS = {
  FlatPhysicalDamageMod: "ad", FlatMagicDamageMod: "ap", FlatArmorMod: "armor",
  FlatSpellBlockMod: "mr", FlatHPPoolMod: "hp", PercentAttackSpeedMod: "attackSpeed",
  FlatCritChanceMod: "crit", PercentLifeStealMod: "lifesteal",
};

async function playerView(p) {
  const champs = await champions();
  const c = champs.find((x) => norm(x.name) === norm(p.championName) || norm(x.id) === norm(p.rawChampionName?.split("_").pop()));
  const its = [];
  const statSum = {};
  for (const i of p.items || []) {
    const data = await itemById(i.itemID);
    // completed: 완성 아이템(상위 아이템 없음, 900골드 이상) 또는 2단계 신발 → 아이템 칸이 다 찼는지 판단에 씀
    const completed = Boolean(data && (data.gold?.total ?? 0) >= 900 && (!data.into?.length || data.tags?.includes("Boots")));
    its.push({ id: i.itemID, name: i.displayName, gold: data?.gold?.total, count: i.count > 1 ? i.count : undefined, slot: i.slot, completed });
    for (const [k, v] of Object.entries(data?.stats || {})) {
      const key = STAT_KEYS[k];
      if (key) statSum[key] = Math.round(((statSum[key] || 0) + v * (i.count || 1)) * 100) / 100;
    }
  }
  return {
    name: p.riotIdGameName || p.summonerName,
    champion: p.championName,
    championId: c?.id,
    tags: c?.tags,
    baseDamage: c ? damageProfile(c).type : undefined,
    level: p.level,
    kda: `${p.scores?.kills}/${p.scores?.deaths}/${p.scores?.assists}`,
    dead: p.isDead || undefined,
    respawnIn: p.isDead ? Math.round(p.respawnTimer) : undefined,
    items: its,
    itemGold: its.reduce((s, x) => s + (x.gold || 0) * (x.count || 1), 0),
    itemStats: statSum,
    summonerSpells: [p.summonerSpells?.summonerSpellOne?.displayName, p.summonerSpells?.summonerSpellTwo?.displayName].filter(Boolean),
    keystone: p.runes?.keystone?.displayName,
  };
}

function teamThreat(players) {
  // 적 팀이 실제로 어떤 피해·방어 쪽으로 성장했는지 아이템 기준으로 집계
  const sum = (k) => players.reduce((s, p) => s + (p.itemStats[k] || 0), 0);
  const ad = sum("ad"), ap = sum("ap");
  const baseAP = players.filter((p) => p.baseDamage === "AP").length;
  const baseAD = players.filter((p) => p.baseDamage === "AD").length;
  return {
    championDamageTypes: { AD: baseAD, AP: baseAP, 혼합: players.length - baseAD - baseAP },
    itemTotals: { ad, ap, armor: sum("armor"), mr: sum("mr"), hp: sum("hp"), crit: sum("crit") },
    leaningDamage: ap + baseAP * 40 > ad + baseAD * 40 ? "마법 피해 위주" : "물리 피해 위주",
    tanks: players.filter((p) => p.tags?.includes("Tank") || (p.itemStats.hp || 0) >= 1000).map((p) => p.champion),
    fed: players.filter((p) => Number(p.kda.split("/")[0]) >= 8).map((p) => `${p.champion}(${p.kda})`),
  };
}

/** 지금 게임을 구별하는 키(10명의 이름 조합). 게임이 없으면 null. */
export async function currentGameKey() {
  try {
    const list = await getLive("/liveclientdata/playerlist");
    // rawChampionName = "game_character_displayname_Quinn" → "Quinn" (클라이언트 언어와 무관)
    const ids = list.map((p) => String(p.rawChampionName || p.championName).split("_").pop());
    return keyFromChampionIds(ids);
  } catch { return null; }
}

export async function liveGame(memory) {
  let all;
  try {
    all = await getLive("/liveclientdata/allgamedata");
  } catch (e) {
    // 로딩 화면이면 롤 클라이언트(LCU)에서 조합만 먼저 가져옵니다 (아이템·골드는 아직 없음)
    const loading = await loadingGame();
    if (loading?.me?.champion) {
      return {
        inGame: false, loadingScreen: true,
        message: "로딩 화면입니다. 조합만 확인됐고 아이템·골드·이벤트는 아직 없습니다. 조합 기준으로 세팅하세요.",
        me: loading.me, allies: loading.allies, enemies: loading.enemies, gameMode: loading.gameMode, memory,
      };
    }
    return {
      inGame: false,
      message:
        "진행 중인 게임을 찾지 못했습니다(게임이 로딩 중이거나 이 PC에서 롤이 실행 중이 아님). " +
        "사용자에게 내 챔피언, 아군 4명, 적 5명을 직접 알려달라고 요청하세요.",
      error: String(e.message || e),
      memory,
    };
  }
  const meName = all.activePlayer?.riotId || all.activePlayer?.summonerName;
  const players = await Promise.all(all.allPlayers.map(async (p) => ({ team: p.team, riot: p.riotId || p.summonerName, v: await playerView(p) })));
  const me = players.find((p) => p.riot === meName) || players[0];
  const allies = players.filter((p) => p.team === me.team && p !== me).map((p) => p.v);
  const enemies = players.filter((p) => p.team !== me.team).map((p) => p.v);
  const a = all.activePlayer;
  const events = (all.events?.Events || []).filter((e) => ["ChampionKill", "Multikill", "Ace", "TurretKilled", "InhibKilled"].includes(e.EventName));
  return {
    inGame: true,
    gameMode: all.gameData?.gameMode,
    gameVersion: all.gameData?.gameVersion,
    gameTime: `${Math.floor(all.gameData.gameTime / 60)}분 ${Math.floor(all.gameData.gameTime % 60)}초`,
    me: {
      ...me.v,
      currentGold: Math.floor(a.currentGold),
      stats: a.championStats && {
        ad: Math.round(a.championStats.attackDamage), ap: Math.round(a.championStats.abilityPower),
        armor: Math.round(a.championStats.armor), mr: Math.round(a.championStats.magicResist),
        hp: Math.round(a.championStats.maxHealth), abilityHaste: Math.round(a.championStats.abilityHaste),
        attackSpeed: Math.round(a.championStats.attackSpeed * 100) / 100, crit: a.championStats.critChance,
        moveSpeed: Math.round(a.championStats.moveSpeed),
      },
      runes: a.fullRunes && { keystone: a.fullRunes.keystone?.displayName, primary: a.fullRunes.primaryRuneTree?.displayName, secondary: a.fullRunes.secondaryRuneTree?.displayName },
    },
    allies,
    enemies,
    enemyAnalysis: teamThreat(enemies),
    allyAnalysis: teamThreat(allies.concat(me.v)),
    score: {
      ourKills: players.filter((p) => p.team === me.team).reduce((s, p) => s + Number(p.v.kda.split("/")[0]), 0),
      enemyKills: enemies.reduce((s, p) => s + Number(p.kda.split("/")[0]), 0),
    },
    recentEvents: events.slice(-8).map((e) => ({ t: Math.round(e.EventTime), e: e.EventName, killer: e.KillerName, victim: e.VictimName })),
    note: "증강 선택지는 라이브 API에 나오지 않습니다. 사용자가 알려준 증강 이름은 find_augments 로 조회하세요.",
    memory,
  };
}
