// 首页：手工填色 + 合法性诊断 + Kociemba 求解（逻辑由 spike/phase0 迁移）
const {
  COLOR_ORDER,
  COLOR_HEX,
  COLOR_NAME,
  FACE_TITLE,
  NET_LAYOUT,
  emptyFacelets,
  solvedFacelets,
  countColors,
  centersOk,
  countError,
  diagnoseFacelets,
  explainVerify
} = require('../../utils/colors.js');
const { randomScramble } = require('../../utils/scramble.js');
const { describeMove } = require('../../utils/turns.js');
const solver = require('../../services/solver.js');

Page({
  data: {
    faces: [],
    palette: [],
    activeColor: 'U',
    solverReady: false,
    solverStatus: '求解器准备中…',
    countsText: '',
    hint: '',
    hasError: false,
    solving: false,
    steps: [],
    moveCount: 0,
    solveMs: 0,
    solutionText: '',
    canFollow: false
  },

  onShow() {
    // 拍照页完成六面录入后，通过 globalData 回填（分包与主包共享 JS 运行环境）
    const app = getApp();
    const captured = app && app.globalData ? app.globalData.capturedFacelets : null;
    if (!captured || captured.length !== 54) return;
    app.globalData.capturedFacelets = null;
    this.facelets = captured.slice();
    this.clearSolution();
    this.refresh();
    wx.showToast({ title: '已填入拍照识别结果', icon: 'none' });
  },

  onLoad() {
    this.facelets = solvedFacelets(); // 默认从已还原开始，点「示例打乱」即可体验
    this.errorCells = [];

    this.setData({
      palette: COLOR_ORDER.map((key) => ({
        key,
        name: COLOR_NAME[key],
        hex: COLOR_HEX[key]
      }))
    });
    this.refresh();

    // 提前启动 Worker，把 initSolver（约 1s，真机更久）藏在用户填色期间
    solver.preload();
    solver.onReady(() => {
      this.setData({ solverReady: true, solverStatus: '求解器已就绪' });
    });
    solver.onInitError((message) => {
      this.setData({
        solverStatus: '求解器启动失败：' + message
      });
    });
    this._readyTimer = setTimeout(() => {
      if (!solver.isReady()) {
        this.setData({
          solverStatus: '求解器启动较慢，请稍候；若一直不就绪请重启小程序'
        });
      }
    }, 8000);
  },

  onUnload() {
    // E-09：页面销毁清理定时器（Worker 是全局单例，不在此 terminate）
    if (this._readyTimer) clearTimeout(this._readyTimer);
  },

  /** 由 54 位 facelets 构造 WXML 需要的展开图数据 */
  buildFaces() {
    const errorSet = new Set(this.errorCells || []);
    return NET_LAYOUT.map((layout) => {
      const faceIndex = COLOR_ORDER.indexOf(layout.face);
      const cells = [];
      for (let slot = 0; slot < 9; slot++) {
        const gi = faceIndex * 9 + slot;
        const isCenter = slot === 4;
        const color = isCenter ? layout.face : this.facelets[gi];
        cells.push({
          gi,
          color,
          hex: COLOR_HEX[color] || COLOR_HEX['?'],
          isCenter,
          error: !isCenter && errorSet.has(gi)
        });
      }
      return {
        face: layout.face,
        title: FACE_TITLE[layout.face],
        row: layout.row,
        col: layout.col,
        cells
      };
    });
  },

  /** 重算展开图、颜色计数与合法性提示 */
  refresh() {
    const countProblem = countError(this.facelets);
    const diag = diagnoseFacelets(this.facelets);
    this.errorCells = diag.cells;

    const counts = countColors(this.facelets);
    const countsText =
      COLOR_ORDER.map((c) => COLOR_NAME[c] + counts[c]).join('  ') +
      (counts['?'] ? '   未填 ' + counts['?'] : '');

    let hint = '颜色齐全且合法，点「求解」即可。';
    let hasError = false;
    if (countProblem) {
      hint = countProblem;
    } else if (!centersOk(this.facelets)) {
      hint = '中心色不对，请检查六个面的中心格';
      hasError = true;
    } else if (diag.message) {
      hint = diag.message;
      hasError = true;
    }

    // 54 格结构仅数 KB，整体重建比逐路径维护标红更可靠；
    // 若后续扩展为大列表，再切换为 setData 局部路径更新（避免一次传整个 data）。
    this.setData({ faces: this.buildFaces(), countsText, hint, hasError });
  },

  onPaletteTap(e) {
    this.setData({ activeColor: e.currentTarget.dataset.key });
  },

  onCellTap(e) {
    const gi = Number(e.currentTarget.dataset.gi);
    if (gi % 9 === 4) {
      wx.showToast({ title: '中心色固定', icon: 'none' });
      return;
    }
    this.facelets[gi] = this.data.activeColor;
    this.clearSolution();
    this.refresh();
  },

  onSample() {
    // 每次生成一个「新的随机合法打乱」，供反复练习（不再是固定示例串）
    const { state } = randomScramble(22);
    this.facelets = state.split('');
    this.clearSolution();
    this.refresh();
  },

  onSolved() {
    this.facelets = solvedFacelets();
    this.clearSolution();
    this.refresh();
  },

  onClear() {
    this.facelets = emptyFacelets();
    // 中心格固定，清空后补回中心色，保证计数与 centersOk 一致
    COLOR_ORDER.forEach((face, i) => {
      this.facelets[i * 9 + 4] = face;
    });
    this.clearSolution();
    this.refresh();
  },

  clearSolution() {
    const app = getApp();
    if (app && app.globalData) app.globalData.solution = null;
    this.setData({
      steps: [],
      moveCount: 0,
      solveMs: 0,
      solutionText: '',
      canFollow: false
    });
  },

  async onSolve() {
    if (this.data.solving) return;

    const countProblem = countError(this.facelets);
    if (countProblem) {
      wx.showToast({ title: countProblem, icon: 'none' });
      return;
    }
    if (!centersOk(this.facelets)) {
      this.refresh();
      wx.showToast({ title: '中心色不对', icon: 'none' });
      return;
    }
    const diag = diagnoseFacelets(this.facelets);
    if (diag.message) {
      this.refresh();
      wx.showToast({ title: '有格子不合法，请看标红', icon: 'none' });
      return;
    }

    const state = this.facelets.join('');
    this.setData({ solving: true });
    wx.showLoading({ title: '求解中…', mask: true });

    try {
      const res = await solver.solve(state);
      const tokens = res.solution.split(/\s+/).filter(Boolean);
      const steps = tokens.map((token, i) => ({
        no: i + 1,
        token,
        desc: describeMove(token)
      }));
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.solution = {
          state,
          solution: res.solution,
          tokens,
          steps,
          moveCount: res.moveCount,
          solveMs: res.solveMs
        };
      }
      this.setData({
        solving: false,
        steps,
        moveCount: res.moveCount,
        solveMs: res.solveMs,
        solutionText: res.solution,
        canFollow: true
      });
    } catch (err) {
      let message = err.message || '求解失败';
      // Worker 回传的 verify 错误是英文，转成中文人话
      if (/Invalid cube|Corner|Edge|Parity|twist|flip/i.test(message)) {
        message = explainVerify(message) || message;
      }
      wx.showModal({ title: '没能求解', content: message, showCancel: false });
      this.setData({ solving: false });
    } finally {
      wx.hideLoading();
    }
  },

  onGoFollow() {
    if (!this.data.canFollow) return;
    wx.navigateTo({ url: '/packageFollow/pages/follow/follow' });
  },

  onGoCamera() {
    wx.navigateTo({ url: '/packageCamera/pages/camera/camera' });
  }
});
