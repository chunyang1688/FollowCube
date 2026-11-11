// 跟做页（分包）：3D 视图 + 中文步骤双轨，3D 不可用时仍可完整跟做
const { invertToken } = require('../../../utils/turns.js');
const { createCubeScene } = require('../../utils/cube3d.js');

Page({
  data: {
    empty: true,
    steps: [],
    index: 0,
    total: 0,
    progress: 0,
    current: null,
    done: false,
    solutionText: '',
    view3d: true,
    view3dTip: '',
    animating: false,
    autoPlay: false
  },

  onLoad() {
    const app = getApp();
    const solution = app && app.globalData ? app.globalData.solution : null;
    this.tokens = [];
    this.cursor = 0;
    this.scene = null;
    this._pageGone = false;
    this._touch = null;
    this._pinchDist = 0;

    if (!solution || !solution.steps || !solution.steps.length) {
      this.setData({ empty: true });
      return;
    }
    this.tokens = solution.tokens || solution.steps.map((s) => s.token);
    this.setData({
      empty: false,
      steps: solution.steps,
      total: solution.steps.length,
      solutionText: solution.solution
    });
    this.setCursor(0);
  },

  onReady() {
    if (this.data.empty) return;
    this.init3D();
  },

  onUnload() {
    this._pageGone = true;
    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }
  },

  init3D() {
    const query = wx.createSelectorQuery();
    query
      .select('#cube-canvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (this._pageGone) return;
        const item = res && res[0];
        if (!item || !item.node || !item.width || !item.height) {
          this.fallback3D('当前环境未取到画布，可继续按文字步骤跟做');
          return;
        }
        let dpr = 2;
        try {
          dpr = wx.getWindowInfo
            ? wx.getWindowInfo().pixelRatio
            : wx.getSystemInfoSync().pixelRatio;
        } catch (err) {
          dpr = 2;
        }
        let scene = null;
        try {
          scene = createCubeScene({
            canvas: item.node,
            width: item.width,
            height: item.height,
            pixelRatio: dpr,
            moveDuration: 420
          });
        } catch (err) {
          scene = null;
        }
        if (!scene) {
          this.fallback3D('当前设备不支持 3D 视图，可继续按文字步骤跟做');
          return;
        }
        this.scene = scene;
        this.scene.setScramble(this.tokens);
        this.setData({ view3d: true, view3dTip: '' });
      });
  },

  fallback3D(tip) {
    this.scene = null;
    this.setData({ view3d: false, view3dTip: tip });
  },

  /** index 表示「已完成的步数」，0 = 还没开始，total = 全部完成 */
  setCursor(cursor) {
    const total = this.data.total;
    const i = Math.max(0, Math.min(cursor, total));
    this.cursor = i;
    this.setData({
      index: i,
      done: i >= total,
      current: i < total ? this.data.steps[i] : null,
      progress: total ? Math.round((i / total) * 100) : 0
    });
  },

  async playNext() {
    if (this._pageGone || this.data.animating || this.cursor >= this.data.total) return false;
    const token = this.tokens[this.cursor];
    this.setData({ animating: true });
    if (this.scene) {
      await this.scene.playMove(token);
    } else {
      // 降级为文字跟做时也给自动演示留出阅读节奏，避免瞬间跳到最后一步
      await new Promise((resolve) => setTimeout(resolve, 360));
    }
    if (this._pageGone) return false;
    this.setCursor(this.cursor + 1);
    this.setData({ animating: false });
    return true;
  },

  async onNext() {
    if (this.data.autoPlay) return;
    await this.playNext();
  },

  onPrev() {
    if (this.data.animating || this.data.autoPlay || this.cursor <= 0) return;
    const token = this.tokens[this.cursor - 1];
    if (this.scene) this.scene.instantMove(invertToken(token));
    this.setCursor(this.cursor - 1);
  },

  onRestart() {
    if (this.data.animating) return;
    this.setData({ autoPlay: false });
    if (this.scene) this.scene.setScramble(this.tokens);
    this.setCursor(0);
  },

  async onAutoPlay() {
    if (this.data.autoPlay) {
      this.setData({ autoPlay: false });
      return;
    }
    if (this.data.done) {
      if (this.scene) this.scene.setScramble(this.tokens);
      this.setCursor(0);
    }
    this.setData({ autoPlay: true });
    while (this.data.autoPlay && !this._pageGone && this.cursor < this.data.total) {
      const ok = await this.playNext();
      if (!ok) break;
    }
    if (!this._pageGone) this.setData({ autoPlay: false });
  },

  onZoomIn() {
    if (this.scene) this.scene.zoomBy(0.85);
  },

  onZoomOut() {
    if (this.scene) this.scene.zoomBy(1.18);
  },

  onResetCamera() {
    if (this.scene) this.scene.resetCamera();
    wx.showToast({ title: '视角已复位', icon: 'none' });
  },

  onTouchStart(e) {
    const touches = e.touches || [];
    if (!touches.length) return;
    if (touches.length >= 2) {
      this._pinchDist = this.distance(touches[0], touches[1]);
      this._touch = null;
      return;
    }
    this._touch = { x: touches[0].clientX, y: touches[0].clientY };
  },

  onTouchMove(e) {
    if (!this.scene) return;
    const touches = e.touches || [];
    if (touches.length >= 2) {
      const dist = this.distance(touches[0], touches[1]);
      if (this._pinchDist > 0 && dist > 0) {
        this.scene.zoomBy(this._pinchDist / dist);
      }
      this._pinchDist = dist;
      return;
    }
    if (!this._touch || !touches.length) return;
    const t = touches[0];
    const dx = t.clientX - this._touch.x;
    const dy = t.clientY - this._touch.y;
    this._touch = { x: t.clientX, y: t.clientY };
    this.scene.orbitBy(dx, dy);
  },

  onTouchEnd() {
    this._touch = null;
    this._pinchDist = 0;
  },

  distance(a, b) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  },

  onBack() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/pages/index/index' })
    });
  }
});
