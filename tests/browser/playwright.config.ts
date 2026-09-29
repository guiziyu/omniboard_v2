import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
// Neo 缺 Chromium 的几个系统库,已按 README 解包到用户目录(不需要 sudo)。
const extraLibs = `${homedir()}/.local/opt/pw-libs/usr/lib/aarch64-linux-gnu`;
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4319',
    launchOptions: existsSync(extraLibs)
      ? { env: { ...process.env, LD_LIBRARY_PATH: extraLibs } as Record<string, string> }
      : {},
  },
  webServer: {
    command: 'npx tsx tests/browser/serve.ts',
    cwd: '../..',
    url: 'http://127.0.0.1:4319/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
    // 默认是 SIGKILL,serve.ts 来不及删测试库。
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
});
