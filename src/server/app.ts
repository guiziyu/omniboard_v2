import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Pool } from './db';
import { tx } from './db';
import {
  Problem,
  beginTotp,
  changePassword,
  completeActivation,
  endSession,
  inviteInfo,
  inviteLink,
  inviteMember,
  login,
  problem,
  recoveryCodesLeft,
  regenerateRecoveryCodes,
  roles,
  sessionUser,
  type AuthContext,
  type User,
} from './auth';
import { auditCategories, listAudit } from './audit';
import {
  changeRole,
  disableMember,
  enableMember,
  listMembers,
  resendInvite,
  resetAuthenticator,
  signOutMember,
} from './members';
import {
  createToken,
  listTokens,
  revokeToken,
  tokenLifetimes,
  tokenPrincipal,
  tokenRoles,
} from './tokens';
import { expectedVersion, schemaVersion } from './migrate';
import { requireInteractive, requireRole } from './access';
import { registerOrganizationRoutes } from './organization-routes';
import { registerKnowledgeRoutes } from './knowledge-routes';
import { registerWorkRoutes } from './work-routes';
import { registerTalentRoutes } from './talent-routes';
import { registerIntegrationRoutes } from './integration-routes';
import { registerIntelligenceRoutes } from './intelligence';
import { registerSourceRoutes } from './source-routes';
import { registerAccountRoutes } from './accounts';
import { registerHftRoutes } from './hft';
import { waitForCollections, type Fetcher } from './collect';
export type AppOptions = {
  pool: Pool;
  totpKey: Buffer;
  origin: string;
  now?: () => number;
  logger?: boolean;
  serveStatic?: boolean;
  development?: boolean;
  /** 排行页抓取(frontend-spec 9.7);测试用本地样本页代替。 */
  sourceFetcher?: Fetcher;
  /** 部署的 git 提交(deploy.sh 写入 REVISION);/api/health 返回它,部署脚本据此确认新版本已启动。 */
  revision?: string;
};
const COOKIE = 'omniboard_session';
// 不需要会话的接口。
const publicRoutes = new Set(['/api/health', '/api/session', '/api/login', '/api/activate/:token']);
const isPublic = (route: string) => publicRoutes.has(route) || route.startsWith('/api/activate/');
// reader 可以做的写操作(frontend-spec 0.2);其余在 onRequest 统一拒绝。
const readerWrites = new Set([
  '/api/logout',
  '/api/preferences',
  '/api/tokens',
  '/api/tokens/:tokenId',
  '/api/security/password',
  '/api/security/recovery-codes',
  // 情报已读与关注机构是个人状态(frontend-spec 8.2、8.3)。
  '/api/intelligence/:id/read',
  '/api/organizations/:id/follow',
]);
const writeMethods = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const bearerOf = (request: FastifyRequest) =>
  /^Bearer (\S+)$/.exec(request.headers.authorization ?? '')?.[1];
export async function buildApp(options: AppOptions) {
  const ctx: AuthContext = {
    pool: options.pool,
    totpKey: options.totpKey,
    now: options.now ?? Date.now,
  };
  const secureCookie = options.origin.startsWith('https://');
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 8_000_000,
    trustProxy: 'loopback',
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.decorateRequest('user');
  app.decorateRequest('actor');
  app.setErrorHandler((error, request, reply) => {
    const status =
      error instanceof z.ZodError
        ? 422
        : error instanceof Problem
          ? error.statusCode
          : (error as { statusCode?: number }).statusCode || 500;
    if (status >= 500) request.log.error(error);
    const message =
      error instanceof z.ZodError
        ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        : status >= 500
          ? 'Unable to complete the operation. Check the server log and try again.'
          : (error as Error).message;
    void reply.code(status).send({ code: `HTTP_${status}`, message, requestId: request.id });
  });
  const allowedOrigins = new Set([
    options.origin,
    ...(options.development ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : []),
  ]);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    const route = request.routeOptions.url || request.url.split('?')[0]!;
    if (!route.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    const bearer = bearerOf(request);
    // 令牌不随浏览器自动携带,不需要 Origin 校验;Cookie 请求需要。
    if (
      !bearer &&
      writeMethods.has(request.method) &&
      !allowedOrigins.has(request.headers.origin ?? '')
    )
      problem(403, 'Request origin is not allowed.');
    if (isPublic(route)) return;
    let user: User | undefined;
    if (bearer) {
      const principal = await tokenPrincipal(ctx, bearer);
      if (!principal) problem(401, 'The API token is invalid, expired or revoked.');
      user = principal.user;
      request.actor = { id: user.id, via: 'agent_token', agentTokenId: principal.agentTokenId };
    } else {
      user = await sessionUser(ctx, request.cookies[COOKIE]);
      if (!user) problem(401, 'Sign in to continue.');
      request.actor = { id: user.id, via: 'session' };
    }
    request.user = user;
    if (user.role === 'reader' && writeMethods.has(request.method) && !readerWrites.has(route))
      problem(403, 'This role has read-only access.');
  });
  const setSession = (reply: FastifyReply, token: string) =>
    reply.setCookie(COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: secureCookie,
      maxAge: 8 * 3600,
    });

  app.get('/api/health', async () => {
    const version = await schemaVersion(options.pool);
    return {
      status: version === expectedVersion() ? 'ok' : 'schema_mismatch',
      schemaVersion: version,
      expectedVersion: expectedVersion(),
      revision: options.revision ?? null,
    };
  });
  app.get('/api/session', async (request) => ({
    user: (await sessionUser(ctx, request.cookies[COOKIE])) ?? null,
  }));
  const loginSchema = z
    .object({
      email: z.string().max(200),
      password: z.string().max(200),
      code: z.string().max(10).optional(),
      recoveryCode: z.string().max(40).optional(),
    })
    .strict();
  app.post(
    '/api/login',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const result = await login(ctx, loginSchema.parse(request.body));
      setSession(reply, result.token);
      return { user: result.user, recoveryCodesLeft: result.recoveryCodesLeft ?? null };
    },
  );
  app.post('/api/logout', async (request, reply) => {
    await endSession(options.pool, request.cookies[COOKIE]);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  const tokenParam = z.object({ token: z.string().min(20).max(100) });
  app.get('/api/activate/:token', async (request) =>
    inviteInfo(ctx, tokenParam.parse(request.params).token),
  );
  app.post(
    '/api/activate/:token/authenticator',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => beginTotp(ctx, tokenParam.parse(request.params).token),
  );
  const completeSchema = z
    .object({ password: z.string().min(12).max(200).optional(), code: z.string().max(10) })
    .strict();
  app.post(
    '/api/activate/:token/complete',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const result = await completeActivation(
        ctx,
        tokenParam.parse(request.params).token,
        completeSchema.parse(request.body),
      );
      setSession(reply, result.token);
      return { user: result.user, recoveryCodes: result.recoveryCodes };
    },
  );

  const at = () => new Date(ctx.now());
  const memberParam = z.object({ id: z.string().min(1).max(100) });
  const tokenIdParam = z.object({ tokenId: z.string().min(1).max(100) });

  // ---- 团队成员(frontend-spec 12.5) ----
  app.get('/api/members', async (request) => {
    requireRole(request, 'admin');
    return listMembers(options.pool, at());
  });
  const memberSchema = z
    .object({
      // agent 迁移时传入 v1 原 id(proposal §5、§9)。
      id: z.string().trim().min(1).max(100).optional(),
      name: z.string().trim().min(1).max(80),
      email: z.email().max(200),
      role: z.enum(roles),
    })
    .strict();
  app.post('/api/members', async (request) => {
    requireRole(request, 'admin');
    const input = memberSchema.parse(request.body);
    const invited = await tx(options.pool, (client) =>
      inviteMember(client, ctx, request.actor, input),
    );
    return { id: invited.id, inviteLink: inviteLink(options.origin, invited.token) };
  });
  const adminAction = (request: FastifyRequest) => {
    requireRole(request, 'admin');
    requireInteractive(request);
    return memberParam.parse(request.params).id;
  };
  app.patch('/api/members/:id', async (request) => {
    const memberId = adminAction(request);
    const { role } = z
      .object({ role: z.enum(roles) })
      .strict()
      .parse(request.body);
    await changeRole(ctx, request.actor, memberId, role);
    return { ok: true };
  });
  app.post('/api/members/:id/disable', async (request) => {
    await disableMember(ctx, request.actor, adminAction(request));
    return { ok: true };
  });
  app.post('/api/members/:id/enable', async (request) => {
    await enableMember(ctx, request.actor, adminAction(request));
    return { ok: true };
  });
  app.post('/api/members/:id/reset-authenticator', async (request) => {
    const token = await resetAuthenticator(ctx, request.actor, adminAction(request));
    return { inviteLink: inviteLink(options.origin, token) };
  });
  app.post('/api/members/:id/resend-invite', async (request) => {
    const token = await resendInvite(ctx, request.actor, adminAction(request));
    return { inviteLink: inviteLink(options.origin, token) };
  });
  app.post('/api/members/:id/sign-out', async (request) => {
    await signOutMember(ctx, request.actor, adminAction(request));
    return { ok: true };
  });
  app.get('/api/members/:id/tokens', async (request) => {
    requireRole(request, 'admin');
    return listTokens(options.pool, memberParam.parse(request.params).id, at());
  });
  app.delete('/api/members/:id/tokens/:tokenId', async (request) => {
    const memberId = adminAction(request);
    await revokeToken(ctx, request.actor, memberId, tokenIdParam.parse(request.params).tokenId);
    return { ok: true };
  });

  // ---- 本人的 API 令牌与安全设置(frontend-spec 12.6) ----
  app.get('/api/tokens', async (request) => listTokens(options.pool, request.user.id, at()));
  const tokenSchema = z
    .object({
      name: z.string().trim().min(1).max(80),
      role: z.enum(tokenRoles),
      expiresInDays: z.union(tokenLifetimes.map((d) => z.literal(d))).default(30),
    })
    .strict();
  app.post('/api/tokens', async (request) => {
    requireInteractive(request);
    return createToken(ctx, request.actor, request.user, tokenSchema.parse(request.body));
  });
  app.delete('/api/tokens/:tokenId', async (request) => {
    requireInteractive(request);
    await revokeToken(
      ctx,
      request.actor,
      request.user.id,
      tokenIdParam.parse(request.params).tokenId,
    );
    return { ok: true };
  });
  app.get('/api/security', async (request) => ({
    recoveryCodesLeft: await recoveryCodesLeft(options.pool, request.user.id),
  }));
  app.post('/api/security/password', async (request) => {
    requireInteractive(request);
    const input = z
      .object({ current: z.string().max(200), next: z.string().min(12).max(200) })
      .strict()
      .parse(request.body);
    await changePassword(ctx, request.user.id, input);
    return { ok: true };
  });
  app.post('/api/security/recovery-codes', async (request) => {
    requireInteractive(request);
    const { code } = z
      .object({ code: z.string().max(10) })
      .strict()
      .parse(request.body);
    return { recoveryCodes: await regenerateRecoveryCodes(ctx, request.user.id, code) };
  });
  // frontend-spec 2.9:reader 也可以改;只接受 locale。
  app.patch('/api/preferences', async (request) => {
    const { locale } = z
      .object({ locale: z.enum(['en', 'zh-CN', 'ko']) })
      .strict()
      .parse(request.body);
    await options.pool.query(
      `INSERT INTO omniboard.member_preference (member_id, locale) VALUES ($1,$2)
       ON CONFLICT (member_id) DO UPDATE SET locale = EXCLUDED.locale`,
      [request.user.id, locale],
    );
    return { locale };
  });

  // ---- 审计日志(frontend-spec 12.10) ----
  const auditQuery = z
    .object({
      actor: z.string().max(100).optional(),
      category: z.enum(Object.keys(auditCategories) as [keyof typeof auditCategories]).optional(),
      target: z.string().max(200).optional(),
      from: z.iso.date().optional(),
      to: z.iso.date().optional(),
      before: z.string().regex(/^\d+$/).max(20).optional(),
    })
    .strict();
  app.get('/api/audit', async (request) => {
    requireRole(request, 'admin');
    const q = auditQuery.parse(request.query);
    // 日期按 UTC 日界;to 含当天。
    const to = q.to
      ? new Date(Date.parse(`${q.to}T00:00:00Z`) + 86_400_000).toISOString()
      : undefined;
    return listAudit(options.pool, {
      actorId: q.actor,
      category: q.category,
      target: q.target,
      from: q.from ? `${q.from}T00:00:00Z` : undefined,
      to,
      before: q.before,
    });
  });

  const deps = { pool: options.pool, now: ctx.now };
  registerOrganizationRoutes(app, deps);
  registerKnowledgeRoutes(app, deps);
  registerWorkRoutes(app, deps);
  registerTalentRoutes(app, deps);
  registerIntegrationRoutes(app, deps);
  registerIntelligenceRoutes(app, deps);
  registerSourceRoutes(app, { ...deps, fetcher: options.sourceFetcher });
  registerAccountRoutes(app, ctx);
  registerHftRoutes(app, ctx);
  // 关闭前等后台采集写完运行记录。
  app.addHook('onClose', async () => waitForCollections());

  const dist = resolve('dist');
  if (options.serveStatic !== false && existsSync(dist)) {
    await app.register(staticFiles, { root: dist, wildcard: false });
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith('/api/')
        ? reply.code(404).send({ code: 'HTTP_404', message: 'Not found.' })
        : reply.sendFile('index.html'),
    );
  }
  return app;
}
