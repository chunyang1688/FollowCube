// 首页只做入口：填色、拍照、练一练。跟着转从填色页进去，不单独放在首页。
Page({
  onPaint() {
    wx.navigateTo({ url: '/packageFollow/pages/paint/paint' });
  },

  onCamera() {
    wx.navigateTo({ url: '/packageCamera/pages/camera/camera' });
  },

  /** 练一练不依赖已经求出的步骤，打开就是一颗还原好的魔方。 */
  onPractice() {
    wx.navigateTo({ url: '/packageFollow/pages/practice/practice' });
  }
});
