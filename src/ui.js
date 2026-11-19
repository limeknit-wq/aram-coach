// 채팅 안에 그려지는 화면(MCP Apps). Claude·ChatGPT 등 MCP Apps 지원 앱에서 카드/패널로 보입니다.
// 지원하지 않는 앱에서도 도구 결과 텍스트는 그대로 전달되므로 동작에는 문제가 없습니다.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { augments, findAugments, findChampion, findItem, norm, version } from "./data.js";
import { liveGame } from "./live.js";
import { ensureResources, resPath } from "./paths.js";

const UI_URI = "ui://lol-aram/coach.html";
const DD = "https://ddragon.leagueoflegends.com";
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let htmlCache;
/** coach.html 에 MCP Apps 클라이언트 번들을 끼워 넣어 파일 하나짜리 화면을 만듭니다. */
export async function buildUiHtml(preview) {
  if (!htmlCache) {
    await ensureResources();
    const bundlePath = resPath("vendor/app-with-deps.js");
    let bundle = await readFile(bundlePath, "utf8");
    // 번들 끝의 `export{a as App,...}` → 전역 객체로 노출
    bundle = bundle.replace(/export\s*\{([^}]*)\};?\s*$/, (_, list) => {
      const pairs = list.split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
        const [local, exported] = p.split(/\s+as\s+/);
        return `${JSON.stringify((exported || local).trim())}: ${local.trim()}`;
      });
      return `globalThis.__ExtApps = { ${pairs.join(", ")} };`;
    });
    const html = await readFile(resPath("src/ui/coach.html"), "utf8");
    htmlCache = html.replace("/*__EXT_APPS__*/", () => bundle);
  }
  if (!preview) return htmlCache;
  return htmlCache.replace("<script type=\"module\">", () => `<script>globalThis.__PREVIEW__ = ${JSON.stringify(preview)};</script>\n<script type="module">`);
}

const champIcon = async (name) => {
  const c = name && (await findChampion(name));
  return c ? `${DD}/cdn/${await version()}/img/champion/${c.id}.png` : undefined;
};
const itemIcon = async (id) => (id ? `${DD}/cdn/${await version()}/img/item/${id}.png` : undefined);

async function pickedAugments(memory) {
  const { augments: list } = await augments();
  return memory.myAugments.map((label) => {
    const name = label.replace(/\((실버|골드|프리즘)\)$/, "");
    const a = list.find((x) => x.name === name);
    return { name, rarity: a?.rarity, icon: a?.icon };
  });
}

async function headerFrom(live, memory) {
  if (live?.inGame) {
    const m = live.me;
    return {
      champion: m.champion, icon: await champIcon(m.championId || m.champion), level: m.level, kda: m.kda,
      gold: m.currentGold, time: live.gameTime, score: `${live.score.ourKills} : ${live.score.enemyKills}`,
    };
  }
  if (memory.myChampion) return { champion: memory.myChampion, icon: await champIcon(memory.myChampion) };
  return null;
}

let watchRef = null;
async function header(live, memory) {
  const h = (await headerFrom(live, memory)) || (watchRef?.event ? {} : null);
  if (h && watchRef?.event) h.event = watchRef.event.name;
  return h;
}

export function registerUi(server, { memory, watch }) {
  watchRef = watch;
  registerAppResource(server, "아수라장 코치 화면", UI_URI, { description: "증강 카드와 구매/적응/증강/팀 패널" }, async () => ({
    contents: [{
      uri: UI_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: await buildUiHtml(),
      _meta: { ui: { csp: { resourceDomains: ["https://raw.communitydragon.org", "https://ddragon.leagueoflegends.com"] } } },
    }],
  }));

  registerAppTool(
    server,
    "show_augment_pick",
    {
      title: "증강 추천 카드 보여주기",
      description:
        "증강 선택지를 판단한 뒤 이 도구로 결과를 카드로 보여주세요. 각 선택지에 0~100 점수, 한 줄 이유, 빌드 방향(예: AP 폭딜, 탱커, 치명타)을 넣고 1순위(pick)를 지정합니다. 카드는 게임 화면의 왼쪽/가운데/오른쪽 순서로 표시되고, 사용자가 카드에서 '이걸로 골랐어'를 누르면 고른 증강이 자동 기록됩니다.",
      inputSchema: {
        options: z.array(z.object({
          name: z.string().describe("증강 이름"),
          score: z.number().min(0).max(100).describe("이 챔피언·조합 기준 점수"),
          reason: z.string().describe("한 줄 이유"),
          buildStyle: z.string().optional().describe("이 증강이 끌고 가는 빌드 방향"),
          grade: z.string().optional().describe("S+/S/A/B/C, 생략 시 점수로 계산"),
          sticker: z.string().optional().describe("HEARTSTEEL 스티커 효과 (예: '세트: 레벨당 체력 30'). 화면 인식이 되면 자동으로 채워짐"),
        })).min(1).max(6),
        pick: z.string().describe("1순위 증강 이름"),
        summary: z.string().optional().describe("결론 한두 문장"),
      },
      _meta: { ui: { resourceUri: UI_URI } },
    },
    async ({ options, pick, summary }) => {
      const info = await findAugments(options.map((o) => o.name));
      let opts = options.map((o, i) => ({ ...info[i], ...o, name: info[i].notFound ? o.name : info[i].name, isPick: norm(o.name) === norm(pick) || norm(info[i].name) === norm(pick) }));
      // 화면에서 읽은 선택지와 같으면 화면 순서(왼쪽→오른쪽)를 따릅니다
      const offer = watch.offer;
      if (offer?.names?.length) {
        const pos = (n) => offer.names.indexOf(n);
        if (opts.every((o) => pos(o.name) >= 0)) {
          opts.sort((a, b) => pos(a.name) - pos(b.name));
          opts = opts.map((o) => ({ ...o, slot: offer.slots?.[pos(o.name)] || undefined, sticker: o.sticker || offer.stickers?.[pos(o.name)] || undefined }));
        }
      }
      const live = await liveGame(memory).catch(() => null);
      const data = {
        view: "augments",
        header: await header(live, memory),
        pick: opts.find((o) => o.isPick)?.name || pick,
        summary,
        options: opts.map(({ query, notFound, ...o }) => ({ ...o, notFound: notFound || undefined })),
        alreadyPicked: await pickedAugments(memory),
        offerAgeSec: offer ? Math.round((Date.now() - offer.at) / 1000) : null,
      };
      const text = `카드로 표시함. 1순위: ${data.pick}\n` + data.options.map((o) => `- ${o.name} (${o.score}점): ${o.reason}`).join("\n");
      return { content: [{ type: "text", text }], structuredContent: data };
    }
  );

  registerAppTool(
    server,
    "show_game_panel",
    {
      title: "게임 패널 보여주기",
      description:
        "아이템 추천이나 상황 정리를 할 때 이 도구로 패널을 보여주세요. 탭: 구매(다음에 살 아이템 순서와 이유, 현재 골드로 살 수 있는지), 적응(적 마법/물리 비중, 성장한 적, 탱커, 코치 메모), 증강(고른 증강), 팀(양 팀 챔피언·아이템). buy 에는 당신이 판단한 구매 순서를 넣으세요. 실시간 게임 정보는 서버가 채웁니다.",
      inputSchema: {
        buy: z.array(z.object({ item: z.string().describe("아이템 이름"), reason: z.string().describe("왜 이걸 사는지 한 줄") })).max(6).optional(),
        notes: z.array(z.string()).max(5).optional().describe("적응 탭에 보일 코치 메모 (예: 카타리나 궁 끊을 CC 아껴두기)"),
      },
      _meta: { ui: { resourceUri: UI_URI } },
    },
    async ({ buy = [], notes = [] }) => {
      const live = await liveGame(memory);
      const gold = live.inGame ? live.me.currentGold : null;
      const buyList = [];
      for (const b of buy) {
        const it = await findItem(b.item);
        const price = it?.gold?.total;
        buyList.push({
          name: it?.name || b.item, reason: b.reason, icon: await itemIcon(it?.id), gold: price,
          affordable: gold != null && price != null && gold >= price,
          short: gold != null && price != null && gold < price ? price - gold : undefined,
        });
      }
      const withIcons = async (players = []) => Promise.all(players.map(async (p) => ({
        champion: p.champion, level: p.level, kda: p.kda, icon: await champIcon(p.championId || p.champion),
        items: await Promise.all((p.items || []).map(async (i) => ({ name: i.name, icon: await itemIcon(i.id) }))),
      })));
      let adapt = { notes };
      if (live.inGame) {
        const ea = live.enemyAnalysis, t = ea.itemTotals, ct = ea.championDamageTypes;
        // 챔피언 기본 성향(1명당 40)과 실제 아이템 AP/AD 를 합쳐 비중 추정
        const apW = t.ap + ct.AP * 40 + ct.혼합 * 20, adW = t.ad + ct.AD * 40 + ct.혼합 * 20;
        adapt = { magicPct: Math.round((apW / Math.max(1, apW + adW)) * 100), fed: ea.fed, tanks: ea.tanks, notes };
      }
      const data = {
        view: "panel",
        inGame: live.inGame,
        header: await header(live, memory),
        buy: buyList,
        myItems: live.inGame ? await Promise.all(live.me.items.map(async (i) => ({ name: i.name, icon: await itemIcon(i.id) }))) : [],
        adapt,
        augments: await pickedAugments(memory),
        allies: live.inGame ? await withIcons(live.allies) : (memory.allies || []).map((c) => ({ champion: c })),
        enemies: live.inGame ? await withIcons(live.enemies) : (memory.enemies || []).map((c) => ({ champion: c })),
      };
      const text = `패널로 표시함.` + (buyList.length ? ` 구매 순서: ${buyList.map((b) => b.name).join(" → ")}` : "") + (live.inGame ? ` / 적 마법 피해 비중 ${adapt.magicPct}%` : "");
      return { content: [{ type: "text", text }], structuredContent: data };
    }
  );
}
