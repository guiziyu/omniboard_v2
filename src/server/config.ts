import { existsSync } from 'node:fs';
import { totpKey } from './crypto';
import type { NotifyConfig } from './notifications';
// 环境变量只从本仓库的 .env 读(proposal §3:凭据不进 quant 的 .env)。
export function loadEnv(): void {
  if (existsSync('.env')) process.loadEnvFile('.env');
}
export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See .env.example.`);
  return value;
}
/** 通知邮件(frontend-spec 12.11、D5)。没有收件人 = 未配置,通知记为 failed;配了一半直接报错。 */
export function notifyConfig(env: NodeJS.ProcessEnv = process.env): NotifyConfig | undefined {
  const to = (env.OMNIBOARD_NOTIFY_TO ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
  if (!to.length) return undefined;
  const smtpUrl = env.OMNIBOARD_SMTP_URL;
  const from = env.OMNIBOARD_NOTIFY_FROM;
  if (!smtpUrl || !from)
    throw new Error(
      'OMNIBOARD_NOTIFY_TO is set, so OMNIBOARD_SMTP_URL and OMNIBOARD_NOTIFY_FROM are required. See .env.example.',
    );
  if (!/^smtps?:\/\//.test(smtpUrl))
    throw new Error('OMNIBOARD_SMTP_URL must start with smtp:// or smtps://.');
  const invalid = to.find((address) => !/^[^\s@<>]+@[^\s@<>]+$/.test(address));
  if (invalid) throw new Error(`OMNIBOARD_NOTIFY_TO has an invalid address: ${invalid}`);
  return { smtpUrl, from, to };
}
export function appConfig() {
  loadEnv();
  return {
    pgUrl: required('QUANT_PG_URL'),
    totpKey: totpKey(process.env.OMNIBOARD_TOTP_KEY),
    origin: required('APP_ORIGIN').replace(/\/$/, ''),
    port: Number(process.env.PORT || 4318),
    host: process.env.HOST || '127.0.0.1',
    development: process.env.NODE_ENV === 'development',
    notify: notifyConfig(),
  };
}
