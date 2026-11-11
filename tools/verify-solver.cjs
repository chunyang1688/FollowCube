/**
 * 打包产物自检：在 Node 中模拟小程序 Worker 全局对象，验证求解闭环。
 * 用法：cd tools && npm run build:solver && npm run verify:solver
 */
const path = require('path');

const WORKER = path.resolve(__dirname, '../miniprogram/workers/solver/index.js');
const SCRAMBLED =
  'DDRUURBLFLFBRRRUBLDBUDFUFRFRDRBDULFDBLRLLLUDDUFLBBFFUB';

let handler = null;
const out = [];

globalThis.worker = {
  postMessage: (m) => out.push(m),
  onMessage: (cb) => {
    handler = cb;
  }
};

require(WORKER);

function last() {
  return out[out.length - 1];
}

// 新握手协议：Worker 收到主线程 ping 后才执行 initSolver 并回 ready
if (!handler) throw new Error('FAIL: Worker 未注册 onMessage');
if (out.some((m) => m.type === 'ready')) throw new Error('FAIL: ping 前不应 ready');

handler({ message: { type: 'ping' } });
console.log('after ping:', JSON.stringify(out));
if (!out.some((m) => m.type === 'ready')) throw new Error('FAIL: ping 后求解器未 ready');

// 1. 合法打乱 → 应给出可还原的解法
handler({ message: { type: 'solve', state: SCRAMBLED, requestId: 1 } });
let r = last();
console.log('solve result:', JSON.stringify(r));
if (r.type !== 'result') throw new Error('FAIL: 求解未返回结果 - ' + r.message);
if (!r.solved) throw new Error('FAIL: 解法未能还原魔方');
if (r.requestId !== 1) throw new Error('FAIL: requestId 丢失');
console.log('PASS 1: ' + r.moveCount + ' 步解法, initMs=' + r.initMs + ', solveMs=' + r.solveMs);

// 2. 非法字符 → 必须被 Worker 白名单拦下
handler({ message: { type: 'solve', state: 'X'.repeat(54), requestId: 2 } });
r = last();
console.log('invalid charset result:', JSON.stringify(r));
if (r.type !== 'error' || r.requestId !== 2) throw new Error('FAIL: 非法字符未被拦截');
console.log('PASS 2: 非法字符拦截正常');

// 3. 物理上不合法的状态（交换两个角块贴纸）→ verify() 应拦下
const bad = SCRAMBLED.split('');
[bad[0], bad[2]] = [bad[2], bad[0]];
handler({ message: { type: 'solve', state: bad.join(''), requestId: 3 } });
r = last();
console.log('illegal cube result:', JSON.stringify(r));
if (r.type !== 'error' || r.requestId !== 3) {
  throw new Error('FAIL: 不合法魔方状态未被 verify 拦截');
}
console.log('PASS 3: 不合法状态拦截正常');

// 4. 长度错误 → 应报错
handler({ message: { type: 'solve', state: 'UUU', requestId: 4 } });
r = last();
if (r.type !== 'error' || r.requestId !== 4) throw new Error('FAIL: 长度错误未拦截');
console.log('PASS 4: 长度校验正常');

console.log('ALL PASS');
