// UI 미리보기: 실제 도구를 호출해 나온 데이터로 coach.html 을 그려 http://localhost:4321 에서 보여줍니다.
// 사용: node scripts/ui-preview.mjs  → /augments  /panel?tab=adapt 등
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildUiHtml } from "../src/ui.js";

const client = new Client({ name: "preview", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["src/index.js"], env: { ...process.env, LOL_SCREEN_WATCH: "0" } }));
const call = async (name, args) => (await client.callTool({ name, arguments: args })).structuredContent;

const res = await client.listResources();
console.log("UI 리소스:", res.resources.map((r) => `${r.uri} (${r.mimeType})`).join(", "));
const tools = (await client.listTools()).tools.filter((t) => t._meta?.ui);
console.log("UI 도구:", tools.map((t) => `${t.name} → ${t._meta.ui.resourceUri}`).join(", "));

await call("set_game_context", { myChampion: "이즈리얼", allies: ["럭스", "말파이트", "소나", "다리우스"], enemies: ["카타리나", "아무무", "애쉬", "소라카", "브랜드"], addAugment: "최첨단 발명가", event: "HEARTSTEEL" });
const aug = await call("show_augment_pick", {
  pick: "궁극의 각성",
  summary: "Q 위주 이즈리얼은 궁 이후 스킬 초기화가 한타 화력을 가장 크게 늘립니다.",
  options: [
    { name: "광대 대학", score: 48, reason: "생존기는 좋지만 이즈리얼은 이미 E로 빠질 수 있어 가치가 낮음", buildStyle: "유틸" },
    { name: "궁극의 각성", score: 88, sticker: "세트: 이 증강을 선택하면 레벨당 체력을 30 얻습니다.", reason: "R 후 Q·W·E 즉시 초기화 → 한타에서 E 두 번, 화력 폭증", buildStyle: "스킬 가속 AD" },
    { name: "눈덩이 룰렛", score: 61, reason: "눈덩이 진입 후 무작위 주문, 원거리 포킹 챔프와는 궁합 애매", buildStyle: "돌진" },
  ],
});
const panel = await call("show_game_panel", {
  buy: [{ item: "몰락한 왕의 검", reason: "적 탱커(아무무)와 체력 아이템 상대로 효율" }, { item: "헤르메스의 시미터", reason: "카타리나·브랜드 마법 피해 + 아무무 CC 해제" }, { item: "수호 천사", reason: "카타리나 진입에 대비한 생존" }],
  notes: ["카타리나 궁은 말파이트 궁으로 끊기", "소라카 회복이 커서 치유 감소를 서두르세요"],
});
await client.close();

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const data = u.pathname.startsWith("/panel") ? panel : aug;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end((await buildUiHtml(data)).replace("</head>", `<script>if(!location.hash)location.hash="preview"</script></head>`));
}).listen(4321, () => console.log("미리보기: http://localhost:4321/augments , http://localhost:4321/panel?tab=buy"));
