// 首页只做入口：填色、拍照、练一练、跟着转。颜色和求解都在后面的页面。
Page({
  data: {
    followTip: '先填色或拍照，求出步骤后再来'
  },

  /** 有解法时改掉「跟着转」下面那句说明 */
  onShow() {
    const app = getApp();
    const solution = app && app.globalData ? app.globalData.solution : null;
    const followTip = solution && solution.moveCount
      ? '已有 ' + solution.moveCount + ' 步，点这里一步步转'
      : '先填色或拍照，求出步骤后再来';
    this.setData({ followTip });
  },

  onPaint() {
    wx.navigateTo({ url: '/packageFollow/pages/paint/paint' });
  },

  onCamera() {
    wx.navigateTo({ url: '/packageCamera/pages/camera/camera' });
  },

  /** 练一练不依赖已经求出的步骤，打开就是一颗还原好的魔方。 */
  onPractice() {
    wx.navigateTo({ url: '/packageFollow/pages/practice/practice' });
  },

  /** 还没求出步骤时只提示，不进入空白的跟做页 */
  onFollow() {
    const app = getApp();
    const solution = app && app.globalData ? app.globalData.solution : null;
    if (!solution || !solution.steps || !solution.steps.length) {
      wx.showToast({ title: '先填色或拍照', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/packageFollow/pages/follow/follow' });
  }
});
