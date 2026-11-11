/* eslint-disable no-console */
/**
 * 把 threejs-miniprogram 的 CommonJS 产物复制进跟做分包。
 * 该产物本身是 CommonJS（可直接 require），因此不需要在微信开发者工具里「构建 npm」，
 * 导入项目即可运行；放分包内是为了不占用主包体积。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(__dirname, 'node_modules', 'threejs-miniprogram');
const dst = path.join(root, 'miniprogram', 'packageFollow', 'vendor', 'threejs-miniprogram');

if (!fs.existsSync(path.join(src, 'dist', 'index.js'))) {
  console.error('未找到 threejs-miniprogram，请先在 tools 目录执行 npm install');
  process.exit(1);
}

fs.mkdirSync(dst, { recursive: true });
const files = [
  ['dist/index.js', 'index.js'],
  ['LICENSE', 'LICENSE'],
  ['package.json', 'package.json']
];
for (const [from, to] of files) {
  fs.copyFileSync(path.join(src, from), path.join(dst, to));
}
const size = fs.statSync(path.join(dst, 'index.js')).size;
console.log('已复制 threejs-miniprogram -> ' + dst + '（' + (size / 1024).toFixed(0) + ' KB）');
