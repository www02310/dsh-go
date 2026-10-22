/*!
 * DSH Splash · runtime overlay
 * 由 tools/build-overlay.mjs 从 assets/splash.html 生成，请勿直接编辑生成物。
 * 无需改宿主文件：通过 webServer 的 index-inject 注入，启动早期挂一层全屏覆盖层。
 */
(function () {
  'use strict'
  var CSS = @CSS@;
  var MARKUP = @MARKUP@;
  var GLYPHS = @GLYPHS@;

  var META = (typeof window !== 'undefined' && window.__DSH_SPLASH_META__) || {}
  var CFG = (META.config && typeof META.config === 'object') ? META.config : {}
  var NS = 'http://www.w3.org/2000/svg'
  var HOST_ID = 'dsh-splash-overlay-host'
  var SEEN_KEY = '__dsh_splash_seen__'

  // 每个窗口只放一次：HMR 热重载 / 页面刷新不再重复播放
  try {
    if (window.__DSH_SPLASH_BOOTED__) return
    window.__DSH_SPLASH_BOOTED__ = true
    if (CFG.oncePerSession !== false && sessionStorage.getItem(SEEN_KEY) === '1') return
    sessionStorage.setItem(SEEN_KEY, '1')
  } catch (e) {}

  function alive() {
    try { return !!(window.__DSH_SPLASH_META__ && window.__DSH_SPLASH_META__.enabled) } catch (e) { return true }
  }

  var host = null
  var shadow = null
  var removed = false

  function teardown() {
    if (removed) return
    removed = true
    try { if (host && host.parentNode) host.parentNode.removeChild(host) } catch (e) {}
    host = null; shadow = null
  }

  function makeHost() {
    var parent = document.body || document.documentElement
    if (!parent) return null
    var el = document.createElement('div')
    el.id = HOST_ID
    el.setAttribute('aria-hidden', 'true')
    // 立在所有界面之上；宿主窗口自身还是隐藏的，用户看到的第一帧就是它
    el.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483647;'
      + 'pointer-events:auto;background:#0b0d12;contain:strict;'
    parent.appendChild(el)
    return el
  }

  try {
    host = makeHost()
    if (!host) return
    shadow = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : null
    if (!shadow) { teardown(); return }
    var style = document.createElement('style')
    style.textContent = CSS
    shadow.appendChild(style)
    var wrap = document.createElement('div')
    wrap.className = 'splash-root'
    wrap.innerHTML = MARKUP
    shadow.appendChild(wrap)
  } catch (e) {
    teardown()
    return
  }

  var $ = function (id) { try { return shadow.getElementById(id) } catch (e) { return null } }
  var statusEl = null
  try { statusEl = shadow.querySelector('.status') } catch (e) { statusEl = null }

  var WRITE_START = 1150, DUR = 380, STAGGER = 295, T_LOGO = 5680, T_FADE = T_LOGO + 1150
  var started = false, finished = false

  function setVersion() {
    var el = $('ver')
    if (!el) return
    var v = META.version ? String(META.version) : ''
    if (v) el.textContent = 'v' + v
  }

  setVersion()

  // ── 跑马灯点阵依次起跑 ──
  var dots = shadow.querySelectorAll('.marquee i')
  for (var i = 0; i < dots.length; i++) dots[i].style.animationDelay = (i * 0.075) + 's'

  // ── 构建路径：每个字母 = 辉光底 + 亮白笔画 + 笔尖 ──
  var glowG = $('glow'), inkG = $('ink'), pensG = $('pens')
  var items = []
  if (glowG && inkG && pensG) {
    for (var j = 0; j < GLYPHS.length; j++) {
      var g = GLYPHS[j]
      var glow = document.createElementNS(NS, 'path')
      glow.setAttribute('d', g.d)
      glow.setAttribute('transform', 'translate(' + g.tx + ',0) scale(' + g.s + ',' + (-g.s) + ')')
      glowG.appendChild(glow)
      var ink = document.createElementNS(NS, 'path')
      ink.setAttribute('d', g.d)
      ink.setAttribute('transform', 'translate(' + g.tx + ',0) scale(' + g.s + ',' + (-g.s) + ')')
      inkG.appendChild(ink)
      var halo = document.createElementNS(NS, 'circle')
      halo.setAttribute('r', 5.5); halo.setAttribute('class', 'pen-halo')
      var pen = document.createElementNS(NS, 'circle')
      pen.setAttribute('r', 2.4); pen.setAttribute('class', 'pen')
      pensG.appendChild(halo); pensG.appendChild(pen)
      items.push({ ink: ink, glow: glow, halo: halo, pen: pen, L: 0, start: WRITE_START + j * STAGGER })
    }
  }

  // 量取路径长度。注意：窗口还隐藏时宿主可能尚未完成布局，getTotalLength() 会返回 0，
  // 这时不能把 dasharray 写成 "0 0"（会整条描边亮出来）。所以只在长度有效时才落样式，
  // 并把「量不到」交给调用方在后续帧里重试。
  function measure() {
    var ok = 0
    for (var k = 0; k < items.length; k++) {
      var it = items[k]
      try {
        it.L = it.ink.getTotalLength()
      } catch (e) { it.L = 0 }
      if (!it.L || !isFinite(it.L)) { it.L = 0; continue }
      ok++
      it.ink.style.strokeDasharray = it.L + ' ' + it.L
      it.ink.style.strokeDashoffset = it.L
      it.glow.style.strokeDasharray = it.L + ' ' + it.L
      it.glow.style.strokeDashoffset = it.L
    }
    return ok
  }

  function fadeOut(after) {
    if (finished) return
    finished = true
    try { if (host) host.style.transition = 'opacity .42s ease'; host.style.opacity = '0' } catch (e) {}
    setTimeout(function () { teardown(); if (typeof after === 'function') after() }, 460)
  }

  function animate() {
    if (started || finished || !alive()) return
    started = true
    var t0 = null
    var tries = 0
    var degraded = false
    function frame(ts) {
      if (finished) return
      // 首帧先量长度：此时布局一定已经发生过，量不到就等下一帧再试（最多 ~2 秒）
      if (t0 === null) {
        if (!items.length) { t0 = ts } else {
          var ok = 0
          try { ok = measure() } catch (e) { ok = 0 }
          if (ok === 0) {
            if (tries++ < 120) { requestAnimationFrame(frame); return }
            // 实在量不到：退化成「整体淡入」，至少不出现整条描边的怪样子
            degraded = true
            for (var q = 0; q < items.length; q++) {
              try { items[q].ink.classList.add('done') } catch (e2) {}
            }
          }
          t0 = ts
        }
      }
      var now = ts - t0
      for (var m = 0; m < items.length; m++) {
        var p = items[m]
        if (!p.L) continue
        var t = (now - p.start) / DUR
        if (t < 0) continue
        if (t < 1) {
          var e = 1 - Math.pow(1 - t, 3) // easeOutCubic：起笔快、收笔稳
          p.ink.style.strokeDashoffset = p.L * (1 - e)
          p.glow.style.strokeDashoffset = p.L * (1 - e)
          var pt = p.ink.getPointAtLength(p.L * e)
          p.pen.setAttribute('cx', pt.x); p.pen.setAttribute('cy', pt.y)
          p.halo.setAttribute('cx', pt.x); p.halo.setAttribute('cy', pt.y)
          p.pen.style.opacity = 1; p.halo.style.opacity = 1
        } else if (!p.done) {
          p.done = true
          p.ink.style.strokeDashoffset = 0
          p.glow.style.strokeDashoffset = 0
          p.ink.classList.add('done')
          p.pen.style.opacity = 0; p.halo.style.opacity = 0
        }
      }
      if (now > T_LOGO || degraded) {
        var lg = $('logo'), ul = $('underline'), mq = $('marquee')
        if (lg) lg.classList.add('on')
        if (ul) ul.classList.add('on')
        if (mq) mq.classList.add('dim')
        if (statusEl && statusEl.textContent !== '就绪') statusEl.textContent = '就绪'
      }
      if (now > T_FADE || (degraded && now > 2200)) { fadeOut(); return }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }

  // ── 起跑时机：窗口真正可见（获得焦点）时才开始，避免动画在隐藏窗口里白播 ──
  var kicked = false
  function kick(reason) {
    if (kicked || finished) return
    kicked = true
    // 让出一帧，确保覆盖层已经完成首次绘制
    setTimeout(function () { if (alive()) animate(); else fadeOut() }, 90)
  }

  if (CFG.clickToSkip !== false) {
    host.addEventListener('mousedown', function () { if (started) fadeOut(); else kick('click') }, true)
  }

  window.addEventListener('focus', function () { kick('focus') }, { once: true })

  // 兜底：等 React 挂载出内容（窗口即将显示），或硬超时
  function waitRoot() {
    var root = document.getElementById('root')
    if (!root) return false
    if (root.childElementCount > 0) return true
    if (window.MutationObserver) {
      var mo = new MutationObserver(function () {
        if (root.childElementCount > 0) { mo.disconnect(); setTimeout(function () { kick('mount') }, 420) }
      })
      try { mo.observe(root, { childList: true, subtree: false }) } catch (e) {}
    }
    return false
  }
  if (!waitRoot()) {
    var tries = 0
    var iv = setInterval(function () {
      tries++
      if (waitRoot() || tries > 40) clearInterval(iv)
    }, 100)
  }
  setTimeout(function () { kick('timeout') }, 4000)
  // 硬保险：20 秒后无论动画演到哪都收掉，绝不挡住界面
  setTimeout(function () { fadeOut() }, 20000)
})();
