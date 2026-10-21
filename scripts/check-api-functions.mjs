import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// This Vite project uses file-based Node functions on the current 12-function plan.
// Vercel ignores _/dot-prefixed utility files and .d.ts declarations:
// https://vercel.com/docs/functions/configuring-functions/advanced-configuration
const apiRoot = fileURLToPath(new URL('../api/', import.meta.url));
async function entrypoints(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (/^[_.]/.test(entry.name)) continue;
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await entrypoints(path.join(directory, entry.name), relative));
    else if (entry.isFile() && /\.(?:[cm]?[jt]sx?)$/.test(entry.name) && !/\.d\.[cm]?ts$/.test(entry.name)) result.push(relative);
  }
  return result.sort();
}

const files = await entrypoints(apiRoot);
const tests = files.filter(file => /(?:^|\/)(?:test|tests)(?:\/|\.)|\.(?:test|spec)\./.test(file));
const errors = [];
if (tests.length) errors.push(`测试文件会被部署为云函数，请加 _ 前缀或移出 api：${tests.join('、')}`);
if (files.length > 12) errors.push(`云函数 ${files.length} 个，超过当前部署上限 12：${files.join('、')}`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`API 部署检查通过：${files.length}/12 个函数，无测试入口`);
}
