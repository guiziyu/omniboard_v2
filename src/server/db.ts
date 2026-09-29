import pg from 'pg';
import { randomUUID } from 'node:crypto';
export type Pool = pg.Pool;
export type Client = pg.PoolClient;
export const id = () => randomUUID();
export function openPool(url: string, max = 10): Pool {
  return new pg.Pool({ connectionString: url, max, application_name: 'omniboard' });
}
/** 一个事务:业务写入与审计同提交或同失败(proposal §4)。 */
export async function tx<T>(pool: Pool, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
