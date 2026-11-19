// 아수라장 코치 진입점
//   AramCoach.exe            → 프로그램 모드: 트레이 + 화면 감시 + 오버레이 + 게임 시작 시 AI 자동 세팅
//   AramCoach.exe --mcp      → MCP 서버 (Claude/ChatGPT 연결용, stdio)
//   AramCoach.exe --http     → MCP 서버 (ChatGPT 원격 연결용)
import { runMcp } from "./index.js";
import { startCoordinator } from "./coord.js";
import { ensureResources } from "./paths.js";
import { maybeInstall, messageBox } from "./install.js";
import { checkUpdate } from "./update.js";

async function runApp(args) {
  if (await maybeInstall(args)) process.exit(0);
  await ensureResources();
  const r = await startCoordinator({ app: true });
  if (r.alreadyRunning) {
    await messageBox("아수라장 코치가 이미 실행 중이에요.\n작업 표시줄 오른쪽 트레이 아이콘을 확인하세요.");
    process.exit(0);
  }
  checkUpdate().catch(() => {});
}

const args = process.argv.slice(2);
if (args.includes("--mcp") || args.includes("--http")) {
  runMcp(args.filter((a) => a !== "--mcp"));
} else {
  runApp(args).catch(async (e) => {
    await messageBox(`실행 중 오류가 났어요:\n${e?.message || e}`).catch(() => {});
    process.exit(1);
  });
}
