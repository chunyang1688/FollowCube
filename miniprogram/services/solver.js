/**
 * 求解器适配层：把小程序 Worker 封装成 Promise 接口。
 *
 * 官方文档：https://developers.weixin.qq.com/miniprogram/dev/api/worker/wx.createWorker
 *  - app.json 已配 "workers": "workers"
 *  - 全局最多 1 个 Worker，此处保持单例；创建下一个前须 terminate
 *  - Worker 内不支持 wx API / npm 包，rubik-solver 已由 esbuild 打包为
 *    workers/solver/index.js 单文件（约 15KB）
 *  - Worker 脚本会先同步执行 initSolver()（约 1s，真机可能更久）再注册 onMessage，
 *    因此 ready 之前的求解请求在本层排队，避免消息丢失。
 */
const WORKER_PATH = 'workers/solver/index.js';
const SOLVE_TIMEOUT = 30000;

let worker = null;
let ready = false;
let seq = 0;
const pending = new Map(); // requestId -> { resolve, reject, timer }
const queue = []; // ready 之前暂存的求解请求
const readyCallbacks = [];
const initErrorCallbacks = [];

function rejectRequest(requestId, err) {
  const task = pending.get(requestId);
  if (!task) return;
  clearTimeout(task.timer);
  pending.delete(requestId);
  task.reject(err instanceof Error ? err : new Error(String(err)));
}

function flushQueue() {
  while (queue.length) {
    const item = queue.shift();
    try {
      worker.postMessage({ type: 'solve', state: item.state, requestId: item.requestId });
    } catch (err) {
      rejectRequest(item.requestId, err);
    }
  }
}

function notifyReady() {
  ready = true;
  const app = typeof getApp === 'function' ? getApp() : null;
  if (app && app.globalData) app.globalData.solverReady = true;
  while (readyCallbacks.length) {
    const cb = readyCallbacks.shift();
    try {
      cb();
    } catch (err) {
      console.error('[solver] onReady callback error', err);
    }
  }
  flushQueue();
}

function handleMessage(res) {
  // 基础库回调结构为 { message: <Worker postMessage 的对象> }，以官方文档为准
  const msg = (res && res.message) || {};
  if (msg.type === 'init-start') return;
  if (msg.type === 'ready') {
    notifyReady();
    return;
  }
  // 初始化失败（无 requestId 的 error）：反馈给 UI 而不是静默忽略
  if (msg.type === 'error' && msg.requestId == null) {
    const message = msg.message || '求解器初始化失败';
    while (initErrorCallbacks.length) {
      const cb = initErrorCallbacks.shift();
      try {
        cb(message);
      } catch (err) {
        console.error('[solver] initError callback error', err);
      }
    }
    return;
  }
  const task = pending.get(msg.requestId);
  if (!task) return;
  clearTimeout(task.timer);
  pending.delete(msg.requestId);
  if (msg.type === 'error') {
    const err = new Error(msg.message || '求解失败');
    err.verifyMessage = msg.verifyMessage || '';
    task.reject(err);
  } else if (msg.type === 'result') {
    task.resolve(msg);
  }
}

function ensureWorker() {
  if (worker) return worker;
  worker = wx.createWorker(WORKER_PATH);
  // 先注册监听，再主动 ping，触发 Worker 执行初始化并回 ready，
  // 从根上规避「Worker 先 post ready、主线程后注册监听」的竞态丢消息问题。
  worker.onMessage(handleMessage);
  try {
    worker.postMessage({ type: 'ping' });
  } catch (err) {
    console.error('[solver] ping failed', err);
  }
  return worker;
}

/** 页面 onLoad 时提前启动 Worker，把 initSolver 的耗时隐藏在用户填色期间 */
function preload() {
  try {
    ensureWorker();
  } catch (err) {
    console.error('[solver] createWorker failed', err);
  }
}

function onReady(cb) {
  if (ready) {
    cb();
    return;
  }
  readyCallbacks.push(cb);
}

function onInitError(cb) {
  initErrorCallbacks.push(cb);
}

function isReady() {
  return ready;
}

/**
 * @param {string} state 54 位颜色字符串，顺序 U R F D L B
 * @returns {Promise<{solution:string, moveCount:number, solveMs:number, initMs:number, solved:boolean}>}
 */
function solve(state) {
  return new Promise((resolve, reject) => {
    try {
      ensureWorker();
    } catch (err) {
      reject(new Error('求解器启动失败：' + (err.message || err)));
      return;
    }
    const requestId = ++seq;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      const idx = queue.findIndex((q) => q.requestId === requestId);
      if (idx >= 0) queue.splice(idx, 1);
      reject(new Error('求解超时，请重试'));
    }, SOLVE_TIMEOUT);
    pending.set(requestId, { resolve, reject, timer });

    if (ready) {
      try {
        worker.postMessage({ type: 'solve', state, requestId });
      } catch (err) {
        rejectRequest(requestId, err);
      }
    } else {
      queue.push({ requestId, state });
    }
  });
}

/** 显式释放（全局只允许 1 个 Worker）。常规页面切换不调用，避免反复初始化。 */
function terminate() {
  if (!worker) return;
  try {
    worker.terminate();
  } catch (err) {
    console.error('[solver] terminate failed', err);
  }
  worker = null;
  ready = false;
  pending.forEach((task) => {
    clearTimeout(task.timer);
    task.reject(new Error('求解器已关闭'));
  });
  pending.clear();
  queue.length = 0;
}

module.exports = { preload, onReady, onInitError, isReady, solve, terminate };
