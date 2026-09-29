import { appConfig } from './config';
import { openPool } from './db';
import { buildApp } from './app';
import { expectedVersion, schemaVersion } from './migrate';
import { deliverPending, smtpSender } from './notifications';
import { dailyCollection, recoverRuns } from './collect';
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
// 持有锁后,上次遗留的采集运行不可能还在跑(frontend-spec 9.7)。
await recoverRuns(pool);
// 通知邮件走 SMTP(D5);未配置时事件记为 failed,不阻塞操作。
const sender = config.notify ? smtpSender(config.notify) : undefined;
const app = await buildApp({
  pool,
  totpKey: config.totpKey,
  origin: config.origin,
  logger: true,
  development: config.development,
  sender,
});
if (!sender)
  app.log.warn('OMNIBOARD_NOTIFY_TO is not set: notifications will be recorded as failed.');
// 写请求结束时投递一次;这里每分钟补投未处理的事件。
const notifyTimer = setInterval(
  () => void deliverPending(pool, sender, config.origin).catch((e: unknown) => app.log.error(e)),
  60_000,
);
notifyTimer.unref();
// 每日采集(9.7):开关在数据来源页,默认关闭。
const collectTimer = setInterval(
  () =>
    void dailyCollection(pool, Date.now(), { log: app.log }).catch((e: unknown) =>
      app.log.error(e),
    ),
  60_000,
);
collectTimer.unref();
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  clearInterval(notifyTimer);
  clearInterval(collectTimer);
  await app.close();
  lockClient.release();
  await pool.end();
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
await app.listen({ host: config.host, port: config.port });
