#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUTH_URL = 'https://api.schwabapi.com/v1/oauth/authorize';
const TOKEN_URL = 'https://api.schwabapi.com/v1/oauth/token';
const API_BASE = 'https://api.schwabapi.com';
const DEFAULT_REDIRECT_URI = 'https://127.0.0.1:8182/';
const DEFAULT_TOKEN_PATH = path.join(ROOT, '.schwab-token.json');
const DEFAULT_OUTPUT_PATH = path.join(ROOT, 'src/data/schwabSnapshot.local.json');
const ACCESS_TOKEN_LEEWAY_MS = 60_000;
const MAX_TRANSACTION_DAYS = 60;
const TRANSACTION_TYPES = [
  'TRADE',
  'RECEIVE_AND_DELIVER',
  'DIVIDEND_OR_INTEREST',
  'ACH_RECEIPT',
  'ACH_DISBURSEMENT',
  'CASH_RECEIPT',
  'CASH_DISBURSEMENT',
  'ELECTRONIC_FUND',
  'WIRE_OUT',
  'WIRE_IN',
  'JOURNAL',
  'MEMORANDUM',
  'MARGIN_CALL',
  'MONEY_MARKET',
  'SMA_ADJUSTMENT',
];

const command = process.argv[2] ?? 'help';
const args = process.argv.slice(3);

await loadLocalEnv();

function printHelp() {
  console.log(`
Schwab local sync

Commands:
  npm run schwab:login
    Open the OAuth URL, paste the final callback URL, and write .schwab-token.json.

  npm run schwab:refresh
    Refresh the saved access token.

  npm run schwab:sync -- [--days=60] [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--output=PATH] [--no-transactions] [--raw]
    Fetch accounts, balances, positions, and recent transactions.

Environment:
  SCHWAB_CLIENT_ID       Schwab app key
  SCHWAB_CLIENT_SECRET   Schwab app secret
  SCHWAB_REDIRECT_URI    Callback URL, default ${DEFAULT_REDIRECT_URI}
  SCHWAB_TOKEN_FILE      Token path, default .schwab-token.json
  SCHWAB_OUTPUT_FILE     Sync output path, default src/data/schwabSnapshot.local.json
`);
}

async function loadLocalEnv() {
  for (const name of ['.env', '.env.local', '.env.schwab.local']) {
    const file = path.join(ROOT, name);
    try {
      const text = await fs.readFile(file, 'utf8');
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) continue;
        const [, key, rawValue] = match;
        if (process.env[key] !== undefined) continue;
        process.env[key] = unquoteEnvValue(rawValue.trim());
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function requireConfig() {
  const clientId = process.env.SCHWAB_CLIENT_ID;
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
  const redirectUri = process.env.SCHWAB_REDIRECT_URI || process.env.SCHWAB_CALLBACK_URL || DEFAULT_REDIRECT_URI;
  const tokenPath = path.resolve(ROOT, process.env.SCHWAB_TOKEN_FILE || DEFAULT_TOKEN_PATH);
  const outputPath = path.resolve(ROOT, process.env.SCHWAB_OUTPUT_FILE || DEFAULT_OUTPUT_PATH);

  const missing = [];
  if (!clientId) missing.push('SCHWAB_CLIENT_ID');
  if (!clientSecret) missing.push('SCHWAB_CLIENT_SECRET');
  if (missing.length) {
    throw new Error(`Missing ${missing.join(', ')}. Put them in .env.schwab.local or export them in your shell.`);
  }

  return { clientId, clientSecret, redirectUri, tokenPath, outputPath };
}

function getFlag(name, fallback = undefined) {
  const prefix = `--${name}=`;
  const hit = args.find((arg) => arg.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  if (index >= 0) return args[index + 1] ?? 'true';
  return fallback;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

function makeAuthorizationUrl({ clientId, redirectUri, state }) {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  }).toString();
  return url.toString();
}

async function login(config) {
  const state = randomBytes(16).toString('hex');
  const authUrl = makeAuthorizationUrl({ ...config, state });
  console.log('Open this URL in your browser:');
  console.log(authUrl);
  console.log('');
  console.log(`Callback URL must exactly match: ${config.redirectUri}`);
  console.log('After approving access, paste the entire redirected URL below.');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const receivedUrl = (await rl.question('Redirect URL> ')).trim();
  rl.close();

  const parsed = new URL(receivedUrl);
  const error = parsed.searchParams.get('error');
  if (error) {
    throw new Error(`Schwab returned OAuth error: ${error} ${parsed.searchParams.get('error_description') || ''}`.trim());
  }
  const returnedState = parsed.searchParams.get('state');
  if (returnedState !== state) {
    throw new Error('OAuth state mismatch. Start login again and use the latest generated URL.');
  }
  const code = parsed.searchParams.get('code');
  if (!code) throw new Error('No code parameter found in redirect URL.');

  const token = await requestToken(config, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
  });
  await writeToken(config.tokenPath, token);
  console.log(`Token written to ${path.relative(ROOT, config.tokenPath)}`);
}

async function refreshToken(config, existing = null) {
  const wrapped = existing ?? await readToken(config.tokenPath);
  const refreshTokenValue = wrapped.token?.refresh_token;
  if (!refreshTokenValue) throw new Error(`No refresh_token found in ${config.tokenPath}. Run schwab:login again.`);
  const refreshed = await requestToken(config, {
    grant_type: 'refresh_token',
    refresh_token: refreshTokenValue,
  });
  const merged = { ...wrapped.token, ...refreshed };
  await writeToken(config.tokenPath, merged, wrapped.creation_timestamp);
  return { creation_timestamp: wrapped.creation_timestamp, token: addTokenExpiry(merged) };
}

async function requestToken(config, fields) {
  const body = new URLSearchParams(fields);
  const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`, 'utf8').toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  const text = await res.text();
  const data = safeJson(text);
  if (!res.ok) {
    throw new Error(`Schwab token request failed ${res.status}: ${formatErrorPayload(data ?? text)}`);
  }
  return addTokenExpiry(data);
}

function addTokenExpiry(token) {
  const now = Math.floor(Date.now() / 1000);
  const out = { ...token };
  if (Number.isFinite(Number(token.expires_in))) out.expires_at = now + Number(token.expires_in);
  if (Number.isFinite(Number(token.refresh_token_expires_in))) {
    out.refresh_token_expires_at = now + Number(token.refresh_token_expires_in);
  }
  return out;
}

async function readToken(tokenPath) {
  try {
    const parsed = JSON.parse(await fs.readFile(tokenPath, 'utf8'));
    if (!parsed?.token) throw new Error('Token file is missing the token wrapper.');
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`Token file not found at ${tokenPath}. Run npm run schwab:login first.`);
    throw err;
  }
}

async function writeToken(tokenPath, token, creationTimestamp = Math.floor(Date.now() / 1000)) {
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(
    tokenPath,
    `${JSON.stringify({ creation_timestamp: creationTimestamp, token: addTokenExpiry(token) }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}

async function getUsableToken(config) {
  const wrapped = await readToken(config.tokenPath);
  const expiresAtMs = Number(wrapped.token?.expires_at || 0) * 1000;
  if (expiresAtMs > Date.now() + ACCESS_TOKEN_LEEWAY_MS) return wrapped;
  return await refreshToken(config, wrapped);
}

async function schwabGet(token, pathname, params = {}) {
  const url = new URL(pathname, API_BASE);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  const data = safeJson(text);
  if (!res.ok) throw new Error(`Schwab API ${url.pathname} failed ${res.status}: ${formatErrorPayload(data ?? text)}`);
  return data;
}

function safeJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatErrorPayload(payload) {
  if (typeof payload === 'string') return payload.slice(0, 500);
  return JSON.stringify(payload).slice(0, 500);
}

async function sync(config) {
  const wrapped = await getUsableToken(config);
  const token = wrapped.token;
  const range = resolveTransactionRange();
  const includeRaw = hasFlag('raw');
  const includeTransactions = !hasFlag('no-transactions');
  const [accounts, accountNumbers] = await Promise.all([
    schwabGet(token, '/trader/v1/accounts', { fields: 'positions' }),
    schwabGet(token, '/trader/v1/accounts/accountNumbers'),
  ]);
  const hashByNumber = new Map(
    (Array.isArray(accountNumbers) ? accountNumbers : [])
      .map((row) => [String(row.accountNumber || ''), row.hashValue])
      .filter(([accountNumber, hash]) => accountNumber && hash),
  );

  const normalizedAccounts = [];
  for (const account of Array.isArray(accounts) ? accounts : []) {
    const sec = account.securitiesAccount ?? account;
    const accountNumber = String(sec.accountNumber || '');
    const accountHash = hashByNumber.get(accountNumber);
    let transactions = [];
    let transactionError = '';
    if (includeTransactions && accountHash) {
      try {
        transactions = await fetchTransactions(token, accountHash, range);
      } catch (err) {
        transactionError = err instanceof Error ? err.message : String(err);
      }
    }
    normalizedAccounts.push(normalizeAccount(sec, { transactions, transactionError, includeRaw }));
  }

  const output = {
    source: 'schwab',
    syncedAt: new Date().toISOString(),
    transactionRange: range,
    totals: summarizeAccounts(normalizedAccounts),
    accounts: normalizedAccounts,
  };

  if (includeRaw) {
    output.raw = { accounts, accountNumbers };
  }

  const outputPath = path.resolve(ROOT, getFlag('output', config.outputPath));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Synced ${normalizedAccounts.length} account(s) to ${path.relative(ROOT, outputPath)}`);
  console.log(`Total liquidation value: ${formatMoney(output.totals.liquidationValue)} USD`);
}

async function fetchTransactions(token, accountHash, range) {
  const data = await schwabGet(token, `/trader/v1/accounts/${encodeURIComponent(accountHash)}/transactions`, {
    types: TRANSACTION_TYPES.join(','),
    startDate: range.startDate,
    endDate: range.endDate,
  });
  return Array.isArray(data) ? data.map(normalizeTransaction) : [];
}

function resolveTransactionRange() {
  const to = parseDateOnly(getFlag('to')) ?? new Date();
  const fromFlag = parseDateOnly(getFlag('from'));
  let days = Number(getFlag('days', MAX_TRANSACTION_DAYS));
  if (!Number.isFinite(days) || days <= 0) days = MAX_TRANSACTION_DAYS;
  days = Math.min(Math.floor(days), MAX_TRANSACTION_DAYS);
  const from = fromFlag ?? new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    startDate: toSchwabDate(from),
    endDate: toSchwabDate(to),
  };
}

function parseDateOnly(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Expected date as YYYY-MM-DD, got ${value}`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

function toSchwabDate(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function normalizeAccount(sec, { transactions, transactionError, includeRaw }) {
  const balances = sec.currentBalances ?? sec.initialBalances ?? {};
  const positions = Array.isArray(sec.positions) ? sec.positions.map(normalizePosition) : [];
  const out = {
    accountId: maskAccountNumber(sec.accountNumber),
    accountMask: maskAccountNumber(sec.accountNumber),
    type: sec.type ?? sec.accountType ?? '',
    balances: pickNumberFields(balances, [
      'liquidationValue',
      'accountValue',
      'cashBalance',
      'cashAvailableForTrading',
      'moneyMarketFund',
      'longMarketValue',
      'shortMarketValue',
      'equity',
      'bondValue',
    ]),
    positions,
    transactions,
  };
  if (transactionError) out.transactionError = transactionError;
  if (includeRaw) out.raw = sec;
  return out;
}

function normalizePosition(position) {
  const instrument = position.instrument ?? {};
  return {
    symbol: instrument.symbol ?? '',
    description: instrument.description ?? '',
    assetType: instrument.assetType ?? '',
    cusip: instrument.cusip ?? '',
    quantity: num(position.longQuantity) - num(position.shortQuantity),
    longQuantity: num(position.longQuantity),
    shortQuantity: num(position.shortQuantity),
    marketValue: num(position.marketValue),
    averagePrice: num(position.averagePrice),
    currentDayProfitLoss: num(position.currentDayProfitLoss),
  };
}

function normalizeTransaction(tx) {
  const transferItems = Array.isArray(tx.transferItems) ? tx.transferItems : [];
  const symbols = [...new Set(transferItems
    .map((item) => item.instrument?.symbol)
    .filter(Boolean))];
  return {
    id: String(tx.activityId ?? tx.transactionId ?? ''),
    date: tx.time ?? tx.tradeDate ?? tx.settlementDate ?? '',
    type: tx.type ?? tx.transactionType ?? '',
    status: tx.status ?? '',
    description: tx.description ?? '',
    netAmount: num(tx.netAmount ?? tx.amount),
    symbols,
    items: transferItems.map((item) => ({
      symbol: item.instrument?.symbol ?? '',
      description: item.instrument?.description ?? '',
      assetType: item.instrument?.assetType ?? '',
      amount: num(item.amount),
      price: num(item.price),
      cost: num(item.cost),
      fee: num(item.fee),
      positionEffect: item.positionEffect ?? '',
    })),
  };
}

function summarizeAccounts(accounts) {
  return accounts.reduce((acc, account) => {
    const balances = account.balances ?? {};
    const positionMarketValue = account.positions.reduce((sum, position) => sum + num(position.marketValue), 0);
    acc.liquidationValue += num(balances.liquidationValue ?? balances.accountValue);
    acc.cashBalance += num(balances.cashBalance ?? balances.cashAvailableForTrading ?? balances.moneyMarketFund);
    acc.positionMarketValue += positionMarketValue;
    return acc;
  }, {
    liquidationValue: 0,
    cashBalance: 0,
    positionMarketValue: 0,
  });
}

function pickNumberFields(source, keys) {
  return Object.fromEntries(
    keys
      .filter((key) => source[key] !== undefined && source[key] !== null)
      .map((key) => [key, num(source[key])]),
  );
}

function maskAccountNumber(accountNumber) {
  const raw = String(accountNumber || '');
  if (!raw) return '';
  return `****${raw.slice(-4)}`;
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

try {
  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
  } else if (command === 'login') {
    await login(requireConfig());
  } else if (command === 'refresh') {
    const config = requireConfig();
    await refreshToken(config);
    console.log(`Token refreshed in ${path.relative(ROOT, config.tokenPath)}`);
  } else if (command === 'sync') {
    await sync(requireConfig());
  } else if (command === 'auth-url') {
    const config = requireConfig();
    console.log(makeAuthorizationUrl({ ...config, state: randomBytes(16).toString('hex') }));
  } else {
    printHelp();
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
