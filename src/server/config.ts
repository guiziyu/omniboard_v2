import { existsSync } from 'node:fs';
import { totpKey } from './crypto';
// 环境变量只从本仓库的 .env 读(proposal §3:凭据不进 quant 的 .env)。
export function loadEnv(): void {
  if (existsSync('.env')) process.loadEnvFile('.env');
}
export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See .env.example.`);
  return value;
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
  };
}
