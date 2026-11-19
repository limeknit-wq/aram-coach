// 롤 클라이언트(LCU) 읽기 전용 API: 로딩 화면 단계에서 양 팀 챔피언을 미리 알아내 AI 세팅을 일찍 시작합니다.
// (게임 안 Live Client API는 로딩이 끝나야 열리기 때문)
// 읽기(GET)만 하며, 챔피언 선택·수락 같은 조작은 하지 않습니다.
import https from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { champions } from "./data.js";

const run = promisify(execFile);
const agent = new https.Agent({ rejectUnauthorized: false });
let creds = null, credsAt = 0;

async function getCreds() {
  if (creds && Date.now() - credsAt < 60000) return creds;
  try {
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-Command",
      "(Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | Select-Object -First 1).CommandLine"], { windowsHide: true, timeout: 8000 });
    const port = stdout.match(/--app-port=(\d+)/)?.[1];
    const token = stdout.match(/--remoting-auth-token=([\w-]+)/)?.[1];
    creds = port && token ? { port, auth: "Basic " + Buffer.from(`riot:${token}`).toString("base64") } : null;
  } catch { creds = null; }
  credsAt = Date.now();
  return creds;
}

async function lcuGet(path) {
  const c = await getCreds();
  if (!c) throw new Error("롤 클라이언트가 실행 중이 아님");
  return new Promise((resolve, reject) => {
    const req = https.get({ host: "127.0.0.1", port: c.port, path, agent, headers: { Authorization: c.auth }, timeout: 3000 }, (res) => {
      let b = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (b += d));
      res.on("end", () => { if (res.statusCode !== 200) { if (res.statusCode === 401) creds = null; return reject(new Error(`LCU ${res.statusCode}`)); } try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => { creds = null; reject(e); });
  });
}

/** 게임 구별 키: 10명 챔피언 id(영문) 조합. 로딩 화면(LCU)과 게임 중(Live API) 모두 같은 값이 나옵니다. */
export function keyFromChampionIds(ids) {
  let h = 0;
  for (const ch of ids.slice().sort().join("|")) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `g${(h >>> 0).toString(36)}`;
}

/**
 * 챔피언 선택(픽창) 정보: 내 챔피언, 아군 챔피언(적은 아직 모름). 픽창이 아니면 null.
 * 아수라장은 다시 굴리기·벤치 교체로 챔피언이 바뀔 수 있어, 호출하는 쪽에서 몇 초 안정될 때까지 기다립니다.
 */
export async function champSelect() {
  try {
    const phase = await lcuGet("/lol-gameflow/v1/gameflow-phase");
    if (phase !== "ChampSelect") return null;
    const s = await lcuGet("/lol-champ-select/v1/session");
    const list = await champions();
    const byKey = new Map(list.map((c) => [String(c.key), c]));
    const me = s.myTeam?.find((p) => p.cellId === s.localPlayerCellId);
    const c = me && byKey.get(String(me.championId));
    if (!c) return { phase, me: null, allies: [] };
    return {
      phase,
      me: { champion: c.name, championId: c.id },
      allies: (s.myTeam || []).filter((p) => p !== me).map((p) => byKey.get(String(p.championId))).filter(Boolean).map((x) => ({ champion: x.name, championId: x.id })),
      bench: (s.benchChampions || []).map((b) => byKey.get(String(b.championId))).filter(Boolean).map((x) => x.id),
    };
  } catch { return null; }
}

/**
 * 로딩 화면(또는 게임 중) 정보: 내 챔피언, 아군 4명, 적 5명.
 * 게임 시작 단계가 아니면 null.
 */
export async function loadingGame() {
  try {
    const phase = await lcuGet("/lol-gameflow/v1/gameflow-phase");
    if (!["GameStart", "InProgress"].includes(phase)) return null;
    const [session, me] = await Promise.all([lcuGet("/lol-gameflow/v1/session"), lcuGet("/lol-summoner/v1/current-summoner")]);
    const gd = session?.gameData;
    if (!gd?.teamOne?.length) return null;
    const list = await champions();
    const byKey = new Map(list.map((c) => [String(c.key), c]));
    const toChamp = (p) => byKey.get(String(p.championId));
    const mine = gd.teamOne.some((p) => p.puuid === me.puuid) ? gd.teamOne : gd.teamTwo;
    const theirs = mine === gd.teamOne ? gd.teamTwo : gd.teamOne;
    const meP = mine.find((p) => p.puuid === me.puuid);
    const ids = [...gd.teamOne, ...gd.teamTwo].map((p) => toChamp(p)?.id).filter(Boolean);
    return {
      phase,
      gameMode: gd.queue?.gameMode || null,
      key: ids.length >= 2 ? keyFromChampionIds(ids) : null,
      me: { champion: toChamp(meP)?.name, championId: toChamp(meP)?.id },
      allies: mine.filter((p) => p !== meP).map((p) => ({ champion: toChamp(p)?.name, championId: toChamp(p)?.id })),
      enemies: theirs.map((p) => ({ champion: toChamp(p)?.name, championId: toChamp(p)?.id })),
    };
  } catch { return null; }
}
