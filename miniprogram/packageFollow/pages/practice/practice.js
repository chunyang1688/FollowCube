// 练一练：从还原好的魔方开始。可以自己转面，也可以随机打乱后看步骤还原。
// 解法只留在本页，不写进 globalData，避免跟「跟着转」串味。
const { describeMove, invertToken } = require('../../../utils/turns.js');
const { randomScramble } = require('../../../utils/scramble.js');
const { explainVerify } = require('../../../utils/colors.js');
const solver = require('../../../services/solver.js');
const { createCubeScene } = require('../../utils/cube3d.js');

const SPEED = {
  low: { move: 1100, gap: 420, name: '低速' },
  mid: { move: 560, gap: 180, name: '中速' },
  high: { move: 260, gap: 40, name: '高速' }
};
const MANUAL_MS = 320;
const SCRAMBLE_MS = 150;
const FREE_HINT = '滑动色块转这一面，滑动空白处换个角度看';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Page({
  data: {
    mode: 'free',
    hint: '这是还原好的魔方。' + FREE_HINT,
    view3d: true,
    view3dTip: '',
    busy: false,
    autoPlay: false,
    speed: 'mid',
    speeds: [
      { key: 'low', name: '低速' },
      { key: 'mid', name: '中速' },
      { key: 'high', name: '高速' }
    ],
    stepLine: '',
    atStart: true,
    atEnd: false
  },

  /** 预热求解器，并记下本页自己的步骤，不跟首页的解法混在一起。 */
  onLoad() {
    this.scene = null;
    this.tokens = [];
    this.cursor = 0;
    this._pageGone = false;
    this._initing = false;
    this._locked = false;
    this._seq = 0;
    this._auto = false;
    this._rect = null;
    this._gesture = null;
    solver.preload();
  },

  /** 首屏画布有时比 onLoad 更晚挂上，这里再试一次初始化。 */
  onReady() {
    this.init3D();
  },

  /** 离开页面时停掉打乱和自动还原，并释放 WebGL。 */
  onUnload() {
    this._pageGone = true;
    this._seq += 1;
    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }
  },

  /** 取 WebGL 画布。节点刚出现时经常是空的，所以会重试。 */
  init3D() {
    if (this._pageGone || this.scene || this._initing) return;
    this._initing = true;
    this.queryCanvas(8);
  },

  /** 取 #practice-canvas。left 是剩余重试次数，间隔 60ms。 */
  queryCanvas(left) {
    if (this._pageGone || this.scene) {
      this._initing = false;
      return;
    }
    const query = typeof this.createSelectorQuery === 'function'
      ? this.createSelectorQuery()
      : wx.createSelectorQuery();
    query.select('#practice-canvas').fields({ node: true, size: true }).exec((res) => {
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
        this.setData({ view3d: false, view3dTip: '这个设备打不开立体魔方' });
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
        scene = createCubeScene({
          canvas: item.node,
          width: item.width,
          height: item.height,
          pixelRatio: dpr,
          moveDuration: MANUAL_MS
        });
      } catch (err) {
        scene = null;
      }
      this._initing = false;
      if (!scene) {
        this.setData({ view3d: false, view3dTip: '这个设备打不开立体魔方' });
        return;
      }
      this.scene = scene;
      this.scene.resetSolved();
      this.setData({ view3d: true });
      this.measure();
    });
  },

  /** 记下画布在屏幕上的位置，后面把触摸换算成画布内坐标。 */
  measure() {
    const query = typeof this.createSelectorQuery === 'function'
      ? this.createSelectorQuery()
      : wx.createSelectorQuery();
    query.select('#practice-canvas').boundingClientRect((rect) => {
      if (rect) this._rect = rect;
    }).exec();
  },

  /**
   * 从还原好的状态播一段随机打乱。每一步都是合法转动，所以之后一定解得开。
   * 打乱过程中再次进入会先作废上一轮，避免两段动画叠在一起。
   */
  async onScramble() {
    if (!this.scene || this._locked) return;
    const seq = ++this._seq;
    this.tokens = [];
    this.cursor = 0;
    this._locked = true;
    this.setData({
      mode: 'free',
      autoPlay: false,
      busy: true,
      hint: '正在打乱…'
    });
    this.scene.resetSolved();
    this.scene.setMoveDuration(SCRAMBLE_MS);
    const { tokens } = randomScramble(15);
    for (let i = 0; i < tokens.length; i++) {
      if (this._pageGone || seq !== this._seq) {
        this._locked = false;
        return;
      }
      try {
        await this.scene.playMove(tokens[i]);
      } catch (err) {
        this._locked = false;
        if (!this._pageGone) this.setData({ busy: false, hint: FREE_HINT });
        return;
      }
    }
    this._locked = false;
    if (this._pageGone || seq !== this._seq) return;
    this.setData({
      busy: false,
      hint: '打乱好了。可以自己转回去，也可以点「还原」看步骤'
    });
  },

  /**
   * 按当前魔方求出步骤，进入上一步 / 下一步 / 自动。
   * 已经还原、或颜色在物理上不存在时，不进入步骤模式。
   */
  async onRestore() {
    if (!this.scene || this._locked) return;
    if (this.scene.isSolved()) {
      wx.showToast({ title: '已经是还原状态', icon: 'none' });
      return;
    }
    const seq = ++this._seq;
    this._locked = true;
    this.setData({ busy: true, hint: '正在想步骤…' });
    wx.showLoading({ title: '正在还原…', mask: true });
    try {
      const res = await solver.solve(this.scene.getState());
      if (this._pageGone || seq !== this._seq) {
        this._locked = false;
        if (!this._pageGone) this.setData({ busy: false, hint: FREE_HINT });
        return;
      }
      const tokens = res.solution.split(/\s+/).filter(Boolean);
      this.tokens = tokens;
      this.cursor = 0;
      this._locked = false;
      this.setData({
        mode: 'guide',
        busy: false,
        autoPlay: false,
        speed: this.data.speed || 'mid',
        hint: '看清这一步再转。速度可以随时换'
      });
      this.refreshGuide();
    } catch (err) {
      this._locked = false;
      if (this._pageGone) return;
      let message = (err && err.message) || '求解失败';
      if (/Invalid cube|Corner|Edge|Parity|twist|flip/i.test(message)) {
        message = explainVerify(message) || message;
      }
      this.setData({ busy: false, hint: FREE_HINT });
      wx.showModal({ title: '没能还原', content: message, showCancel: false });
    } finally {
      wx.hideLoading();
    }
  },

  /** 刷新「第几步、转哪一面」。cursor 是已经做完的步数。 */
  refreshGuide() {
    const total = this.tokens.length;
    const i = this.cursor;
    let stepLine = '共 ' + total + ' 步';
    if (!total) stepLine = '没有步骤';
    else if (i >= total) stepLine = '已经还原';
    else stepLine = '第 ' + (i + 1) + ' / ' + total + ' 步 · ' + describeMove(this.tokens[i]);
    this.setData({
      stepLine,
      atStart: i <= 0,
      atEnd: i >= total
    });
  },

  /** 离开步骤模式，魔方停在当前样子，可以继续自己转。 */
  onLeaveGuide() {
    this._seq += 1;
    this._auto = false;
    this.setData({
      mode: 'free',
      autoPlay: false,
      hint: this.scene && this.scene.isSolved()
        ? '已经还原。可以再随机打乱，或自己转着玩'
        : FREE_HINT
    });
  },

  /** 切换自动播放和单步的速度。正在转的那一步仍用原来的时长。 */
  onSpeed(e) {
    const speed = e.currentTarget.dataset.speed;
    if (!SPEED[speed]) return;
    this.setData({ speed });
  },

  /** 播放一步。dir 为 1 向前，为 -1 时反向转回上一步。正在转时直接拒绝。 */
  async playGuideStep(dir) {
    if (this._locked || !this.scene) return false;
    const token = dir > 0
      ? this.tokens[this.cursor]
      : invertToken(this.tokens[this.cursor - 1] || '');
    if (!token) return false;
    const pace = SPEED[this.data.speed] || SPEED.mid;
    this._locked = true;
    this.setData({ busy: true });
    this.scene.setMoveDuration(pace.move);
    try {
      await this.scene.playMove(token);
    } catch (err) {
      this._locked = false;
      if (!this._pageGone) this.setData({ busy: false });
      return false;
    }
    if (this._pageGone) return false;
    this.cursor += dir;
    this._locked = false;
    this.refreshGuide();
    this.setData({ busy: false });
    if (dir > 0 && this.cursor >= this.tokens.length) {
      wx.showToast({ title: '还原完成', icon: 'success' });
    }
    return true;
  },

  /** 把上一步反向转回去。自动播放时不响应，避免和自动抢同一步。 */
  async onPrev() {
    if (this._auto || this._locked || this.cursor <= 0) return;
    await this.playGuideStep(-1);
  },

  /** 播放尚未完成的下一步。自动播放时不响应。 */
  async onNext() {
    if (this._auto || this._locked || this.cursor >= this.tokens.length) return;
    await this.playGuideStep(1);
  },

  /** 自动按当前速度把剩下的步骤转完。再点一次停止，已经转出去的那一步会转完。 */
  async onAuto() {
    if (this._auto) {
      this._auto = false;
      this.setData({ autoPlay: false });
      return;
    }
    if (this.data.mode !== 'guide' || this._locked) return;
    if (this.cursor >= this.tokens.length) {
      wx.showToast({ title: '已经还原', icon: 'none' });
      return;
    }
    const seq = this._seq;
    this._auto = true;
    this.setData({ autoPlay: true });
    while (!this._pageGone && seq === this._seq && this._auto && this.cursor < this.tokens.length) {
      const ok = await this.playGuideStep(1);
      if (!ok || seq !== this._seq || !this._auto) break;
      const pace = SPEED[this.data.speed] || SPEED.mid;
      await sleep(pace.gap);
    }
    if (!this._pageGone && seq === this._seq) {
      this._auto = false;
      this.setData({ autoPlay: false });
    }
  },

  /** 点在色块上准备转那一面，点在空白处准备转视角。双指则改为缩放。 */
  onTouchStart(e) {
    const touches = e.touches || [];
    const t = touches[0];
    if (!t || !this.scene) return;
    if (touches.length >= 2) {
      this._pinch = this.distance(touches[0], touches[1]);
      this._gesture = null;
      return;
    }
    const rect = this._rect;
    const canTurn = this.data.mode === 'free' && !this._locked && !this.data.busy;
    let pick = null;
    if (canTurn && rect) {
      pick = this.scene.pickFace(
        t.clientX - rect.left,
        t.clientY - rect.top,
        rect.width,
        rect.height
      );
    }
    this._gesture = { x: t.clientX, y: t.clientY, lx: t.clientX, ly: t.clientY, pick };
    this.measure();
  },

  /** 空白处拖动时转动视角。点在色块上先不转，等松手再决定转哪一面。 */
  onTouchMove(e) {
    if (!this.scene) return;
    const touches = e.touches || [];
    if (touches.length >= 2) {
      const dist = this.distance(touches[0], touches[1]);
      if (this._pinch > 0 && dist > 0) this.scene.zoomBy(this._pinch / dist);
      this._pinch = dist;
      this._gesture = null;
      return;
    }
    const g = this._gesture;
    const t = touches[0];
    if (!g || !t) return;
    const dx = t.clientX - g.lx;
    const dy = t.clientY - g.ly;
    g.lx = t.clientX;
    g.ly = t.clientY;
    // 点在色块上时等松手再转那一面；点在空白处则跟着手指转视角
    if (g.pick) return;
    this.scene.orbitBy(dx, dy);
  },

  /** 松手。只有从色块上滑出足够距离，才转那一面。 */
  onTouchEnd(e) {
    const g = this._gesture;
    this._gesture = null;
    this._pinch = 0;
    if (!g || !g.pick || !this.scene) return;
    const t = (e.changedTouches || [])[0] || {};
    const dx = (t.clientX || g.x) - g.x;
    const dy = (t.clientY || g.y) - g.y;
    this.commitTurn(g.pick, dx, dy);
  },

  /** 松手后按拖动方向转一面。转动被拒绝时不改提示，避免和上一段动画打架。 */
  async commitTurn(pick, dx, dy) {
    if (!this.scene || this._locked || this.data.mode !== 'free') return;
    const token = this.scene.turnFromDrag(pick, dx, dy);
    if (!token) return;
    this._locked = true;
    this.setData({ busy: true, hint: describeMove(token) });
    this.scene.setMoveDuration(MANUAL_MS);
    try {
      await this.scene.playMove(token);
    } catch (err) {
      this._locked = false;
      if (!this._pageGone) this.setData({ busy: false, hint: FREE_HINT });
      return;
    }
    this._locked = false;
    if (this._pageGone) return;
    const solved = this.scene.isSolved();
    this.setData({
      busy: false,
      hint: solved ? '自己转回来了' : FREE_HINT
    });
    if (solved) wx.showToast({ title: '还原成功', icon: 'success' });
  },

  /** 两个触点的屏幕距离，用来判断双指是在放大还是缩小。 */
  distance(a, b) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }
});
