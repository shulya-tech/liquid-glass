import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, 'src');
const distDir = path.join(__dirname, 'dist');

function getAllFiles(dir, baseDir = dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFiles(fullPath, baseDir));
    } else if (file.endsWith('.js')) {
      results.push(path.relative(baseDir, fullPath));
    }
  }
  return results;
}

const files = getAllFiles(srcDir);

for (const relPath of files) {
  const relPathNoExt = relPath.replace(/\.js$/, '');
  const rawContent = fs.readFileSync(path.join(srcDir, relPath), 'utf8');

  // Convert relative imports from .js to .mjs for ESM
  const esmContent = rawContent.replace(/from\s+['"]((?:\.\.|\.)\/[^'"]+)\.js['"]/g, "from '$1.mjs'");
  const esmTarget = path.join(distDir, `${relPathNoExt}.mjs`);
  fs.mkdirSync(path.dirname(esmTarget), { recursive: true });
  fs.writeFileSync(esmTarget, esmContent);

  // Convert simple ESM to CJS for Node/Webpack compatibility
  let cjsContent = rawContent
    .replace(/import\s+\*\s+as\s+([A-Za-z0-9_$]+)\s+from\s+['"]([^'"]+)['"];?/g, (_, name, mod) => {
      const targetMod = mod.endsWith('.js') ? mod.replace(/\.js$/, '.cjs') : mod;
      return `const ${name} = require('${targetMod}');`;
    })
    .replace(/import\s+([A-Za-z0-9_$]+),\s*\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"];?/g, (_, def, named, mod) => {
      const targetMod = mod.endsWith('.js') ? mod.replace(/\.js$/, '.cjs') : mod;
      return `const ${def} = require('${targetMod}');\nconst { ${named.trim()} } = require('${targetMod}');`;
    })
    .replace(/import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"];?/g, (_, imports, mod) => {
      const targetMod = mod.endsWith('.js') ? mod.replace(/\.js$/, '.cjs') : mod;
      return `const { ${imports.trim()} } = require('${targetMod}');`;
    })
    .replace(/import\s+([A-Za-z0-9_$]+)\s+from\s+['"]([^'"]+)['"];?/g, (_, name, mod) => {
      const targetMod = mod.endsWith('.js') ? mod.replace(/\.js$/, '.cjs') : mod;
      return `const ${name} = require('${targetMod}');`;
    })
    .replace(/export\s+const\s+([A-Za-z0-9_$]+)\s*=/g, 'const $1 = exports.$1 =')
    .replace(/export\s+function\s+([A-Za-z0-9_$]+)/g, 'exports.$1 = function $1')
    .replace(/export\s+class\s+([A-Za-z0-9_$]+)/g, 'const $1 = exports.$1 = class $1')
    .replace(/export\s+\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"];?/g, (_, exportsList, mod) => {
      const targetMod = mod.endsWith('.js') ? mod.replace(/\.js$/, '.cjs') : mod;
      const items = exportsList.split(',').map((s) => s.trim()).filter(Boolean);
      return items
        .map((item) => {
          const parts = item.split(/\s+as\s+/);
          const orig = parts[0].trim();
          const alias = parts[1] ? parts[1].trim() : orig;
          return `exports.${alias} = require('${targetMod}').${orig};`;
        })
        .join('\n');
    })
    .replace(/export\s+\{\s*([^}]+)\s*\};?/g, (_, exportsList) => {
      const items = exportsList.split(',').map((s) => s.trim()).filter(Boolean);
      return items
        .map((item) => {
          const parts = item.split(/\s+as\s+/);
          const orig = parts[0].trim();
          const alias = parts[1] ? parts[1].trim() : orig;
          return `exports.${alias} = ${orig};`;
        })
        .join('\n');
    })
    .replace(/export\s+default\s+([A-Za-z0-9_$]+);?/g, 'exports.default = $1;');

  const cjsTarget = path.join(distDir, `${relPathNoExt}.cjs`);
  fs.mkdirSync(path.dirname(cjsTarget), { recursive: true });
  fs.writeFileSync(cjsTarget, cjsContent);
}

console.log(`Successfully built ${files.length} modules into dist/ (ESM .mjs and CJS .cjs)`);
