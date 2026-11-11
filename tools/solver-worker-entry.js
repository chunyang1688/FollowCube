/* eslint-disable no-undef */
import { Cube, initSolver, solve } from 'rubik-solver';

/**
 * FollowCube 求解 Worker 源码。
 * 构建：cd tools && npm install && npm run build:solver
 * 产物：miniprogram/workers/solver/index.js（minified IIFE，请勿直接编辑产物）
 *
 * 官方文档：https://developers.weixin.qq.com/miniprogram/dev/api/worker/wx.createWorker
 *   - app.json 需配置 "workers": "workers"
 *   - 全局最多 1 个 Worker，创建下一个前须 terminate
 *   - Worker 内只能 require 同目录文件、不能用 npm 包、不能调用 wx API
 *   - Worker 线程执行上下文会全局暴露一个 `worker` 对象，
 *     直接调用 worker.onMessage / worker.postMessage 即可
 *
 * 兼容处理：同时支持小程序 worker.onMessage / worker.postMessage 与
 * Web Worker 的 onmessage / postMessage，后者便于 verify-solver.cjs 在 Node 中自检。
 * 全局对象名称与回调结构（res.message）以微信官方文档为准。
 */
const ctx = typeof globalThis !== 'undefined' ? globalThis : this;

function getWorker() {
  if (ctx.worker && typeof ctx.worker.postMessage === 'function') return ctx.worker;
  if (typeof worker !== 'undefined' && worker && typeof worker.postMessage === 'function') {
    return worker;
  }
  return null;
}

function post(msg) {
  const w = getWorker();
  if (w) {
    w.postMessage(msg);
  } else if (typeof ctx.postMessage === 'function') {
    ctx.postMessage(msg);
  }
}

function onMessage(handler) {
  const w = getWorker();
  if (w && typeof w.onMessage === 'function') {
    w.onMessage(handler);
  } else {
    ctx.onmessage = function (event) {
      handler({ message: (event && event.data) || {} });
    };
  }
}

let ready = false;
let initMs = 0;

function fail(requestId, message, verifyMessage) {
  post({ type: 'error', requestId, message, verifyMessage });
}

function handleSolve(state, requestId) {
  if (!ready) {
    fail(requestId, '求解器还没准备好');
    return;
  }
  try {
    if (typeof state !== 'string' || state.length !== 54) {
      fail(requestId, '颜色状态必须是 54 个格子');
      return;
    }
    // 加固：rubik-solver 的 Cube.fromString 对未知字符不报错，会算出错误解法，
    // 因此在 Worker 层再做一次字符白名单校验（前端 utils/colors.js 已先做合法性诊断）。
    if (!/^[URFDLB]{54}$/.test(state)) {
      fail(requestId, '状态字符串只能包含 U/R/F/D/L/B 六个色字母，且长度必须为 54');
      return;
    }
    const cube = Cube.fromString(state);
    const verdict = cube.verify();
    if (verdict !== true) {
      fail(requestId, String(verdict), String(verdict));
      return;
    }
    const t1 = Date.now();
    const solution = solve(cube);
    const solveMs = Date.now() - t1;
    if (!solution) {
      fail(requestId, '在限定步数内没有找到解法');
      return;
    }
    const check = Cube.fromString(state);
    check.move(solution);
    const moves = solution.split(/\s+/).filter(Boolean);
    post({
      type: 'result',
      requestId,
      state,
      solution,
      moveCount: moves.length,
      solved: check.isSolved(),
      initMs,
      solveMs
    });
  } catch (err) {
    fail(requestId, String(err && err.message ? err.message : err));
  }
}

// 延迟初始化：等主线程 ping 后再 initSolver，避免「Worker 先 post ready、
// 主线程后 onMessage 注册」的竞态导致 ready 消息丢失。
// 主线程 createWorker 后先注册 onMessage，再 postMessage({type:'ping'})，
// Worker 收到 ping 才执行耗时初始化并回 ready，保证监听一定就绪。
let initDone = false;
let initError = null;

function ensureInit() {
  if (initDone) return;
  initDone = true;
  try {
    const t0 = Date.now();
    initSolver();
    initMs = Date.now() - t0;
    ready = true;
    post({ type: 'ready', initMs });
  } catch (err) {
    initError = String(err && err.message ? err.message : err);
    post({
      type: 'error',
      message: '求解器初始化失败：' + initError
    });
  }
}

onMessage(function (res) {
  const msg = (res && res.message) || {};
  if (msg.type === 'ping' || msg.type === 'solve') {
    ensureInit();
  }
  if (msg.type === 'solve') handleSolve(msg.state, msg.requestId);
});
