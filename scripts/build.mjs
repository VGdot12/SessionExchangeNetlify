import { mkdir, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(root, 'public'), { recursive: true });
for (const file of ['index.html', 'app.js', 'style.css', 'favicon.svg']) {
  await copyFile(path.join(root, 'session_swap', 'static', file), path.join(root, 'public', file));
}
await access(path.join(root, 'public', 'index.html'));
await access(path.join(root, 'netlify', 'functions', 'api.mjs'));
console.log('Built public/index.html and assets. Netlify will bundle the API function.');
