import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
// Prefer TypeScript's transpileModule; fall back to esbuild (both are devDependencies)
// in case the installed TypeScript build does not expose the classic JS API.
let transpile;
try {
  const ts = require('typescript');
  if (typeof ts.transpileModule !== 'function') throw new Error('no transpileModule');
  transpile = (source, file) =>
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
      fileName: file,
    }).outputText;
} catch {
  const esbuild = require('esbuild');
  transpile = (source, file) =>
    esbuild.transformSync(source, { loader: file.endsWith('x') ? 'tsx' : 'ts', format: 'esm', target: 'es2022', jsx: 'automatic' }).code;
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tryFile(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('?url')) {
    const clean = specifier.slice(0, -4);
    const resolved = await nextResolve(clean, context);
    return { url: `${resolved.url}?url`, shortCircuit: true };
  }
  let target = null;
  if (specifier.startsWith('@/')) {
    target = tryFile(path.join(root, specifier.slice(2)));
  } else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    target = tryFile(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
  }
  if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('?url')) {
    const cleanUrl = url.slice(0, -4);
    return { format: 'module', source: `export default ${JSON.stringify(cleanUrl)};`, shortCircuit: true };
  }
  if (/\.tsx?$/.test(url) && url.startsWith('file:')) {
    const source = readFileSync(fileURLToPath(url), 'utf8');
    return { format: 'module', source: transpile(source, fileURLToPath(url)), shortCircuit: true };
  }
  return nextLoad(url, context);
}
