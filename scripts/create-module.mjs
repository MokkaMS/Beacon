#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const rawName = process.argv[2];
if (!rawName) {
  console.error('Usage: npm run create-module <module-id>');
  console.error('Example: npm run create-module proxmox-monitor');
  process.exit(1);
}

const id = rawName
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/^-|-$/g, '');

if (!id) {
  console.error('Invalid module id.');
  process.exit(1);
}

const displayName = id
  .split('-')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const camelId = id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const templatePath = join(rootDir, 'apps/bot/src/modules/_template/index.ts');
const targetDir = join(rootDir, 'apps/bot/src/modules', id);
const targetPath = join(targetDir, 'index.ts');

if (existsSync(targetDir)) {
  console.error(`Module directory already exists: ${targetDir}`);
  process.exit(1);
}

let content = readFileSync(templatePath, 'utf8');
content = content
  .replaceAll("id: 'example'", `id: '${id}'`)
  .replaceAll("name: 'Example Module'", `name: '${displayName}'`)
  .replaceAll("'example.use'", `'${id}.use'`)
  .replaceAll(".setName('example')", `.setName('${id.slice(0, 32)}')`)
  .replaceAll("module: 'example'", `module: '${id}'`)
  .replaceAll("'module:example'", `'module:${id}'`)
  .replaceAll('templateModule', `${camelId}Module`);

mkdirSync(targetDir, { recursive: true });
writeFileSync(targetPath, content, 'utf8');

console.log(`Created new module "${displayName}" at:`);
console.log(`  apps/bot/src/modules/${id}/index.ts`);
console.log('It will be auto-discovered on the next bot start/build.');
