/* eslint-disable no-console */
/**
 * 随机打乱生成器自检：合法性、随机性、与求解器/3D 方向一致性。
 * 运行：cd tools && npm run verify:scramble
 */
const { randomScramble, makeCubies, applyTurn, tokenToTurn, readFacelets } = require('../miniprogram/utils/scramble.js');
const { countColors, diagnoseFacelets, centersOk, COLOR_ORDER, SOLVED } = require('../miniprogram/utils/colors.js');
const { invertToken } = require('../miniprogram/utils/turns.js');

let failed = 0;
function check(name, ok, detail) {
  if (ok) console.log('  PASS  ' + name);
  else {
    failed += 1;
    console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
  }
}

// 可复现的伪随机源
function seeded(seed) {
  return () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

// 1. 每次生成不同
const set = new Set();
for (let i = 0; i < 20; i++) set.add(randomScramble(22, seeded(i + 1)).state);
check('20 次生成各不相同（真随机）', set.size === 20, '不同状态数=' + set.size);

// 2. 合法性：六色各 9 格、无未填、中心色、角棱合法
let legalOk = true;
let legalDetail = '';
for (let i = 0; i < 200; i++) {
  const { state } = randomScramble(22, seeded(i * 7 + 1));
  const f = state.split('');
  const counts = countColors(f);
  const sixOk = COLOR_ORDER.every((c) => counts[c] === 9);
  const noQ = counts['?'] === 0;
  const diag = diagnoseFacelets(f);
  if (!sixOk || !noQ || diag.message || !centersOk(f)) {
    legalOk = false;
    legalDetail = '第 ' + i + ' 次: ' + (diag.message || JSON.stringify(counts));
    break;
  }
}
check('200 次打乱全部合法（六色各9/中心/角棱）', legalOk, legalDetail);

// 3. 与求解器/3D 方向一致性：正向执行 tokens == 生成 state；反向逆 tokens 回到已还原
const { state, tokens } = randomScramble(22, seeded(42));
const cubies = makeCubies();
tokens.forEach((t) => applyTurn(cubies, tokenToTurn(t)));
check('正向执行 tokens 与生成 state 一致', readFacelets(cubies) === state);
for (let i = tokens.length - 1; i >= 0; i--) applyTurn(cubies, tokenToTurn(invertToken(tokens[i])));
check('反向执行逆 tokens 精确回到已还原', readFacelets(cubies) === SOLVED);

// 4. 非已还原态、且步数正确
check('打乱态不等于已还原态', state !== SOLVED);
check('tokens 数量等于请求步数', tokens.length === 22, 'tokens=' + tokens.length);

console.log('\n' + (failed ? '✗ ' + failed + ' 项失败' : '✓ 全部通过'));
process.exit(failed ? 1 : 0);
