import { appConfig } from './config';
import { openPool } from './db';
import { buildApp } from './app';
import { expectedVersion, schemaVersion } from './migrate';
const config = appConfig();
const pool = openPool(config.pgUrl);
// 结构版本不符就不启动(deploy.sh 同样自检,proposal §3)。
const version = await schemaVersion(pool);
if (version !== expectedVersion()) {
  console.error(
    `Schema version ${version} does not match expected ${expectedVersion()}. Run npm run migrate first.`,
  );
  process.exit(1);
}
// 单实例:取代 v1 的 PID 锁(data-model §1)。连接一直持有,进程退出即释放。
const lockClient = await pool.connect();
const locked = await lockClient.query<{ ok: boolean }>(
  "SELECT pg_try_advisory_lock(hashtext('omniboard.server')) AS ok",
);
if (!locked.rows[0]!.ok) {
  console.error('Another Omniboard server is running against this database.');
  process.exit(1);
}
const app = await buildApp({
  pool,
  totpKey: config.totpKey,
  origin: config.origin,
  logger: true,
  development: config.development,
});
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  await app.close();
  lockClient.release();
  await pool.end();
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
await app.listen({ host: config.host, port: config.port });
