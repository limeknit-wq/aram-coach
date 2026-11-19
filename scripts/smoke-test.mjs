// 모든 도구를 실제 MCP 클라이언트로 한 번씩 호출해 봅니다: npm test
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// 실제 게임 기록(고른 증강·점수표)을 건드리지 않도록 테스트 전용 임시 폴더와 포트를 씁니다
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
const SMOKE_TMP = join(tmpdir(), "aram-smoke-test");
mkdirSync(SMOKE_TMP, { recursive: true });

const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: process.env.TEST_EXE || process.execPath, args: process.env.TEST_EXE ? ["--mcp"] : ["src/main.js", "--mcp"], env: { ...process.env, LOL_SCREEN_WATCH: "0", LOL_COORD_PORT: "47380", TEMP: SMOKE_TMP, TMP: SMOKE_TMP } }));

const { tools } = await client.listTools();
console.log("도구:", tools.map((t) => t.name).join(", "));

const calls = [
  ["get_live_game", {}],
  ["get_augment_offer", {}],
  ["set_game_context", { event: "커맨드 라인" }],
  ["get_mayhem_event", {}],
  ["set_game_context", { myChampion: "이즈리얼", allies: ["럭스", "말파이트", "소나", "다리우스"], enemies: ["카타리나", "아무무", "애쉬", "소라카", "브랜드"], addAugment: "최첨단 발명가" }],
  ["analyze_matchup", {}],
  ["find_augments", { names: ["너만을 위해", "유리 대포", "핀볼"] }],
  ["search_augments", { query: "보호막", rarity: "프리즘", limit: 3 }],
  ["get_champion", { name: "ezreal" }],
  ["search_items", { query: "치유", limit: 5 }],
  ["search_items", { tags: ["SpellBlock"], limit: 5 }],
  ["get_item", { name: "몰락한 왕의 검" }],
  ["show_augment_pick", { pick: "유리 대포", options: [{ name: "유리 대포", score: 80, reason: "테스트" }, { name: "핀볼", score: 40, reason: "테스트" }] }],
  ["show_game_panel", { buy: [{ item: "몰락한 왕의 검", reason: "테스트" }] }],
];
let failed = 0;
for (const [name, args] of calls) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text || "";
  if (r.isError) failed++;
  console.log(`\n=== ${name} ${JSON.stringify(args)} ${r.isError ? "❌" : "✅"}\n${text.slice(0, 900)}${text.length > 900 ? " …" : ""}`);
}
await client.close();
process.exit(failed ? 1 : 0);
