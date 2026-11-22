#!/usr/bin/env node
// 증강 칼바람 도우미 MCP 서버.
// 판단(추천)은 연결한 사용자의 Claude/ChatGPT가 하고, 이 서버는 데이터와 실시간 게임 상황만 줍니다.
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  championDetail, championSummary, events, findAugments, findChampion, findEvent, findItem,
  itemSummary, searchAugments, searchItems, version,
} from "./data.js";
import { liveGame } from "./live.js";
import { registerUi } from "./ui.js";
import { latestFrame, offerImage, state as watch } from "./watcher.js";
import { coord, shareEvent, startCoordinator } from "./coord.js";
import { addPick, loadPicks, loadPlan, resetPicks, savePlan, scoreOffer } from "./plan.js";

function offerSummary() {
  const o = watch.offer;
  if (!o) return null;
  return { names: o.names, heartsteelStickers: o.stickers, secondsAgo: Math.round((Date.now() - o.at) / 1000), lastSeenSecondsAgo: Math.round((Date.now() - o.lastSeenAt) / 1000) };
}

const INSTRUCTIONS = `당신은 리그 오브 레전드 '증강 칼바람(ARAM: Mayhem)' 코치입니다.
이 서버는 데이터만 제공합니다. 판단은 당신이 하세요.

★ 기본 방식: "게임 시작 때 한 번 세팅 → 게임 중에는 오버레이가 즉시 표시"
- 사용자가 "세팅"(또는 게임 시작/로딩 중이라고) 하면: get_live_game → get_mayhem_event → get_augment_catalog 를 보고
  이 판(내 챔피언, 아군·적 조합, 이벤트) 기준으로 전체 증강 점수표를 save_game_plan 으로 저장하세요.
  * tiers: 가능한 많은 증강을 S+/S/A/B/C/D 에 이름으로 배치 (특히 이 챔피언에게 S~A 와 D(쓸모없음)는 빠짐없이).
  * details: S+~A 등급과 판단이 갈리는 증강에 18자 이내 한 줄 이유(오버레이 카드 위에 그대로 표시됨). 이유에 다른 증강 이름은 쓰지 마세요.
  * synergies: "A를 고르면 B 점수 ±N" 규칙 (이미 고른 증강이 다음 선택에 반영되는 근거). 핵심 조합 위주로 10~30개.
  * build: 핵심 아이템 순서와 상황별 갈림길(예: 적 AP가 크면 X). 적 조합을 반영하세요.
  저장 후에는 채팅에 핵심 전략 3줄만 쓰세요. 이후 선택지는 오버레이가 AI 호출 없이 카드 위에 바로 띄웁니다.
- 게임 중 "뭐 고를까?" → get_augment_offer 결과의 scored(점수표+시너지 반영 점수)를 그대로 쓰고 한 줄로 답하세요. 점수표에 없거나 상황이 크게 바뀌었을 때만 직접 판단합니다.
- "상황 바뀌었어" (예: 적 누가 너무 큼, 빌드 바꿈) → 점수표를 고쳐 save_game_plan 으로 다시 저장 (오버레이 즉시 반영).
- 고른 증강은 오버레이가 카드 클릭으로 자동 기록합니다. 사용자가 말로 알려주면 set_game_context(addAugment).

진행 순서:
1) 먼저 get_live_game 을 호출해 내 챔피언·아군·적·아이템·골드를 확인합니다. 게임이 안 잡히면 사용자에게 조합을 묻고 set_game_context 로 저장합니다.
   이번 판 귀빈 이벤트(mayhemEvent)도 확인하세요. 모르면 get_mayhem_event 로 목록을 보고 사용자에게 물어봅니다. 이벤트는 판단을 크게 바꿉니다:
   - 커맨드 라인: 각 선택에서 첫 새로고침이 등급을 올려주므로, 가장 약한 카드를 먼저 새로고침하라고 권하세요.
   - HEARTSTEEL: 스티커 붙은 증강은 멤버별 추가 효과(get_mayhem_event 의 stickers)를 점수에 더하세요. 사용자에게 스티커 유무를 물어보세요.
   - 열혈 팬: 21레벨에 증강이 하나 더 오므로 후반 스케일링 증강의 가치가 올라갑니다.
   - 펜타킬: 강화할 기본 스킬 선택도 함께 추천하세요.
   - 그 밖의 이벤트(골드·회복·모루 관련)는 아이템 타이밍과 운영 조언에 반영하세요.
   참고: 증강 '세트(특성)' 보너스는 26.12 패치에서 폐지되어 현재 게임 데이터에 없습니다. 세트 보너스를 근거로 추천하지 마세요.
2) 증강 선택: get_augment_offer 로 화면에서 자동으로 읽은 선택지를 먼저 확인합니다(없거나 오래됐으면 사용자에게 스크린샷/이름을 요청). 선택지 → find_augments 로 정확한 효과 확인 → 내 챔피언의 스킬 구조(get_champion), 아군 조합, 적 조합, 이미 고른 증강·아이템과의 시너지를 따져 1순위와 이유를 짧게. 고른 증강은 set_game_context 의 myAugments 에 추가하세요.
3) 아이템: 현재 골드와 적의 실제 성장(enemyAnalysis: 마법/물리 비중, 탱커, 성장한 적)을 보고 다음 구매를 추천. 상황이 바뀌면(적 AP 증가, 회복 챔피언 성장, 내가 터지는 중 등) 빌드를 바꾸라고 먼저 말하세요. search_items/get_item 으로 실제 칼바람 구매 가능 여부와 가격을 확인합니다.
4) 화면 표시: 증강을 판단했으면 show_augment_pick 으로 카드(점수·이유·빌드 방향·1순위)를 보여주고, 아이템/상황 정리는 show_game_panel 로 패널(구매 순서·이유, 적응 메모)을 보여주세요. 화면을 띄웠으면 채팅 답변은 결론 한 줄과 핵심 이유만 짧게 씁니다.
5) 화면을 쓸 수 없는 앱이면 텍스트로: 결론 한 줄 → 이유 2~3줄 → (필요하면) 다음 아이템 순서.
6) 증강 '승률' 같은 통계를 지어내지 마세요. 점수는 당신의 판단 점수라는 걸 전제로 씁니다.
데이터의 수치 중 '?' 는 값이 빠진 것이니 당신이 아는 지식으로 보완하되 확신이 없으면 그렇다고 말하세요.`;

// 게임 중 기억(고른 증강, 수동 입력한 조합). 서버 프로세스가 살아있는 동안 유지됩니다.
const memory = { myChampion: null, allies: [], enemies: [], myAugments: [], notes: [] };

const json = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 1) }] });

async function describeTeam(names) {
  const out = [];
  for (const n of names || []) {
    const c = await findChampion(n);
    out.push(c ? championSummary(c) : { query: n, notFound: true });
  }
  return out;
}

function compAnalysis(team) {
  const found = team.filter((c) => !c.notFound);
  const count = (pred) => found.filter(pred).length;
  return {
    damage: { AD: count((c) => c.damage.type === "AD"), AP: count((c) => c.damage.type === "AP"), 혼합: count((c) => c.damage.type === "혼합") },
    roles: found.reduce((m, c) => { c.tags.forEach((t) => (m[t] = (m[t] || 0) + 1)); return m; }, {}),
    frontline: found.filter((c) => c.tags.includes("Tank") || (c.tags.includes("Fighter") && c.ratings.defense >= 6)).map((c) => c.name),
    ranged: found.filter((c) => c.attackRange >= 300).map((c) => c.name),
  };
}

function createServer() {
  const server = new McpServer({ name: "lol-aram-mayhem-helper", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "get_live_game",
    {
      title: "실시간 게임 상황",
      description:
        "지금 이 PC에서 진행 중인 롤 게임의 상황을 가져옵니다: 내 챔피언·레벨·골드·스탯·룬, 아군/적 챔피언·아이템·KDA, 적 팀이 마법/물리 중 어느 쪽으로 성장했는지, 탱커·성장한 적. 증강/아이템 추천 전에 항상 먼저 호출하세요.",
      inputSchema: {},
    },
    async () => json({ ...(await liveGame(memory)), mayhemEvent: watch.event?.name || "모름 (get_mayhem_event 참고)", augmentOfferOnScreen: offerSummary(), screenWatch: watch.status })
  );

  server.registerTool(
    "get_augment_offer",
    {
      title: "화면의 증강 선택지",
      description:
        "게임 화면을 자동으로 읽어(Windows OCR) 지금 뜬 증강 선택지와 각 효과를 돌려줍니다. 사용자가 '뭐 고를까?'라고 하면 먼저 이걸 호출하세요. secondsAgo 가 크면(예: 90초 이상) 지난 선택지일 수 있으니 사용자에게 확인하세요. OCR이 틀렸을 수 있으면 includeImage=true 로 당시 화면을 직접 보세요.",
      inputSchema: { includeImage: z.boolean().optional().describe("감지 당시 게임 화면 이미지 포함") },
    },
    async ({ includeImage }) => {
      const o = watch.offer;
      if (!o) {
        return json({
          found: false,
          screenWatch: watch.status,
          lastError: watch.lastError || undefined,
          hint: "아직 감지된 선택지가 없습니다. 게임을 '테두리 없는 창 모드'로 하고 증강 선택 화면이 1~2초 이상 보이게 한 뒤 다시 물어보게 하거나, 스크린샷/이름을 받아 find_augments 를 쓰세요.",
        });
      }
      const content = [{
        type: "text",
        text: JSON.stringify({
          found: true, ...offerSummary(),
          scored: await scoreOffer(o, { event: watch.event, gameKey: coord.gameKey }),
          options: await findAugments(o.names),
          alreadyPicked: (await loadPicks(coord.gameKey)).map((p) => p.name),
          previousOffers: watch.history.slice(1, 4).map((h) => h.names),
        }, null, 1),
      }];
      if (includeImage) {
        const data = await offerImage(o);
        if (data) content.push({ type: "image", data, mimeType: "image/jpeg" });
      }
      return { content };
    }
  );

  server.registerTool(
    "capture_game_screen",
    {
      title: "게임 화면 보기",
      description: "롤 게임 창이 마지막으로 앞에 있었을 때의 화면(최대 몇 초 전)을 이미지로 돌려줍니다. OCR로 못 읽은 것을 직접 확인하거나 상점·스코어보드를 볼 때 쓰세요.",
      inputSchema: {},
    },
    async () => {
      const data = await latestFrame();
      if (!data) return json({ found: false, screenWatch: watch.status });
      const ago = watch.lastLeagueFrameAt ? Math.round((Date.now() - watch.lastLeagueFrameAt) / 1000) : null;
      return { content: [{ type: "text", text: `게임 화면 (${ago ?? "?"}초 전)` }, { type: "image", data, mimeType: "image/jpeg" }] };
    }
  );

  server.registerTool(
    "set_game_context",
    {
      title: "게임 정보 기억",
      description:
        "라이브 게임이 안 잡힐 때 사용자가 알려준 조합을 저장하거나, 내가 고른 증강·메모를 기록합니다. 주어진 필드만 덮어쓰고, addAugment 는 기존 목록에 추가합니다. reset=true 면 새 게임으로 초기화.",
      inputSchema: {
        myChampion: z.string().optional(),
        allies: z.array(z.string()).optional().describe("아군 챔피언 4명"),
        enemies: z.array(z.string()).optional().describe("적 챔피언 5명"),
        addAugment: z.string().optional().describe("방금 고른 증강 이름"),
        note: z.string().optional().describe("기억할 상황 메모(예: 적 카타리나가 크게 성장)"),
        event: z.string().optional().describe("이번 판 귀빈 이벤트 이름 (예: 커맨드 라인, HEARTSTEEL)"),
        reset: z.boolean().optional().describe("새 게임 시작: 기억·이벤트 초기화"),
      },
    },
    async (a) => {
      if (a.reset) Object.assign(memory, { myChampion: null, allies: [], enemies: [], myAugments: [], notes: [] });
      if (a.myChampion) memory.myChampion = a.myChampion;
      if (a.allies) memory.allies = a.allies;
      if (a.enemies) memory.enemies = a.enemies;
      if (a.addAugment) {
        const [hit] = await findAugments([a.addAugment]);
        memory.myAugments.push(hit.notFound ? a.addAugment : `${hit.name}(${hit.rarity})`);
        await addPick(hit.notFound ? a.addAugment : hit.name, coord.gameKey, "채팅 입력");
      }
      if (a.note) memory.notes.push(a.note);
      if (a.reset) { await shareEvent(null); await resetPicks(coord.gameKey, { force: true }); }
      if (a.event) {
        const ev = await findEvent(a.event);
        await shareEvent(ev ? { id: ev.id, name: ev.name, at: Date.now(), source: "사용자 입력" } : null);
      }
      return json({ saved: memory, event: watch.event?.name || null });
    }
  );

  server.registerTool(
    "get_mayhem_event",
    {
      title: "이번 판 귀빈 이벤트",
      description:
        "아수라장은 판마다 '귀빈(Guest of Honor)' 이벤트가 하나 붙어 규칙이 바뀝니다(예: 커맨드 라인=첫 새로고침 시 증강 등급 상승, HEARTSTEEL=스티커 붙은 증강에 추가 효과, 열혈 팬=21레벨 추가 증강). 이번 판 이벤트(화면 자동 인식 또는 사용자 입력)와 효과, 전체 이벤트 목록을 돌려줍니다. 증강·새로고침·아이템 판단 전에 확인하세요.",
      inputSchema: {},
    },
    async () => {
      const all = await events();
      const cur = watch.event ? all.find((e) => e.id === watch.event.id) : null;
      return json({
        current: cur ? { ...cur, detectedBy: watch.event.source, secondsAgo: Math.round((Date.now() - watch.event.at) / 1000) } : null,
        hint: cur ? undefined : "이번 판 이벤트를 아직 모릅니다. 경기 시작 안내를 놓쳤다면 사용자에게 이벤트 이름을 물어 set_game_context(event) 로 저장하세요.",
        allEvents: all,
      });
    }
  );

  server.registerTool(
    "get_augment_catalog",
    {
      title: "증강 전체 목록 (세팅용)",
      description: "세팅(점수표 만들기)을 위해 아수라장 증강 전체를 한 줄씩 짧게 돌려줍니다: 이름 | 등급 | 분류 | 효과 요약. 이걸 보고 save_game_plan 의 tiers 를 채우세요.",
      inputSchema: { rarity: z.enum(["실버", "골드", "프리즘"]).optional().describe("등급별로 나눠 보고 싶을 때") },
    },
    async ({ rarity }) => {
      const list = await searchAugments({ rarity, limit: 400 });
      const lines = list.map((a) => `${a.name} | ${a.rarity} | ${a.tags.join(",")} | ${(a.desc || "").replace(/\s+/g, " ").slice(0, 70)}`);
      return { content: [{ type: "text", text: `증강 ${lines.length}개 (이름 | 등급 | 분류 | 효과)\n` + lines.join("\n") }] };
    }
  );

  server.registerTool(
    "save_game_plan",
    {
      title: "이번 판 세팅 저장",
      description:
        "이번 판 점수표를 저장합니다. 저장하면 게임 위 오버레이가 선택지마다 AI 호출 없이 즉시 등급·점수·이유를 띄우고, 이미 고른 증강과의 시너지(synergies)도 자동 반영합니다. 상황이 바뀌면 다시 저장하면 됩니다(덮어씀).",
      inputSchema: {
        champion: z.string().describe("내 챔피언"),
        strategy: z.string().describe("이번 판 핵심 전략 2~3문장 (적 조합·이벤트 반영)"),
        tiers: z.object({
          "S+": z.array(z.string()).optional(), S: z.array(z.string()).optional(), A: z.array(z.string()).optional(),
          B: z.array(z.string()).optional(), C: z.array(z.string()).optional(), D: z.array(z.string()).optional(),
        }).describe("등급별 증강 이름 목록. 많이 채울수록 '점수표에 없음'이 줄어듭니다"),
        details: z.array(z.object({
          name: z.string(),
          reason: z.string().max(40).describe("오버레이에 표시될 한 줄 이유 (18자 이내 권장, 증강 이름 금지)"),
          style: z.string().optional().describe("빌드 방향"),
          score: z.number().min(0).max(100).optional().describe("등급 대신 정확한 점수"),
        })).optional(),
        synergies: z.array(z.object({
          ifPicked: z.string().describe("이미 고른 증강"),
          boost: z.string().describe("점수가 바뀌는 증강"),
          bonus: z.number().min(-40).max(40).describe("점수 변화 (음수면 겹치거나 안 맞음)"),
          why: z.string().optional(),
        })).optional(),
        build: z.object({
          core: z.array(z.string()).describe("핵심 아이템 순서"),
          situational: z.array(z.object({ when: z.string(), item: z.string() })).optional(),
        }).optional(),
        defaultScore: z.number().min(0).max(100).optional().describe("점수표에 없는 증강의 기본 점수 (기본 45)"),
      },
    },
    async (input) => {
      const r = await savePlan(input, coord.gameKey, { source: process.env.ARAM_PLAN_SOURCE || "AI" });
      return json({
        saved: true, gameKey: coord.gameKey, covered: `${r.covered}/${r.total}개 증강에 점수`,
        unknownNames: r.unknown.length ? r.unknown : undefined,
        hint: r.unknown.length ? "unknownNames 는 데이터에 없는 이름입니다. get_augment_catalog 의 정확한 이름으로 다시 저장하세요." : "오버레이 준비 완료",
      });
    }
  );

  server.registerTool(
    "get_game_plan",
    {
      title: "이번 판 세팅 보기",
      description: "저장된 점수표 요약(전략, 빌드, 상위 증강, 시너지), 지금까지 고른 증강, 지금 화면 선택지의 점수를 돌려줍니다.",
      inputSchema: {},
    },
    async () => {
      const plan = await loadPlan();
      if (!plan) return json({ hasPlan: false, hint: "아직 세팅이 없습니다. 사용자에게 '세팅'을 요청받으면 save_game_plan 으로 만드세요." });
      const top = Object.values(plan.scores).sort((a, b) => b.score - a.score).slice(0, 15);
      return json({
        champion: plan.champion, strategy: plan.strategy, build: plan.build,
        stale: Boolean(coord.gameKey && plan.gameKey && plan.gameKey !== coord.gameKey),
        topAugments: top, synergyCount: plan.synergies.length,
        picked: (await loadPicks(coord.gameKey)).map((p) => `${p.name} (${p.source})`),
        currentOffer: watch.offer ? await scoreOffer(watch.offer, { event: watch.event, gameKey: coord.gameKey }) : null,
        coordinator: coord.role,
      });
    }
  );

  server.registerTool(
    "analyze_matchup",
    {
      title: "조합 분석",
      description:
        "내 챔피언, 아군, 적 챔피언 이름(한글/영문)으로 각 챔피언의 역할 태그, 피해 유형(AD/AP), 사거리와 팀별 조합 요약을 돌려줍니다. 비워두면 저장된 게임 정보(set_game_context)를 씁니다.",
      inputSchema: {
        myChampion: z.string().optional(),
        allies: z.array(z.string()).optional(),
        enemies: z.array(z.string()).optional(),
      },
    },
    async (a) => {
      const me = a.myChampion || memory.myChampion;
      const myTeam = await describeTeam([me, ...(a.allies || memory.allies)].filter(Boolean));
      const enemy = await describeTeam(a.enemies || memory.enemies);
      return json({
        me: myTeam[0],
        allies: myTeam.slice(1),
        enemies: enemy,
        ourComp: compAnalysis(myTeam),
        enemyComp: compAnalysis(enemy),
        myAugments: memory.myAugments,
        notes: memory.notes,
      });
    }
  );

  server.registerTool(
    "find_augments",
    {
      title: "증강 효과 조회",
      description:
        "선택지로 뜬 증강 이름들(보통 3개, 한글 이름 일부도 가능)의 정확한 효과, 등급(실버/골드/프리즘), 분류 태그를 조회합니다. 지금까지 고른 증강 목록도 같이 돌려줍니다.",
      inputSchema: { names: z.array(z.string()).min(1).describe("증강 이름 목록") },
    },
    async ({ names }) => json({ options: await findAugments(names), alreadyPicked: memory.myAugments })
  );

  server.registerTool(
    "search_augments",
    {
      title: "증강 검색",
      description: "증강 칼바람 증강 전체에서 키워드(이름·효과 문구)·등급·태그로 검색합니다. 예: query='보호막', rarity='프리즘'.",
      inputSchema: {
        query: z.string().optional(),
        rarity: z.enum(["실버", "골드", "프리즘"]).optional(),
        tag: z.string().optional().describe("Damage, Resilience, Speed, Utility, Ally, General 등"),
        limit: z.number().int().min(1).max(250).optional(),
      },
    },
    async (a) => json(await searchAugments(a))
  );

  server.registerTool(
    "get_champion",
    {
      title: "챔피언 정보",
      description: "챔피언의 패시브·QWER 스킬 설명, 쿨타임, 기본 스탯, 역할, 피해 유형을 가져옵니다. 증강·아이템 시너지 판단에 쓰세요.",
      inputSchema: { name: z.string().describe("챔피언 이름 (한글/영문)") },
    },
    async ({ name }) => {
      const d = await championDetail(name);
      return d ? json(d) : json({ notFound: name });
    }
  );

  server.registerTool(
    "search_items",
    {
      title: "아이템 검색",
      description:
        "칼바람(칼바람 나락 맵)에서 살 수 있는 아이템을 검색합니다. tags 예: SpellDamage, Damage, CriticalStrike, AttackSpeed, Armor, SpellBlock, Health, LifeSteal, CooldownReduction, Boots, MagicPenetration, ArmorPenetration. 기본은 완성 아이템만.",
      inputSchema: {
        query: z.string().optional().describe("이름 또는 효과 키워드 (예: 치유 감소, 보호막)"),
        tags: z.array(z.string()).optional(),
        maxGold: z.number().optional(),
        completedOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async (a) => json(await searchItems(a))
  );

  server.registerTool(
    "get_item",
    {
      title: "아이템 상세",
      description: "아이템 하나의 효과, 스탯, 가격, 하위/상위 아이템을 가져옵니다.",
      inputSchema: { name: z.string().describe("아이템 이름 또는 ID") },
    },
    async ({ name }) => {
      const it = await findItem(name);
      return it ? json(itemSummary(it, { full: true })) : json({ notFound: name });
    }
  );

  server.registerPrompt(
    "aram_coach",
    {
      title: "증강 칼바람 코치 시작",
      description: "게임 시작 시 코치 모드로 대화를 시작합니다.",
      argsSchema: { situation: z.string().optional().describe("지금 상황 (예: 증강 3개 선택지, 아이템 고민)") },
    },
    ({ situation }) => ({
      messages: [{
        role: "user",
        content: { type: "text", text: `${INSTRUCTIONS}\n\n지금 get_live_game 으로 상황을 확인하고 도와줘.${situation ? `\n상황: ${situation}` : ""}` },
      }],
    })
  );

  registerUi(server, { memory, watch });
  return server;
}

// ---------- 실행 ----------
/** MCP 서버 실행 (stdio 또는 --http). 단독 프로그램(--mcp)과 node src/index.js 둘 다 여기로 옵니다. */
export async function runMcp(args = []) {
  await startCoordinator();
  if (args.includes("--http")) {
    // ChatGPT 등 원격 MCP만 지원하는 앱용. 터널(cloudflared/ngrok)로 https 주소를 만들어 연결합니다.
    const port = Number(process.env.PORT || args[args.indexOf("--http") + 1]) || 3939;
    const token = process.env.MCP_TOKEN; // 설정 시 /mcp?token=... 또는 Authorization: Bearer 로만 접근 허용
    http
      .createServer(async (req, res) => {
        const url = new URL(req.url, "http://x");
        if (url.pathname !== "/mcp") { res.writeHead(404).end("MCP endpoint: /mcp"); return; }
        if (token && url.searchParams.get("token") !== token && req.headers.authorization !== `Bearer ${token}`) {
          res.writeHead(401).end("unauthorized"); return;
        }
        let body = "";
        for await (const chunk of req) body += chunk;
        const server = createServer();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on("close", () => { transport.close(); server.close(); });
        await server.connect(transport);
        await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
      })
      .listen(port, () => console.error(`증강 칼바람 MCP (HTTP) → http://localhost:${port}/mcp`));
  } else {
    await createServer().connect(new StdioServerTransport());
    version().catch(() => {}); // 데이터 버전 미리 받아두기
  }
}

// node src/index.js 로 직접 실행한 경우 (기존 MCP 설정 호환)
if (/index.js$/i.test(process.argv[1] || "")) runMcp(process.argv.slice(2));
