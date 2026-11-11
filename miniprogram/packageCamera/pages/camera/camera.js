// 拍照填色（分包）：camera 取景 -> 拍照 -> Canvas 2D 取像素 -> 九宫格对齐 -> 识别 -> 回填首页
// 照片只在本地内存处理，不上传、不留存；图像 IO 之外复用 vision.js 的纯算法。
const {
  COLOR_ORDER,
  COLOR_HEX,
  COLOR_NAME,
  PHOTO_STEPS,
  FACE_SLOTS
} = require('../../../utils/colors.js');
const V = require('../../utils/vision.js');

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

Page({
  data: {
    stage: 'guide', // guide | capture | align | confirm
    faceIndex: 0,
    current: null,
    faceStates: [],
    palette: [],
    boxSize: 320,
    photoPath: '',
    rect: { x: 0, y: 0, w: 0, h: 0, angleDeg: 0 },
    guideStyle: '',
    resultCells: [],
    editIndex: -1,
    activeColor: 'U',
    tips: '',
    uncertain: 0,
    centerMismatch: false,
    privacyOk: false,
    ready: false
  },

  onLoad() {
    let win = { windowWidth: 375, pixelRatio: 2 };
    try {
      win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    } catch (err) {
      win = { windowWidth: 375, pixelRatio: 2 };
    }
    const boxSize = Math.max(240, Math.floor(Math.min((win.windowWidth || 375) - 32, 380)));
    this.size = boxSize;
    this.cameraCtx = null;
    this.imageData = null;
    this.pendingColors = null;
    this.palette = V.defaultPalette();
    this.facelets = this.blankFacelets();
    this._touch = null;
    this._pinch = null;
    this._busy = false;

    this.setData({
      boxSize,
      palette: COLOR_ORDER.map((key) => ({
        key,
        name: COLOR_NAME[key],
        hex: COLOR_HEX[key]
      })),
      faceStates: this.buildFaceStates(),
      current: PHOTO_STEPS[0]
    });
    this.selectFace(0);
    this.checkPrivacy();
  },

  onReady() {
    this.setData({ ready: true });
  },

  onUnload() {
    if (this.cameraCtx) this.cameraCtx = null;
    this.imageData = null;
  },

  blankFacelets() {
    const arr = Array(54).fill('?');
    COLOR_ORDER.forEach((face, i) => {
      arr[i * 9 + 4] = face;
    });
    return arr;
  },

  buildFaceStates() {
    return PHOTO_STEPS.map((step, i) => {
      const base = COLOR_ORDER.indexOf(step.face) * 9;
      const filled = FACE_SLOTS.every((slot) => this.facelets[base + slot] !== '?');
      return {
        index: i,
        face: step.face,
        label: step.centerColor + '心',
        hex: COLOR_HEX[step.face],
        filled,
        current: i === this.data.faceIndex
      };
    });
  },

  refreshFaceStates() {
    this.setData({
      faceStates: this.buildFaceStates(),
      current: PHOTO_STEPS[this.data.faceIndex]
    });
  },

  selectFace(index) {
    const i = clamp(index, 0, 5);
    // 切换面时清理上一面的照片像素与待确认结果，避免内存残留与跨面误读
    this.imageData = null;
    this.pendingColors = null;
    this.setData({ faceIndex: i, stage: 'guide', tips: '', editIndex: -1 });
    this.refreshFaceStates();
  },

  onSelectFace(e) {
    this.selectFace(Number(e.currentTarget.dataset.index));
  },

  // —— 隐私与相机授权 ——

  checkPrivacy() {
    if (typeof wx.getPrivacySetting !== 'function') {
      this.setData({ privacyOk: true });
      return;
    }
    wx.getPrivacySetting({
      success: (res) => {
        this.setData({ privacyOk: !res.needAuthorization });
      },
      fail: () => this.setData({ privacyOk: true })
    });
  },

  ensureAuthorized() {
    return new Promise((resolve) => {
      const askCamera = () => {
        wx.authorize({
          scope: 'scope.camera',
          success: () => {
            this.setData({ privacyOk: true });
            resolve(true);
          },
          fail: () => {
            wx.showModal({
              title: '需要相机权限',
              content: '请在设置中开启相机权限，用于拍摄魔方六个面。照片仅在本机处理，不会上传。',
              confirmText: '去设置',
              success: (r) => {
                if (r.confirm) wx.openSetting({ fail: () => {} });
              }
            });
            resolve(false);
          }
        });
      };

      if (typeof wx.getPrivacySetting !== 'function') {
        askCamera();
        return;
      }
      wx.getPrivacySetting({
        success: (res) => {
          if (!res.needAuthorization || typeof wx.requirePrivacyAuthorize !== 'function') {
            askCamera();
            return;
          }
          wx.requirePrivacyAuthorize({
            success: askCamera,
            fail: () => {
              wx.showToast({ title: '需先同意隐私保护指引', icon: 'none' });
              resolve(false);
            }
          });
        },
        fail: askCamera
      });
    });
  },

  /** 相册选图不申请相机权限，但同样要先满足隐私保护指引 */
  ensurePrivacyOnly() {
    return new Promise((resolve) => {
      if (typeof wx.getPrivacySetting !== 'function') {
        resolve(true);
        return;
      }
      wx.getPrivacySetting({
        success: (res) => {
          if (!res.needAuthorization || typeof wx.requirePrivacyAuthorize !== 'function') {
            resolve(true);
            return;
          }
          wx.requirePrivacyAuthorize({
            success: () => resolve(true),
            fail: () => {
              wx.showToast({ title: '需先同意隐私保护指引', icon: 'none' });
              resolve(false);
            }
          });
        },
        fail: () => resolve(true)
      });
    });
  },

  async onStartCapture() {
    const ok = await this.ensureAuthorized();
    if (!ok) return;
    this.setData({ stage: 'capture', tips: '' });
  },

  onCameraError() {
    wx.showModal({
      title: '相机暂不可用',
      content: '可以改用「从相册选一张」录入这一面，或直接返回手工填色。',
      showCancel: false
    });
  },

  onCancelCapture() {
    this.setData({ stage: 'guide' });
  },

  onTakePhoto() {
    if (this._busy) return;
    if (!this.cameraCtx) this.cameraCtx = wx.createCameraContext();
    this._busy = true;
    wx.showLoading({ title: '处理照片…', mask: true });
    this.cameraCtx.takePhoto({
      quality: 'high',
      success: (res) => this.prepareAlign(res.tempImagePath),
      fail: () => {
        this._busy = false;
        wx.hideLoading();
        wx.showToast({ title: '拍照失败，可改用相册选图', icon: 'none' });
      }
    });
  },

  async onChooseImage() {
    const ok = await this.ensurePrivacyOnly();
    if (!ok) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (file && file.tempFilePath) {
          wx.showLoading({ title: '处理照片…', mask: true });
          this.prepareAlign(file.tempFilePath);
        }
      },
      fail: () => {}
    });
  },

  // —— 图像 IO：把照片画进离屏 Canvas 2D 并取 RGBA 像素 ——

  loadImageData(path) {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .select('#px-canvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const item = res && res[0];
          if (!item || !item.node || typeof item.node.createImage !== 'function') {
            reject(new Error('画布不可用，请升级微信后重试'));
            return;
          }
          const canvas = item.node;
          const size = this.size;
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          const img = canvas.createImage();
          img.onload = () => {
            try {
              ctx.fillStyle = '#111111';
              ctx.fillRect(0, 0, size, size);
              const layout = V.fitPhotoLayout(img.width, img.height, size);
              ctx.drawImage(img, layout.dx, layout.dy, layout.dw, layout.dh);
              const image = ctx.getImageData(0, 0, size, size);
              resolve({ image, layout });
            } catch (err) {
              reject(err);
            }
          };
          img.onerror = () => reject(new Error('图片读取失败'));
          img.src = path;
        });
    });
  },

  async prepareAlign(path) {
    try {
      const { image, layout } = await this.loadImageData(path);
      this.imageData = image;
      const auto = V.clampGuideRect(V.detectFaceRect(image, layout), this.size);
      // 自动框常偏小，默认放大一点，方便用户微调
      const cx = auto.x + auto.w / 2;
      const cy = auto.y + auto.h / 2;
      const side = Math.min(this.size * 0.9, auto.w * 1.12);
      const rect = V.clampGuideRect(
        { x: cx - side / 2, y: cy - side / 2, w: side, h: side, angle: 0 },
        this.size
      );
      this.setData({
        stage: 'align',
        photoPath: path,
        rect: this.toViewRect(rect),
        guideStyle: this.toGuideStyle(rect),
        tips: '拖动九宫格对齐六个面贴纸；双指缩放，或用下方按钮微调。'
      });
    } catch (err) {
      wx.showModal({
        title: '照片处理失败',
        content: (err && err.message) || '请换一张照片重试',
        showCancel: false
      });
      this.setData({ stage: 'guide' });
    } finally {
      this._busy = false;
      wx.hideLoading();
    }
  },

  toViewRect(rect) {
    return {
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      angleDeg: ((rect.angle || 0) * 180) / Math.PI
    };
  },

  toGuideStyle(rect) {
    return (
      'left:' + rect.x + 'px;top:' + rect.y + 'px;' +
      'width:' + rect.w + 'px;height:' + rect.h + 'px;' +
      'transform:rotate(' + (((rect.angle || 0) * 180) / Math.PI).toFixed(2) + 'deg);'
    );
  },

  fromViewRect() {
    const r = this.data.rect;
    return {
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      angle: (r.angleDeg * Math.PI) / 180
    };
  },

  updateRect(next) {
    const fixed = V.clampGuideRect(next, this.size);
    this.setData({ rect: this.toViewRect(fixed), guideStyle: this.toGuideStyle(fixed) });
  },

  // —— 九宫格对齐手势（只用相对位移，无需换算页面坐标） ——

  onTouchStart(e) {
    const touches = e.touches || [];
    if (touches.length >= 2) {
      this._touch = null;
      this._pinch = {
        dist: this.distance(touches[0], touches[1]),
        angle: this.angleOf(touches[0], touches[1])
      };
      return;
    }
    if (!touches.length) return;
    this._pinch = null;
    this._touch = { x: touches[0].clientX, y: touches[0].clientY };
  },

  onTouchMove(e) {
    const touches = e.touches || [];
    const r = this.fromViewRect();
    if (touches.length >= 2) {
      const dist = this.distance(touches[0], touches[1]);
      const angle = this.angleOf(touches[0], touches[1]);
      const p = this._pinch || { dist, angle };
      const scale = p.dist > 0 && dist > 0 ? clamp(dist / p.dist, 0.85, 1.18) : 1;
      const side = r.w * scale;
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      this._pinch = { dist, angle };
      this.updateRect({
        x: cx - side / 2,
        y: cy - side / 2,
        w: side,
        h: side,
        angle: r.angle + (angle - p.angle)
      });
      return;
    }
    if (!this._touch || !touches.length) return;
    const t = touches[0];
    const dx = t.clientX - this._touch.x;
    const dy = t.clientY - this._touch.y;
    this._touch = { x: t.clientX, y: t.clientY };
    this.updateRect({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h, angle: r.angle });
  },

  onTouchEnd() {
    this._touch = null;
    this._pinch = null;
  },

  distance(a, b) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  },

  angleOf(a, b) {
    return Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);
  },

  onSizeIn() {
    const r = this.fromViewRect();
    const side = r.w * 1.08;
    this.updateRect({
      x: r.x + r.w / 2 - side / 2,
      y: r.y + r.h / 2 - side / 2,
      w: side,
      h: side,
      angle: r.angle
    });
  },

  onSizeOut() {
    const r = this.fromViewRect();
    const side = r.w / 1.08;
    this.updateRect({
      x: r.x + r.w / 2 - side / 2,
      y: r.y + r.h / 2 - side / 2,
      w: side,
      h: side,
      angle: r.angle
    });
  },

  onRotateLeft() {
    const r = this.fromViewRect();
    this.updateRect({ x: r.x, y: r.y, w: r.w, h: r.h, angle: r.angle - Math.PI / 24 });
  },

  onRotateRight() {
    const r = this.fromViewRect();
    this.updateRect({ x: r.x, y: r.y, w: r.w, h: r.h, angle: r.angle + Math.PI / 24 });
  },

  onResetGuide() {
    const side = this.size * 0.72;
    this.updateRect({
      x: (this.size - side) / 2,
      y: (this.size - side) / 2,
      w: side,
      h: side,
      angle: 0
    });
  },

  // —— 识别与人工校正 ——

  onRecognize() {
    if (!this.imageData) {
      wx.showToast({ title: '请先拍一张照片', icon: 'none' });
      return;
    }
    const face = PHOTO_STEPS[this.data.faceIndex].face;
    const result = V.analyzeFace(this.imageData, face, this.palette, this.fromViewRect());
    this.palette = result.palette;
    this.pendingColors = result.colors.slice();
    const msgs = [];
    if (result.centerMismatch) {
      msgs.push('中心色不太像' + COLOR_NAME[face] + '，请确认拿的是这一面，或重拍');
    }
    if (result.uncertain) msgs.push('有 ' + result.uncertain + ' 格不确定（已标灰），点格子后选颜色可手改');
    if (!msgs.length) msgs.push('识别完成，核对下方九格；有误可点格子后选颜色修正');
    this.setData({
      stage: 'confirm',
      rect: this.toViewRect(result.rect),
      guideStyle: this.toGuideStyle(result.rect),
      resultCells: this.buildResultCells(),
      editIndex: -1,
      uncertain: result.uncertain,
      centerMismatch: result.centerMismatch,
      tips: msgs.join('；')
    });
  },

  buildResultCells() {
    return this.pendingColors.map((color, i) => ({
      idx: i,
      color,
      hex: COLOR_HEX[color] || COLOR_HEX['?'],
      name: COLOR_NAME[color] || '未确定',
      isCenter: i === 4,
      editing: i === this.data.editIndex
    }));
  },

  onCellTap(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (idx === 4) {
      wx.showToast({ title: '中心色固定', icon: 'none' });
      return;
    }
    this.setData({ editIndex: idx, resultCells: this.buildResultCells() });
  },

  onPaletteTap(e) {
    const color = e.currentTarget.dataset.key;
    this.setData({ activeColor: color });
    if (this.data.editIndex < 0 || !this.pendingColors) return;
    this.pendingColors[this.data.editIndex] = color;
    this.setData({
      resultCells: this.buildResultCells(),
      uncertain: this.pendingColors.filter((c) => c === '?').length,
      tips: '已手动修正，确认无误后点「确认这一面」'
    });
  },

  onRetake() {
    this.imageData = null;
    this.pendingColors = null;
    this.selectFace(this.data.faceIndex);
  },

  onBackToAlign() {
    this.setData({ stage: 'align', editIndex: -1 });
  },

  onConfirmFace() {
    if (!this.pendingColors) return;
    const face = PHOTO_STEPS[this.data.faceIndex].face;
    const base = COLOR_ORDER.indexOf(face) * 9;
    for (let i = 0; i < 9; i++) {
      this.facelets[base + i] = i === 4 ? face : this.pendingColors[i];
    }
    const left = this.pendingColors.filter((c) => c === '?').length;
    if (left) {
      wx.showModal({
        title: '还有 ' + left + ' 格未确定',
        content: '建议先点灰色格并选颜色补全，否则首页会提示颜色数量不对。',
        confirmText: '仍要继续',
        cancelText: '去补全',
        success: (r) => {
          if (r.confirm) this.advance();
        }
      });
      return;
    }
    this.advance();
  },

  advance() {
    const next = this.nextUnfilled(this.data.faceIndex);
    this.refreshFaceStates();
    if (next < 0) {
      this.finishAll();
      return;
    }
    wx.showToast({ title: '本面已录入', icon: 'success', duration: 700 });
    this.selectFace(next);
  },

  nextUnfilled(afterIndex) {
    for (let k = 1; k <= 6; k++) {
      const idx = (afterIndex + k) % 6;
      const face = PHOTO_STEPS[idx].face;
      const base = COLOR_ORDER.indexOf(face) * 9;
      if (!FACE_SLOTS.every((slot) => this.facelets[base + slot] !== '?')) return idx;
    }
    return -1;
  },

  finishAll() {
    const app = getApp();
    if (app && app.globalData) app.globalData.capturedFacelets = this.facelets.slice();
    wx.showModal({
      title: '六面录入完成',
      content: '已把识别结果带回展开图，请核对颜色与合法性提示后再求解。照片不会上传或保存。',
      showCancel: false,
      success: () => wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/index/index' }) })
    });
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/index/index' }) });
  }
});
