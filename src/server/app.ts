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
  atLeast,
  beginTotp,
  completeActivation,
  endSession,
  inviteInfo,
  inviteLink,
  inviteMember,
  login,
  problem,
  roles,
  sessionUser,
  type AuthContext,
  type Role,
  type User,
} from './auth';
import { expectedVersion, schemaVersion } from './migrate';
declare module 'fastify' {
  interface FastifyRequest {
    user: User;
  }
}
export type AppOptions = {
  pool: Pool;
  totpKey: Buffer;
  origin: string;
  now?: () => number;
  logger?: boolean;
  serveStatic?: boolean;
  development?: boolean;
};
const COOKIE = 'omniboard_session';
// 不需要会话的接口。
const publicRoutes = new Set(['/api/health', '/api/session', '/api/login', '/api/activate/:token']);
const isPublic = (route: string) => publicRoutes.has(route) || route.startsWith('/api/activate/');
// reader 可以做的写操作(frontend-spec 0.2);其余在 onRequest 统一拒绝。
const readerWrites = new Set(['/api/logout', '/api/preferences']);
const writeMethods = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
export function requireRole(request: FastifyRequest, min: Role): void {
  if (!atLeast(request.user.role, min))
    problem(
      403,
      min === 'admin'
        ? 'Administrator access is required.'
        : min === 'trader'
          ? 'This action requires the trader role.'
          : 'This role has read-only access.',
    );
}
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
    if (writeMethods.has(request.method) && !allowedOrigins.has(request.headers.origin ?? ''))
      problem(403, 'Request origin is not allowed.');
    if (isPublic(route)) return;
    const user = await sessionUser(ctx, request.cookies[COOKIE]);
    if (!user) problem(401, 'Sign in to continue.');
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

  app.get('/api/members', async (request) => {
    requireRole(request, 'admin');
    const result = await options.pool.query(
      'SELECT id, name, email, role, status, last_login_at AS "lastLoginAt", created_at AS "createdAt" FROM omniboard.member ORDER BY created_at, id',
    );
    return result.rows;
  });
  const memberSchema = z
    .object({
      name: z.string().trim().min(1).max(80),
      email: z.email().max(200),
      role: z.enum(roles),
    })
    .strict();
  app.post('/api/members', async (request) => {
    requireRole(request, 'admin');
    const input = memberSchema.parse(request.body);
    const invited = await tx(options.pool, (client) =>
      inviteMember(client, ctx, { id: request.user.id, via: 'session' }, input),
    );
    return { id: invited.id, inviteLink: inviteLink(options.origin, invited.token) };
  });

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
