/**
 * 求解器适配层：把小程序 Worker 封装成 Promise 接口。
 *
 * 官方文档：https://developers.weixin.qq.com/miniprogram/dev/api/worker/wx.createWorker
 *  - app.json 已配 "workers": "workers"
 *  - 全局最多 1 个 Worker，此处保持单例；创建下一个前须 terminate
 *  - Worker 内不支持 wx API / npm 包，rubik-solver 已由 esbuild 打包为
 *    workers/solver/index.js 单文件（约 15KB）
 *  - Worker 等主线程 ping 之后才 initSolver，避免 ready 比 onMessage 更早发出。
 *    ready 之前的求解请求在本层排队，避免消息丢失。
 *  - 回调载荷兼容两种形态：文档中的 res.message，以及部分基础库直接把对象当作参数。
 */
const WORKER_PATH = 'workers/solver/index.js';
const SOLVE_TIMEOUT = 30000;

let worker = null;
let ready = false;
let pingTimer = null;
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

/**
 * 取出 Worker 回调里的业务对象。
 * 官方字段是 res.message；部分基础库把 postMessage 的对象直接当作回调参数。
 * 两种都认，否则 ping/ready 对不上，求解按钮会一直不可用。
 */
function unwrapWorkerMessage(res) {
  if (!res || typeof res !== 'object') return {};
  const inner = res.message;
  if (inner && typeof inner === 'object' && (inner.type != null || inner.requestId != null)) {
    return inner;
  }
  if (res.type != null || res.requestId != null) return res;
  return {};
}

function notifyInitError(message) {
  // 初始化失败时立刻结束排队中的求解，避免界面一直停在「求解中」直到超时
  const err = new Error(message);
  queue.length = 0;
  pending.forEach((task) => {
    clearTimeout(task.timer);
    task.reject(err);
  });
  pending.clear();
  while (initErrorCallbacks.length) {
    const cb = initErrorCallbacks.shift();
    try {
      cb(message);
    } catch (err) {
      console.error('[solver] initError callback error', err);
    }
  }
}

function handleMessage(res) {
  const msg = unwrapWorkerMessage(res);
  if (msg.type === 'init-start') return;
  if (msg.type === 'ready') {
    notifyReady();
    return;
  }
  // 初始化失败（无 requestId 的 error）：反馈给 UI 而不是静默忽略
  if (msg.type === 'error' && msg.requestId == null) {
    notifyInitError(msg.message || '求解器初始化失败');
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

function pingWorker() {
  if (!worker || ready) return;
  try {
    worker.postMessage({ type: 'ping' });
  } catch (err) {
    console.error('[solver] ping failed', err);
  }
}

/**
 * 创建全局唯一 Worker。先挂上 onMessage 再 ping，避免 ready 在监听之前发出。
 * 脚本抛错走 onError；若首个 ping 丢失，2 秒一次补发，最多 4 次。
 */
function ensureWorker() {
  if (worker) return worker;
  worker = wx.createWorker(WORKER_PATH);
  worker.onMessage(handleMessage);
  if (typeof worker.onError === 'function') {
    worker.onError((err) => {
      if (ready) return;
      const message = (err && (err.message || err.errMsg)) || '求解器脚本错误';
      notifyInitError(message);
    });
  }
  pingWorker();
  if (pingTimer) clearInterval(pingTimer);
  let retries = 0;
  pingTimer = setInterval(() => {
    // ready 之后或 Worker 已销毁就停；否则补 ping，覆盖首包丢失
    if (ready || !worker || retries >= 4) {
      clearInterval(pingTimer);
      pingTimer = null;
      return;
    }
    retries += 1;
    pingWorker();
  }, 2000);
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
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  pending.forEach((task) => {
    clearTimeout(task.timer);
    task.reject(new Error('求解器已关闭'));
  });
  pending.clear();
  queue.length = 0;
}

module.exports = { preload, onReady, onInitError, isReady, solve, terminate };
