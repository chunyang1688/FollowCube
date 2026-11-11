// FollowCube 小程序入口
// 隐私说明：拍照填色会调用摄像头 / 相册读取照片，照片仅在本机内存处理，
// 不上传、不留存、不写入本地文件。相关授权与《用户隐私保护指引》检查在
// packageCamera/pages/camera 页内完成（wx.getPrivacySetting / wx.requirePrivacyAuthorize /
// wx.authorize('scope.camera')），以微信官方最新规则为准。
App({
  globalData: {
    // 54 位颜色，顺序 U R F D L B。null 表示还没填过，填色页会显示只剩中心色的魔方
    facelets: null,
    // 当前求解结果，供跟做页读取
    solution: null, // { state, solution, tokens, steps, moveCount, solveMs }
    solverReady: false,
    // 拍照页写完六面后交给填色页，填色页 onShow 取用后清空
    capturedFacelets: null
  },

  onLaunch() {
    // 无账号体系、无网络请求、无本地持久化；核心功能免登录可用。
  }
});
