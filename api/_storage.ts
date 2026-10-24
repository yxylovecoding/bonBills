import { kv as redis } from '@vercel/kv';
import { createClient } from '@libsql/client/web';
import { createTursoKv } from './_tursoKv.js';

let target: Promise<ReturnType<typeof createTursoKv>> | undefined;
function turso() {
  if (!target) target = (async () => {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    const migration = process.env.TURSO_MIGRATION_ID;
    if (!url || !authToken || !migration) throw new Error('Turso storage is not configured');
    const client = createClient({ url, authToken });
    try {
      const result = await client.execute("SELECT value FROM storage_meta WHERE name='verified_migration'");
      if (result.rows[0]?.value !== migration) throw new Error('Turso migration has not been verified');
      return createTursoKv(client);
    } catch (error) { client.close(); throw error; }
  })().catch(error => { target = undefined; throw error; });
  return target;
}

// Keep the existing typed API while the source remains available for migration.
// Selection is explicit: a Turso failure must never write to the old database.
function command(name: keyof ReturnType<typeof createTursoKv>) {
  return async (...args: unknown[]) => {
    if (process.env.STORAGE_MAINTENANCE === '1') throw new Error('Storage migration in progress');
    const backend = process.env.STORAGE_BACKEND || 'upstash';
    if (!['turso', 'upstash'].includes(backend)) throw new Error('Unknown storage backend');
    const client = backend === 'turso' ? await turso() : redis;
    return (client[name] as (...input: unknown[]) => Promise<unknown>)(...args);
  };
}
export const kv = {
  get: command('get'), set: command('set'), del: command('del'), incr: command('incr'),
  mget: command('mget'), mset: command('mset'), hget: command('hget'),
  hgetall: command('hgetall'), hset: command('hset'), hdel: command('hdel'), eval: command('eval'),
} as Pick<typeof redis, 'get' | 'set' | 'del' | 'incr' | 'mget' | 'mset' | 'hget' | 'hgetall' | 'hset' | 'hdel' | 'eval'>;
