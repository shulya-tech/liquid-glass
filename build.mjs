import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, 'src');
const distDir = path.join(__dirname, 'dist');

const files = ['tables', 'core', 'index', 'react', 'vue', 'svelte', 'angular', 'solid'];

for (const name of files) {
  const rawContent = fs.readFileSync(path.join(srcDir, `${name}.js`), 'utf8');
  const esmContent = rawContent.replace(/from\s+['"](\.\/[^'"]+)\.js['"]/g, "from '$1.mjs'");
  fs.writeFileSync(path.join(distDir, `${name}.mjs`), esmContent);

  // Convert simple ESM to CJS for Node/Webpack compatibility
  let cjsContent = rawContent
    .replace(/import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"];?/g, (_, imports, mod) => {
      const targetMod = mod.endsWith('.js') ? mod.replace(/\.js$/, '.cjs') : mod;
      return `const { ${imports.trim()} } = require('${targetMod}');`;
    })
    .replace(/import\s+([A-Za-z0-9_$]+),\s*\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"];?/g, (_, def, named, mod) => {
      return `const ${def} = require('${mod}');\nconst { ${named.trim()} } = require('${mod}');`;
    })
    .replace(/export\s+const\s+([A-Za-z0-9_$]+)\s*=/g, 'const $1 = exports.$1 =')
    .replace(/export\s+function\s+([A-Za-z0-9_$]+)/g, 'exports.$1 = function $1')
    .replace(/export\s+class\s+([A-Za-z0-9_$]+)/g, 'const $1 = exports.$1 = class $1')
    .replace(/export\s+\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"];?/g, (_, exportsList, mod) => {
      const targetMod = mod.endsWith('.js') ? mod.replace(/\.js$/, '.cjs') : mod;
      const items = exportsList.split(',').map((s) => s.trim()).filter(Boolean);
      return items.map((item) => `exports.${item} = require('${targetMod}').${item};`).join('\n');
    })
    .replace(/export\s+\{\s*([^}]+)\s*\};?/g, (_, exportsList) => {
      const items = exportsList.split(',').map((s) => s.trim()).filter(Boolean);
      return items.map((item) => `exports.${item} = ${item};`).join('\n');
    })
    .replace(/export\s+default\s+([A-Za-z0-9_$]+);?/g, 'exports.default = $1;');

  fs.writeFileSync(path.join(distDir, `${name}.cjs`), cjsContent);
}

console.log('Built ESM (.mjs) and CJS (.cjs) bundles into dist/');
