import { parseArgs } from 'node:util';
import { appConfig, loadEnv, required } from './config';
import { openPool } from './db';
import { bootstrapAdmin, inviteLink } from './auth';
import { expectedVersion, migrate, schemaVersion } from './migrate';
const [command, ...rest] = process.argv.slice(2);
async function main() {
  switch (command) {
    case 'migrate': {
      loadEnv();
      const applied = await migrate(required('QUANT_PG_MIGRATOR_URL'));
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.');
      return;
    }
    case 'selfcheck': {
      // deploy.sh 切换前调用:PG 连通、schema 版本一致(证据原件也在 PG 里)。
      const config = appConfig();
      const pool = openPool(config.pgUrl, 1);
      try {
        const version = await schemaVersion(pool);
        if (version !== expectedVersion())
          throw new Error(`Schema version ${version}, expected ${expectedVersion()}.`);
        console.log(`OK: PostgreSQL reachable, schema version ${version}.`);
      } finally {
        await pool.end();
      }
      return;
    }
    case 'bootstrap-admin': {
      const { values } = parseArgs({
        args: rest,
        options: { name: { type: 'string' }, email: { type: 'string' } },
      });
      if (!values.name || !values.email)
        throw new Error('Usage: npm run cli -- bootstrap-admin --name <name> --email <email>');
      const config = appConfig();
      const pool = openPool(config.pgUrl, 1);
      try {
        const invited = await bootstrapAdmin(
          { pool, totpKey: config.totpKey, now: Date.now },
          { name: values.name, email: values.email },
        );
        console.log(
          `Administrator invited. Open within 72 hours:\n${inviteLink(config.origin, invited.token)}`,
        );
      } finally {
        await pool.end();
      }
      return;
    }
    case 'close-import': {
      // 切换后关闭迁移窗口:此后任何调用方都不能写入系统时间(proposal §9、D6)。
      const config = appConfig();
      const pool = openPool(config.pgUrl, 1);
      try {
        await pool.query(
          "UPDATE omniboard.app_setting SET value = 'false' WHERE key = 'import_open'",
        );
        console.log('Import window closed.');
      } finally {
        await pool.end();
      }
      return;
    }
    default:
      throw new Error(
        'Commands: migrate | selfcheck | bootstrap-admin --name <name> --email <email> | close-import',
      );
  }
}
main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
