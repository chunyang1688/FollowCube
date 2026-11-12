// 填色页：立体魔方上点贴纸。颜色真值是 54 位字符串，放在 globalData.facelets。
const { SOLVED, COLOR_ORDER, COLOR_HEX, COLOR_NAME, emptyFacelets, countError, diagnoseFacelets, explainVerify } = require('../../../utils/colors.js');
const { randomScramble } = require('../../../utils/scramble.js');
const { describeMove } = require('../../../utils/turns.js');
const solver = require('../../../services/solver.js');
const { createPaintCube } = require('../../utils/paint3d.js');

// 色板按小朋友好认的顺序：红橙黄白蓝绿，不按 URFDLB
const PALETTE_KEYS = ['R', 'L', 'D', 'U', 'B', 'F'];

/** 只保留六个中心色，其余待填。中心用来认面，不能改。 */
function blankFacelets() {
  const chars = emptyFacelets();
  COLOR_ORDER.forEach((face, i) => {
    chars[i * 9 + 4] = face;
  });
  return chars.join('');
}

Page({
  data: {
    palette: PALETTE_KEYS.map((key) => ({
      key,
      name: COLOR_NAME[key],
      hex: COLOR_HEX[key]
    })),
    activeColor: 'R',
    hint: '先选下面的颜色，再点魔方上的贴纸',
    hasError: false,
    seeing: '上面 · 前面 · 右面',
    solving: false,
    canContinue: false,
    view3d: true,
    view3dTip: ''
  },

  /** 读全局颜色。没有存过就只留下六个中心色，等用户来填。 */
  onLoad() {
    const app = getApp();
    const stored = app && app.globalData && app.globalData.facelets;
    this.facelets = typeof stored === 'string' && stored.length === 54 ? stored : blankFacelets();
    this.scene = null;
    this._pageGone = false;
    this._initing = false;
    this._gesture = null;
    this._rect = null;
    solver.preload();
    this.refreshHint();
  },

  /**
   * 从跟着转返回时，颜色没改过就露出「继续跟着转」。
   * 拍照页写回的六面会清掉旧步骤，必须重新点还原。
   */
  onShow() {
    const app = getApp();
    const captured = app && app.globalData ? app.globalData.capturedFacelets : null;
    if (captured && captured.length === 54) {
      app.globalData.capturedFacelets = null;
      this.facelets = captured.join ? captured.join('') : String(captured);
      this.saveFacelets(true);
      if (this.scene) this.scene.setFacelets(this.facelets);
      wx.showToast({ title: '已填入拍照结果', icon: 'none' });
    }
    this.refreshHint();
  },

  onReady() {
    this.init3D();
  },

  onUnload() {
    this._pageGone = true;
    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }
  },

  /** 把当前 54 格写回全局。改色时清掉旧解法，避免跟做页还放着上一盘。 */
  saveFacelets(clearSolution) {
    const app = getApp();
    if (!app || !app.globalData) return;
    app.globalData.facelets = this.facelets;
    if (clearSolution) app.globalData.solution = null;
  },

  /** 更新顶部提示，并把不合法的格子在模型上稍微标红 */
  refreshHint() {
    const problem = countError(this.facelets);
    const diag = diagnoseFacelets(this.facelets);
    let hint = '颜色齐了，点「还原」求出步骤';
    let hasError = false;
    if (problem) {
      hint = problem.indexOf('没填') >= 0 ? problem + '，上下滑可以看背面' : problem;
      hasError = true;
    } else if (diag.message) {
      hint = '有格子对不上，转一转看标红的贴纸';
      hasError = true;
    }
    const app = getApp();
    const solution = app && app.globalData ? app.globalData.solution : null;
    // 只有这份颜色就是上次求出的那一盘，才允许接着转，避免步骤和贴纸对不上
    const canContinue = !hasError && !!(
      solution &&
      solution.state === this.facelets &&
      solution.steps &&
      solution.steps.length
    );
    if (canContinue) hint = '已有 ' + solution.moveCount + ' 步，可以继续跟着转';
    this.setData({ hint, hasError, canContinue });
    if (this.scene) this.scene.markErrors(hasError && diag.cells ? diag.cells : []);
  },

  /** 取 WebGL 画布。节点刚挂上时经常是空的，所以会重试。 */
  init3D() {
    if (this._pageGone || this.scene || this._initing) return;
    this._initing = true;
    this.queryCanvas(8);
  },

  queryCanvas(left) {
    if (this._pageGone || this.scene) {
      this._initing = false;
      return;
    }
    const query = typeof this.createSelectorQuery === 'function'
      ? this.createSelectorQuery()
      : wx.createSelectorQuery();
    query.select('#paint-canvas').fields({ node: true, size: true }).exec((res) => {
      if (this._pageGone || this.scene) {
        this._initing = false;
        return;
      }
      const item = res && res[0];
      if (!item || !item.node || !item.width || !item.height) {
        if (left > 0) {
          setTimeout(() => this.queryCanvas(left - 1), 60);
          return;
        }
        this._initing = false;
        this.setData({ view3d: false, view3dTip: '这个设备打不开立体魔方，可以改用拍照识别' });
        return;
      }
      let dpr = 2;
      try {
        dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio;
      } catch (err) {
        dpr = 2;
      }
      let scene = null;
      try {
        scene = createPaintCube({
          canvas: item.node,
          width: item.width,
          height: item.height,
          pixelRatio: dpr
        });
      } catch (err) {
        scene = null;
      }
      this._initing = false;
      if (!scene) {
        this.setData({ view3d: false, view3dTip: '这个设备打不开立体魔方，可以改用拍照识别' });
        return;
      }
      this.scene = scene;
      this.scene.setFacelets(this.facelets);
      this.setData({ view3d: true, seeing: scene.facing() });
      this.refreshHint();
      this.measure();
    });
  },

  /** 记下画布在屏幕上的位置，把触摸换算成画布内坐标 */
  measure() {
    const query = typeof this.createSelectorQuery === 'function'
      ? this.createSelectorQuery()
      : wx.createSelectorQuery();
    query.select('#paint-canvas').boundingClientRect((rect) => {
      if (rect) this._rect = rect;
    }).exec();
  },

  onPalette(e) {
    this.setData({ activeColor: e.currentTarget.dataset.key });
  },

  onCamera() {
    wx.navigateTo({ url: '/packageCamera/pages/camera/camera' });
  },

  onTouchStart(e) {
    const t = (e.touches || [])[0];
    if (!t) return;
    this._gesture = { x: t.clientX, y: t.clientY, moved: false };
    this.measure();
  },

  onTouchMove(e) {
    const t = (e.touches || [])[0];
    if (!t || !this._gesture) return;
    const dx = t.clientX - this._gesture.x;
    const dy = t.clientY - this._gesture.y;
    if (Math.abs(dx) > 14 || Math.abs(dy) > 14) this._gesture.moved = true;
  },

  /** 几乎没移动算点击上色；横滑转一圈，竖滑翻到顶面或底面 */
  onTouchEnd(e) {
    const start = this._gesture;
    this._gesture = null;
    if (!start || !this.scene) return;
    const t = (e.changedTouches || [])[0] || {};
    const dx = (t.clientX || start.x) - start.x;
    const dy = (t.clientY || start.y) - start.y;
    if (!start.moved) {
      if (this.scene.isAnimating && this.scene.isAnimating()) return;
      this.paintAt(start.x, start.y);
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) this.scene.turnYaw(dx > 0 ? 1 : -1);
    else this.scene.turnPitch();
    this.setData({ seeing: this.scene.facing() });
  },

  /** 用选中的颜色填被点中的贴纸。中心格固定，用来认面。 */
  paintAt(clientX, clientY) {
    const rect = this._rect;
    if (!rect || !this.scene) return;
    const hit = this.scene.hit(clientX - rect.left, clientY - rect.top, rect.width, rect.height);
    if (!hit) return;
    if (hit.center) {
      wx.showToast({ title: '中心色固定', icon: 'none' });
      return;
    }
    const chars = this.facelets.split('');
    chars[hit.gi] = this.data.activeColor;
    this.facelets = chars.join('');
    this.scene.setSticker(hit.gi, this.data.activeColor);
    this.saveFacelets(true);
    this.refreshHint();
  },

  onReset() {
    this.facelets = blankFacelets();
    this.saveFacelets(true);
    if (this.scene) this.scene.setFacelets(this.facelets);
    this.refreshHint();
  },

  onSolved() {
    this.facelets = SOLVED;
    this.saveFacelets(true);
    if (this.scene) this.scene.setFacelets(this.facelets);
    this.refreshHint();
  },

  onSample() {
    const { state } = randomScramble(22);
    this.facelets = state;
    this.saveFacelets(true);
    if (this.scene) this.scene.setFacelets(this.facelets);
    this.refreshHint();
  },

  /** 颜色没改过时直接进入上次的步骤，不再求解一次。 */
  onContinue() {
    const app = getApp();
    const solution = app && app.globalData ? app.globalData.solution : null;
    if (!solution || solution.state !== this.facelets || !solution.steps || !solution.steps.length) {
      this.refreshHint();
      return;
    }
    wx.navigateTo({ url: '/packageFollow/pages/follow/follow' });
  },

  /**
   * 校验后求解。已经还原就只提示。求出步骤后进入跟着转。
   */
  async onSolve() {
    if (this.data.solving) return;
    const problem = countError(this.facelets);
    if (problem) {
      this.refreshHint();
      wx.showToast({ title: problem, icon: 'none' });
      return;
    }
    const diag = diagnoseFacelets(this.facelets);
    if (diag.message) {
      this.refreshHint();
      wx.showToast({ title: '有格子不合法，转一转看标红', icon: 'none' });
      return;
    }
    if (this.facelets === SOLVED) {
      wx.showToast({ title: '已经是还原状态', icon: 'none' });
      return;
    }
    this.setData({ solving: true });
    wx.showLoading({ title: '正在还原…', mask: true });
    try {
      const res = await solver.solve(this.facelets);
      const tokens = res.solution.split(/\s+/).filter(Boolean);
      const steps = tokens.map((token, i) => ({
        no: i + 1,
        token,
        desc: describeMove(token)
      }));
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.solution = {
          state: this.facelets,
          solution: res.solution,
          tokens,
          steps,
          moveCount: res.moveCount,
          solveMs: res.solveMs
        };
      }
      this.setData({ solving: false });
      wx.navigateTo({ url: '/packageFollow/pages/follow/follow' });
    } catch (err) {
      let message = err.message || '求解失败';
      if (/Invalid cube|Corner|Edge|Parity|twist|flip/i.test(message)) {
        message = explainVerify(message) || message;
      }
      wx.showModal({ title: '没能还原', content: message, showCancel: false });
      this.setData({ solving: false });
    } finally {
      wx.hideLoading();
    }
  }
});
