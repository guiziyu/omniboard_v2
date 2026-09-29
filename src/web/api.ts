import { reactive } from 'vue';
export const roles = ['reader', 'editor', 'trader', 'admin'] as const;
export type Role = (typeof roles)[number];
export const atLeast = (role: Role, min: Role) => roles.indexOf(role) >= roles.indexOf(min);
export type User = { id: string; name: string; email: string; role: Role; locale: string };
/** 当前登录用户;任何接口返回 401 时清空,界面回到登录页且 URL 不变(frontend-spec 2.1)。 */
export const session = reactive<{ user: User | null }>({ user: null });
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: init.body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !['/api/login', '/api/session'].includes(path))
      session.user = null;
    throw new ApiError(
      response.status,
      (data as { message?: string }).message ?? response.statusText,
    );
  }
  return data as T;
}
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** 侧栏机构总数(frontend-spec 2.3):登录后与新建机构后重新获取。 */
export const summary = reactive<{ organizations: number | null }>({ organizations: null });
export async function refreshSummary(): Promise<void> {
  summary.organizations = (await api<{ organizations: number }>('/api/summary')).organizations;
}
