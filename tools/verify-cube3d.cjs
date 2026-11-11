/* eslint-disable no-console */
/**
 * 3D 状态模型自检：验证「解法序列 + 逆向重建」与 rubik-solver 的坐标/方向约定完全一致。
 * 运行：cd tools && npm install && npm run verify:cube3d
 *
 * 这是 3D 跟做正确性的核心防线：若方向与求解器约定不符，3D 动画会把用户带偏。
 */
const path = require('path');
const { createModel, tokenToTurn, turnToken } = require('../miniprogram/packageFollow/utils/cube3d-core.js');
const { SCRAMBLED } = require('../miniprogram/utils/state.js');
const { SOLVED, COLOR_ORDER } = require('../miniprogram/utils/colors.js');
const { invertToken } = require('../miniprogram/utils/turns.js');

let failed = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log('  PASS  ' + name);
  } else {
    failed += 1;
    console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
  }
}

function diff(a, b) {
  const marks = [];
  for (let i = 0; i < 54; i++) if (a[i] !== b[i]) marks.push(i);
  return marks.slice(0, 12).map((i) => {
    const face = COLOR_ORDER[Math.floor(i / 9)];
    return face + (i % 9) + ':' + a[i] + '→' + b[i];
  }).join(' ');
}

async function main() {
  let solver;
  try {
    solver = require('rubik-solver');
  } catch (err) {
    console.error('缺少 rubik-solver，请先在 tools 目录执行 npm install');
    process.exit(1);
  }
  solver.initSolver();

  const model = createModel();
  check('初始姿态为已还原', model.getFacelets() === SOLVED);

  // 1. 单个转动应改变状态，且自身逆操作能回到原状
  const single = createModel();
  single.applyToken('R');
  check('R 转动后不再是已还原', !single.isSolved());
  single.applyToken("R'");
  check("R + R' 回到已还原", single.isSolved());

  const half = createModel();
  half.applyTokens(['U', 'U']);
  half.applyToken('U2');
  check('U2 + U2 回到已还原', half.isSolved(), 'tokenToTurn(U2)=' + JSON.stringify(tokenToTurn('U2')));

  // 2. 求解器输出的解法必须能把输入状态还原（模型层复演）
  const solution = solver.solve(solver.Cube.fromString(SCRAMBLED));
  const tokens = solution.split(/\s+/).filter(Boolean);
  check('求解器返回解法', tokens.length > 0, '解法=' + solution);

  const replay = createModel();
  const rebuilt = replay.setScramble(tokens);
  check(
    '逆向重建的打乱态 == 首页示例打乱串',
    rebuilt === SCRAMBLED,
    '不一致格：' + diff(rebuilt, SCRAMBLED) + '\n        重建=' + rebuilt + '\n        期望=' + SCRAMBLED
  );

  // 3. 从重建态正向执行解法，应逐步到达已还原
  let solvedAtEnd = false;
  for (let i = 0; i < tokens.length; i++) replay.applyToken(tokens[i]);
  solvedAtEnd = replay.isSolved();
  check('按解法逐步执行后魔方已还原', solvedAtEnd, '终态=' + replay.getFacelets());

  // 4. 逐步回退：每步逆操作都能回到上一步状态
  const back = createModel();
  back.setScramble(tokens);
  const snapshot = back.getFacelets();
  back.applyToken(tokens[0]);
  back.applyToken(invertToken(tokens[0]));
  check('单步前进 + 逆操作可精确回退', back.getFacelets() === snapshot);

  // 5. 每个 token 的 90° 步数必须落在 ±1 / ±2
  const weird = tokens.filter((t) => {
    const s = tokenToTurn(t).steps;
    return ![-2, -1, 1, 2].includes(s);
  });
  check('所有 token 均为 90°/180° 转动', weird.length === 0, '异常 token: ' + weird.join(','));

  // 6. 手动转面：手指往哪边拖，被点中的那一面就往哪边转
  check(
    '前面右侧向上拖是 F\'',
    turnToken([0, 0, 1], [1, 0, 1], [0, 1, 0]) === "F'"
  );
  check(
    '前面右侧向下拖是 F',
    turnToken([0, 0, 1], [1, 0, 1], [0, -1, 0]) === 'F'
  );
  check(
    '前面上沿向右拖是 F',
    turnToken([0, 0, 1], [0, 1, 1], [1, 0, 0]) === 'F'
  );
  check(
    '上面靠右、向后拖是 U\'',
    turnToken([0, 1, 0], [1, 1, 0], [0, 0, -1]) === "U'"
  );

  console.log('\n' + (failed ? '✗ ' + failed + ' 项失败' : '✓ 全部通过') + '（解法 ' + tokens.length + ' 步：' + solution + '）');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('自检异常：', err);
  process.exit(1);
});
