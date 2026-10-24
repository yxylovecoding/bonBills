// Credentials and snapshots stay outside Git. Never print records, key names,
// connection strings or provider error bodies (which may contain secrets).
import { readFile, writeFile } from 'node:fs/promises';
import { createClient } from '@libsql/client/web';
import { exportRedis, importSnapshot, finalizeMigration, validateSnapshot, type RedisCommand } from './lib/storage-migration.js';

const [mode, snapshotPath] = process.argv.slice(2);
async function main() {
  if (!snapshotPath || !['export', 'import', 'finalize'].includes(mode)) throw new Error('Usage: npm run storage:migrate -- export|import|finalize /private/path/snapshot.json');
  const source: RedisCommand = async args => {
    const url = process.env.KV_REST_API_URL;
    if (!url?.startsWith('https://') || !process.env.KV_REST_API_TOKEN) throw new Error('Source credentials missing');
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(60_000) });
    const result = await response.json() as { error?: string; result?: unknown };
    if (!response.ok || result.error || !('result' in result)) throw new Error(`Source export unavailable (HTTP ${response.status}); no cutover performed`);
    return result.result;
  };
  if (mode === 'export') {
    if (process.env.STORAGE_MAINTENANCE !== '1') throw new Error('Freeze source writes before exporting');
    const snapshot = await exportRedis(source);
    await writeFile(snapshotPath, JSON.stringify(snapshot), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ exported: snapshot.records.length, digest: snapshot.digest }));
    return;
  }
  const snapshot: unknown = JSON.parse(await readFile(snapshotPath, 'utf8'));
  validateSnapshot(snapshot);
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) throw new Error('Target credentials missing');
  const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    if (mode === 'import') await importSnapshot(client, snapshot);
    else {
      if (process.env.STORAGE_MAINTENANCE !== '1') throw new Error('Source must remain frozen until cutover');
      await finalizeMigration(client, snapshot, source);
    }
    console.log(JSON.stringify({ stage: mode, records: snapshot.records.length, migrationId: snapshot.digest }));
  } finally { client.close(); }
}
main().catch(error => {
  // Only emit our own fixed messages. Network/SQL exceptions may echo secrets.
  console.error(error instanceof Error && error.constructor === Error ? error.message : 'Storage migration failed; no cutover performed');
  process.exitCode = 1;
});
