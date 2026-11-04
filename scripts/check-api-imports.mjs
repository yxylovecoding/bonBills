import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Vite/Vitest resolve extensionless imports, but deployed Node ESM does not.
// Follow emitted runtime imports from every API entry, including shared src files.
const root = fileURLToPath(new URL('../', import.meta.url));
const seen = new Set(), errors = [];
const exists = async file => { try { return (await stat(file)).isFile(); } catch { return false; } };
async function visit(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const source = await readFile(file, 'utf8');
  const emitted = ts.transpileModule(source, { fileName: file, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const tree = ts.createSourceFile(file, emitted, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const imports = new Set();
  const scan = node => {
    const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
      : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined;
    if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith('.')) imports.add(specifier.text);
    ts.forEachChild(node, scan);
  };
  scan(tree);
  for (const specifier of imports) {
    const location = path.resolve(path.dirname(file), specifier);
    if (!/\.(?:[cm]?js|json)$/.test(specifier)) errors.push(`${path.relative(root, file)} → ${specifier}：Node ESM 导入必须带输出扩展名`);
    const candidates = /\.[cm]?js$/.test(location)
      ? [location.replace(/\.js$/, '.ts').replace(/\.mjs$/, '.mts').replace(/\.cjs$/, '.cts'), location.replace(/\.js$/, '.tsx'), location]
      : [location, `${location}.ts`, `${location}.tsx`, path.join(location, 'index.ts')];
    const target = (await Promise.all(candidates.map(async file => await exists(file) ? file : null))).find(Boolean);
    if (!target) errors.push(`${path.relative(root, file)} → ${specifier}：找不到源文件`);
    else if (/\.[cm]?[jt]sx?$/.test(target)) await visit(target);
  }
}
async function entries(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (/^[_.]/.test(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await entries(file);
    else if (/\.[cm]?[jt]s$/.test(entry.name)) await visit(file);
  }
}
await entries(path.join(root, 'api'));
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`API ESM 导入检查通过：${seen.size} 个运行时模块`);
