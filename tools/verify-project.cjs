/* eslint-disable no-console */
/**
 * 小程序项目静态自检：JSON 语法、页面四件套、require 路径、WXML 事件绑定、
 * JS 语法、分包体积。运行：cd tools && npm run verify:project
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', 'miniprogram');
let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log('  PASS  ' + name);
  else {
    failed += 1;
    console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
  }
}
function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

const files = walk(ROOT, []);

// 1. JSON 语法
const jsons = files.filter((f) => f.endsWith('.json'));
let jsonOk = true;
let jsonErr = '';
for (const f of jsons) {
  try {
    JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (err) {
    jsonOk = false;
    jsonErr = rel(f) + ': ' + err.message;
    break;
  }
}
check('全部 JSON 语法 (' + jsons.length + ' 个)', jsonOk, jsonErr);

// 2. app.json 页面与分包配置
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const pages = (app.pages || []).slice();
(app.subpackages || app.subPackages || []).forEach((pkg) => {
  (pkg.pages || []).forEach((p) => pages.push(pkg.root + '/' + p));
});
let quartetOk = true;
const missing = [];
for (const p of pages) {
  for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
    const f = path.join(ROOT, p + ext);
    if (!fs.existsSync(f)) {
      quartetOk = false;
      missing.push(p + ext);
    }
  }
}
check('页面四件套齐全 (' + pages.length + ' 页)', quartetOk, missing.join(', '));
check('app.json 已配置 workers', app.workers === 'workers');
check('app.json 已声明相机用途', !!(app.permission && app.permission['scope.camera']));

const preload = app.preloadRule || {};
const roots = (app.subpackages || app.subPackages || []).map((p) => p.name || p.root);
let preloadOk = true;
Object.keys(preload).forEach((key) => {
  (preload[key].packages || []).forEach((name) => {
    if (roots.indexOf(name) < 0) preloadOk = false;
  });
});
check('preloadRule 指向有效分包', preloadOk);

// 3. JS 语法（含 vendor 与 Worker 产物）
const jss = files.filter((f) => f.endsWith('.js'));
let syntaxErr = '';
for (const f of jss) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    syntaxErr = rel(f) + ': ' + String(err.stderr || err.message).slice(0, 200);
    break;
  }
}
check('全部 JS 语法 (' + jss.length + ' 个)', !syntaxErr, syntaxErr);

// 4. require 相对路径必须存在
let requireOk = true;
const badRequires = [];
for (const f of jss) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    let target = path.resolve(path.dirname(f), m[1]);
    if (!path.extname(target)) target += '.js';
    if (!fs.existsSync(target)) {
      requireOk = false;
      badRequires.push(rel(f) + ' -> ' + m[1]);
    }
  }
}
check('require 相对路径全部有效', requireOk, badRequires.join('; '));

// 5. WXML 事件绑定的方法必须在同页 JS 中存在
const eventRe = /\b(?:bind|catch)(?:tap|touchstart|touchmove|touchend|touchcancel|error|change|input|load)\s*=\s*"([A-Za-z_$][\w$]*)"/g;
let handlerOk = true;
const badHandlers = [];
for (const p of pages) {
  const wxml = path.join(ROOT, p + '.wxml');
  const js = path.join(ROOT, p + '.js');
  if (!fs.existsSync(wxml) || !fs.existsSync(js)) continue;
  const wsrc = fs.readFileSync(wxml, 'utf8');
  const jsrc = fs.readFileSync(js, 'utf8');
  let m;
  const seen = new Set();
  while ((m = eventRe.exec(wsrc))) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    const defined =
      new RegExp('(^|[\\s,{])' + name + '\\s*\\(', 'm').test(jsrc) ||
      new RegExp('(^|[\\s,{])' + name + '\\s*:', 'm').test(jsrc) ||
      jsrc.indexOf('async ' + name + '(') >= 0;
    if (!defined) {
      handlerOk = false;
      badHandlers.push(p + '.wxml -> ' + name);
    }
  }
}
check('WXML 事件绑定均有对应方法', handlerOk, badHandlers.join('; '));

// 6. 不应残留「开发中」等测试版文案
const forbidden = /开发中|阶段 [0-9]|暂未接入|敬请期待|建设中|测试中|TODO/;
const offenders = [];
for (const f of files.filter((x) => /\.(wxml|js|json|wxss)$/.test(x))) {
  if (f.indexOf('vendor') >= 0 || f.indexOf('workers') >= 0) continue;
  const src = fs.readFileSync(f, 'utf8');
  if (forbidden.test(src)) offenders.push(rel(f));
}
check('无测试版 / 未完成文案', offenders.length === 0, offenders.join(', '));

// 7. 包体积
function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  return walk(dir, []).reduce((n, f) => n + fs.statSync(f).size, 0);
}
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const mainSize = dirSize(ROOT) - dirSize(path.join(ROOT, 'packageFollow')) - dirSize(path.join(ROOT, 'packageCamera'));
console.log('\n  体积：主包 ' + kb(mainSize) +
  '｜跟做分包 ' + kb(dirSize(path.join(ROOT, 'packageFollow'))) +
  '｜拍照分包 ' + kb(dirSize(path.join(ROOT, 'packageCamera'))));
check('主包 < 2MB', mainSize < 2 * 1024 * 1024, kb(mainSize));
check('跟做分包 < 2MB', dirSize(path.join(ROOT, 'packageFollow')) < 2 * 1024 * 1024);
check('拍照分包 < 2MB', dirSize(path.join(ROOT, 'packageCamera')) < 2 * 1024 * 1024);

console.log('\n' + (failed ? '✗ ' + failed + ' 项失败' : '✓ 全部通过'));
process.exit(failed ? 1 : 0);
