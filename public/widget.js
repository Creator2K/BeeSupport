/*!
 * BeeSupport 访客端嵌入脚本
 * 用法：<script src="https://your-beesupport-host/widget.js?key=<站点密钥>" async></script>
 *
 * 可选参数：
 *   position=left|right   气泡位置（默认站点配置）
 *   color=%23RRGGBB       气泡主色（默认站点配置）
 *   label=在线客服        气泡旁边的文字
 *   style=bubble|rounded|pill|outline|soft|avatar  按钮样式（默认站点配置）
 */
(function () {
  "use strict";

  var script =
    document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName("script");
      return scripts[scripts.length - 1];
    })();

  if (!script || !script.src) return;

  var source;
  try {
    source = new URL(script.src, window.location.href);
  } catch (error) {
    return;
  }

  var siteKey = source.searchParams.get("key");
  if (!siteKey) {
    console.warn("[BeeSupport] 嵌入脚本缺少 key 参数，已跳过初始化");
    return;
  }

  var appOrigin = source.origin;
  var forcedPosition = source.searchParams.get("position");
  var forcedColor = source.searchParams.get("color");
  var forcedLabel = source.searchParams.get("label");
  var forcedStyle = source.searchParams.get("style");
  var launcherStyles = [
    "bubble",
    "rounded",
    "pill",
    "outline",
    "soft",
    "avatar",
  ];
  if (launcherStyles.indexOf(forcedStyle) === -1) forcedStyle = null;

  var MOBILE_BREAKPOINT = 480;
  var LAUNCHER_MARGIN = 12;
  var launcherStorageKey = "beesupport:launcher-position:" + appOrigin + ":" + siteKey;

  var state = {
    open: false,
    lightbox: false,
    unread: 0,
    ready: false,
    position: forcedPosition === "left" ? "left" : "right",
    color: normalizeHex(forcedColor || "#18181b"),
    launcherStyle: forcedStyle || "bubble",
    launcherDraggable: false,
    label: forcedLabel !== null ? forcedLabel.slice(0, 20) : "在线客服",
    logoUrl: "",
  };

  var elements = {};
  var cleanups = [];
  var destroyed = false;
  var launcherLocation = null;
  function listen(target, event, handler) {
    target.addEventListener(event, handler);
    cleanups.push(function () {
      target.removeEventListener(event, handler);
    });
  }

  /* ---------------- 颜色工具 ---------------- */

  function normalizeHex(value) {
    var hex = String(value || "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
      return (
        "#" +
        hex[1] +
        hex[1] +
        hex[2] +
        hex[2] +
        hex[3] +
        hex[3]
      ).toLowerCase();
    }
    return "#18181b";
  }

  /** percent > 0 提亮，< 0 压暗 */
  function shade(hex, percent) {
    var color = normalizeHex(hex);
    var value = percent < 0 ? 0 : 255;
    var ratio = Math.abs(percent) / 100;
    var parts = [1, 3, 5].map(function (offset) {
      var channel = parseInt(color.substr(offset, 2), 16);
      return Math.round((value - channel) * ratio) + channel;
    });
    return (
      "#" +
      parts
        .map(function (channel) {
          var text = channel.toString(16);
          return text.length === 1 ? "0" + text : text;
        })
        .join("")
    );
  }

  function foreground(hex) {
    var channels = [1, 3, 5].map(function (offset) {
      var value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    var luminance =
      channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    return luminance > 0.179 ? "#000000" : "#ffffff";
  }

  function safeLogo(value) {
    try {
      var url = new URL(value);
      return /^https?:$/.test(url.protocol) && !url.username && !url.password
        ? url.href
        : "";
    } catch (error) {
      return "";
    }
  }

  /* ---------------- 环境信息（宿主页面才是最准的） ---------------- */

  function detectBrowser(ua) {
    var checks = [
      [/Edg[A-Z]?\//, "Edge"],
      [/OPR\/|Opera/, "Opera"],
      [/MicroMessenger/i, "微信内置浏览器"],
      [/QQBrowser/, "QQ 浏览器"],
      [/UCBrowser/, "UC 浏览器"],
      [/Firefox\//, "Firefox"],
      [/Chrome\//, "Chrome"],
      [/Safari\//, "Safari"],
      [/MSIE |Trident\//, "IE"],
    ];
    for (var i = 0; i < checks.length; i += 1) {
      if (checks[i][0].test(ua)) return checks[i][1];
    }
    return "";
  }

  function detectOs(ua) {
    if (/Windows NT 10/.test(ua)) return "Windows 10/11";
    if (/Windows NT/.test(ua)) return "Windows";
    if (/iPhone|iPad|iPod/.test(ua)) return "iOS/iPadOS";
    if (/Android/.test(ua)) return "Android";
    if (/Mac OS X/.test(ua)) return "macOS";
    if (/HarmonyOS/.test(ua)) return "HarmonyOS";
    if (/Linux/.test(ua)) return "Linux";
    return "";
  }

  function detectDevice(ua) {
    if (/iPad|Tablet/i.test(ua)) return "平板";
    if (/Mobi|Android|iPhone/i.test(ua)) return "手机";
    if (navigator.maxTouchPoints > 1) return "触屏设备";
    return "桌面端";
  }

  function describeConnection() {
    var connection =
      navigator.connection ||
      navigator.mozConnection ||
      navigator.webkitConnection;
    if (!connection) return "";
    var parts = [];
    if (connection.effectiveType) parts.push(String(connection.effectiveType));
    if (typeof connection.downlink === "number") {
      parts.push(connection.downlink + "Mbps");
    }
    if (typeof connection.rtt === "number") parts.push(connection.rtt + "ms");
    if (connection.saveData) parts.push("省流量");
    return parts.join(" / ");
  }

  function collectEnv() {
    var ua = navigator.userAgent || "";
    var env = {
      pageUrl: window.location.href,
      pageTitle: document.title,
      referrer: document.referrer || "",
      host: window.location.origin,
      locale: navigator.language || "",
      languages: (navigator.languages || []).join(","),
      timezone: "",
      tzOffset: new Date().getTimezoneOffset(),
      screen: window.screen.width + "x" + window.screen.height,
      viewport: window.innerWidth + "x" + window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      colorScheme:
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light",
      platform: navigator.platform || "",
      device: detectDevice(ua),
      browser: detectBrowser(ua),
      os: detectOs(ua),
      ua: ua,
      mobile: /Mobi|Android|iPhone|iPad|iPod/i.test(ua),
      touchPoints: navigator.maxTouchPoints || 0,
      cpu: navigator.hardwareConcurrency || 0,
      memory: navigator.deviceMemory || 0,
      connection: describeConnection(),
      cookies: navigator.cookieEnabled === true,
      dnt: navigator.doNotTrack === "1",
    };

    try {
      env.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (error) {
      env.timezone = "";
    }

    return env;
  }

  /* ---------------- 页面切换（SPA 也要能追踪） ---------------- */

  var lastUrl = "";

  function currentPage() {
    return { page: window.location.href, title: document.title || "" };
  }

  function reportNavigation() {
    if (!state.ready) return;
    var url = window.location.href;
    if (url === lastUrl) return;
    lastUrl = url;
    post({
      type: "beesupport:navigate",
      page: url,
      title: document.title || "",
    });
  }

  function watchNavigation() {
    ["pushState", "replaceState"].forEach(function (name) {
      var original = history[name];
      if (typeof original !== "function") return;
      var wrapped = function () {
        var result = original.apply(this, arguments);
        setTimeout(reportNavigation, 0);
        return result;
      };
      history[name] = wrapped;
      cleanups.push(function () {
        if (history[name] === wrapped) history[name] = original;
      });
    });

    listen(window, "popstate", function () {
      setTimeout(reportNavigation, 0);
    });
    listen(window, "hashchange", reportNavigation);

    // 兜底：某些框架不经过 history API
    var timer = setInterval(reportNavigation, 2000);
    cleanups.push(function () {
      clearInterval(timer);
    });
  }

  /** 把宿主页面的真实环境信息推给客服窗口 */
  function pushEnv() {
    post({ type: "beesupport:env", env: collectEnv() });
  }

  /* ---------------- 样式 ---------------- */

  function injectStyles() {
    if (document.getElementById("beesupport-widget-style")) return;

    var style = document.createElement("style");
    style.id = "beesupport-widget-style";
    style.textContent = [
      "@keyframes bee-launcher-in{from{opacity:0;transform:translateY(8px) scale(.8)}to{opacity:1;transform:none}}",
      "@keyframes bee-panel-in{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}",
      "@keyframes bee-badge-pop{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}",
      "@keyframes bee-halo{0%{transform:scale(1);opacity:.55}100%{transform:scale(1.65);opacity:0}}",
      ".beesupport-launcher{cursor:pointer;animation:bee-launcher-in .5s cubic-bezier(.22,1,.36,1) .12s both}",
      ".beesupport-launcher:hover{transform:translateY(-2px) scale(1.04)}",
      ".beesupport-launcher:active{transform:translateY(0) scale(.96)}",
      ".beesupport-launcher.is-draggable:not(.is-open){cursor:grab;touch-action:none;user-select:none}",
      ".beesupport-launcher.is-draggable.is-dragging{cursor:grabbing;animation:none;transform:none;transition:none}",
      ".beesupport-launcher:focus-visible{outline:3px solid #18181b;outline-offset:4px}",
      ".beesupport-launcher .bee-icon{transition:opacity .2s ease,transform .28s cubic-bezier(.22,1,.36,1)}",
      ".beesupport-launcher .bee-icon-close{position:absolute;opacity:0;transform:rotate(-60deg) scale(.6)}",
      ".beesupport-launcher.is-open .bee-icon-chat,.beesupport-launcher.is-open .bee-icon-headset,.beesupport-launcher.is-open .bee-avatar{opacity:0;transform:rotate(60deg) scale(.6)}",
      ".beesupport-launcher.is-open .bee-icon-close{opacity:1;transform:none}",
      ".beesupport-halo{position:absolute;inset:0;border-radius:inherit;background:currentColor;opacity:0;pointer-events:none;animation:bee-halo 1.9s ease-out 1.2s 2}",
      ".beesupport-launcher .bee-avatar{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit;transition:opacity .2s ease,transform .28s ease}",
      ".beesupport-launcher .bee-launcher-label{overflow:hidden;text-overflow:ellipsis;min-width:0}",
      ".beesupport-badge{animation:bee-badge-pop .28s cubic-bezier(.22,1,.36,1) both}",
      ".beesupport-panel{animation:bee-panel-in .24s cubic-bezier(.22,1,.36,1) both}",
      "@media (prefers-reduced-motion: reduce){.beesupport-launcher,.beesupport-panel,.beesupport-badge,.beesupport-halo{animation:none!important}.beesupport-launcher:hover,.beesupport-launcher:active{transform:none}}",
    ].join("");
    document.head.appendChild(style);
  }

  /* ---------------- 悬浮气泡 ---------------- */

  function launcherIcon(kind) {
    if (kind === "close") {
      return (
        '<svg class="bee-icon bee-icon-close" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M6 9.5l6 6 6-6"/></svg>'
      );
    }

    if (kind === "headset") {
      return '<svg class="bee-icon bee-icon-headset" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11a9 9 0 0 1 18 0v6a4 4 0 0 1-4 4h-3"/><rect x="2" y="10" width="5" height="8" rx="2"/><rect x="17" y="10" width="5" height="8" rx="2"/></svg>';
    }

    // 圆角对话气泡 + 尾巴 + 三个点：几何图形拼出来，边缘干净不糊
    return (
      '<svg class="bee-icon bee-icon-chat" width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<rect x="2.6" y="3.4" width="18.8" height="13.4" rx="4.2" stroke="currentColor" stroke-width="1.75"/>' +
      '<path d="M8.6 16.9v3.9l4.4-3.9" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="7.6" cy="10.1" r="1.15" fill="currentColor"/>' +
      '<circle cx="12" cy="10.1" r="1.15" fill="currentColor"/>' +
      '<circle cx="16.4" cy="10.1" r="1.15" fill="currentColor"/>' +
      "</svg>"
    );
  }

  function createLauncher() {
    var button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", "在线客服");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "beesupport-widget-panel");
    button.className = "beesupport-launcher";
    button.style.cssText = [
      "position:fixed",
      "box-sizing:border-box",
      "max-width:calc(100vw - 44px)",
      "width:58px",
      "height:58px",
      "border-radius:9999px",
      "border:0",
      "z-index:2147483000",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:0",
      "line-height:0",
      "overflow:visible",
      "transition:transform .22s cubic-bezier(.22,1,.36,1),box-shadow .22s ease",
    ].join(";");

    var halo = document.createElement("span");
    halo.className = "beesupport-halo";
    halo.style.color = state.color;
    button.appendChild(halo);

    var iconWrap = document.createElement("span");
    iconWrap.style.cssText =
      "position:relative;display:flex;flex-shrink:0;align-items:center;justify-content:center;width:26px;height:26px";
    iconWrap.innerHTML =
      launcherIcon("chat") + launcherIcon("headset") + launcherIcon("close");
    button.appendChild(iconWrap);

    var text = document.createElement("span");
    text.className = "bee-launcher-label";
    text.style.cssText =
      "position:relative;font:600 14px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif;white-space:nowrap;margin-left:10px;letter-spacing:.2px";
    button.appendChild(text);

    var avatar = document.createElement("img");
    avatar.className = "bee-avatar";
    avatar.alt = "";
    avatar.draggable = false;
    avatar.referrerPolicy = "no-referrer";
    avatar.style.display = "none";
    avatar.addEventListener("error", function () {
      avatar.style.display = "none";
      button.classList.remove("has-avatar");
    });
    button.appendChild(avatar);

    var badge = document.createElement("span");
    badge.className = "beesupport-badge";
    badge.style.cssText = [
      "position:absolute",
      "top:-3px",
      "right:-3px",
      "min-width:20px",
      "height:20px",
      "border-radius:9999px",
      "background:#b91c1c",
      "color:#fff",
      "font:600 11px/20px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      "text-align:center",
      "padding:0 6px",
      "display:none",
      "box-shadow:0 0 0 2.5px #fff,0 2px 6px rgba(0,0,0,.18)",
    ].join(";");
    button.appendChild(badge);

    bindLauncherInput(button);

    elements.launcher = button;
    elements.halo = halo;
    elements.badge = badge;
    elements.label = text;
    elements.avatar = avatar;
    elements.iconWrap = iconWrap;

    applyLauncherPosition(button);
    applyLauncherTheme();
    document.body.appendChild(button);
  }

  function applyLauncherPosition(button) {
    if (state.launcherDraggable && launcherLocation) {
      button.style.left = clampLauncherOffset(
        launcherLocation.left,
        document.documentElement.clientWidth - button.offsetWidth,
      ) + "px";
      button.style.top = clampLauncherOffset(
        launcherLocation.top,
        window.innerHeight - button.offsetHeight,
      ) + "px";
      button.style.right = "auto";
      button.style.bottom = "auto";
      return;
    }
    button.style.top = "auto";
    button.style.bottom = "max(22px,env(safe-area-inset-bottom,0px))";
    if (state.position === "left") {
      button.style.left = "22px";
      button.style.right = "auto";
    } else {
      button.style.right = "22px";
      button.style.left = "auto";
    }
  }

  function clampLauncherOffset(value, available) {
    var edge = Math.min(LAUNCHER_MARGIN, Math.max(0, available) / 2);
    return Math.max(edge, Math.min(value, available - edge));
  }

  function readLauncherLocation() {
    try {
      var location = JSON.parse(window.localStorage.getItem(launcherStorageKey));
      if (location && Number.isFinite(location.left) && Number.isFinite(location.top))
        return location;
    } catch (error) {
      // The embedded widget still works on sites that disallow local storage.
    }
    return null;
  }

  function bindLauncherInput(button) {
    var drag = null;
    var suppressPointerClick = false;

    listen(button, "pointerdown", function (event) {
      if (!event.isPrimary || event.button !== 0 || drag) return;
      suppressPointerClick = false;
      if (!state.launcherDraggable || state.open) return;
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: button.offsetLeft,
        top: button.offsetTop,
        previousLocation: launcherLocation,
        moved: false,
      };
      button.setPointerCapture(event.pointerId);
    });

    listen(button, "pointermove", function (event) {
      if (!drag || event.pointerId !== drag.id || !state.launcherDraggable) return;
      var dx = event.clientX - drag.x;
      var dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 7) return;
      drag.moved = true;
      button.classList.add("is-dragging");
      launcherLocation = { left: drag.left + dx, top: drag.top + dy };
      applyLauncherPosition(button);
    });

    function finishDrag(event, commit) {
      if (!drag || event.pointerId !== drag.id) return;
      var completed = drag;
      drag = null;
      button.classList.remove("is-dragging");
      if (!completed.moved) return;
      suppressPointerClick = true;
      if (commit && state.launcherDraggable) {
        launcherLocation = { left: button.offsetLeft, top: button.offsetTop };
        try {
          window.localStorage.setItem(launcherStorageKey, JSON.stringify(launcherLocation));
        } catch (error) {
          // Preserve the position on this page even when storage is unavailable.
        }
      } else {
        launcherLocation = completed.previousLocation;
      }
      applyLauncherPosition(button);
    }

    listen(button, "pointerup", function (event) {
      finishDrag(event, true);
    });
    listen(button, "pointercancel", function (event) {
      finishDrag(event, false);
    });
    listen(button, "lostpointercapture", function (event) {
      finishDrag(event, false);
    });
    listen(button, "click", function (event) {
      if (suppressPointerClick && event.detail !== 0) {
        suppressPointerClick = false;
        return;
      }
      toggle();
    });
  }

  function applyLauncherTheme() {
    var button = elements.launcher;
    if (!button) return;

    var base = state.color;
    var kind = state.launcherStyle;
    var showLabel =
      ["pill", "outline", "soft"].indexOf(kind) !== -1 ||
      (!!forcedLabel && kind !== "avatar");
    var light = kind === "outline" || kind === "soft";
    button.dataset.launcherStyle = kind;
    button.style.background =
      kind === "outline" ? "#ffffff" : kind === "soft" ? shade(base, 92) : base;
    button.style.color = light ? shade(base, -65) : foreground(base);
    button.style.border =
      kind === "outline"
        ? "2px solid " + base
        : kind === "avatar"
          ? "3px solid #ffffff"
          : "0px solid transparent";
    button.style.borderRadius = kind === "rounded" ? "18px" : "9999px";
    button.style.boxShadow =
      "0 8px 24px -6px rgba(15,23,42,.24), 0 2px 8px rgba(15,23,42,.08)";
    button.style.width = showLabel ? "auto" : "58px";
    button.style.padding = showLabel ? "0 20px" : "0";
    elements.label.textContent = state.label.trim() || "在线客服";
    elements.label.style.display = showLabel ? "block" : "none";
    button.setAttribute(
      "aria-label",
      state.open ? "关闭客服窗口" : state.label.trim() || "在线客服",
    );
    elements.iconWrap.querySelector(".bee-icon-chat").style.display =
      kind === "avatar" ? "none" : "block";
    elements.iconWrap.querySelector(".bee-icon-headset").style.display =
      kind === "avatar" ? "block" : "none";
    if (kind === "avatar" && state.logoUrl) {
      if (elements.avatar.getAttribute("src") !== state.logoUrl) {
        elements.avatar.style.display = "block";
        elements.avatar.src = state.logoUrl;
      }
    } else elements.avatar.style.display = "none";

    if (elements.halo) {
      elements.halo.style.color = base;
      elements.halo.style.display =
        light || kind === "avatar" ? "none" : "block";
    }
    if (elements.badge) {
      elements.badge.style.boxShadow =
        "0 0 0 2.5px " + shade(base, 72) + ",0 2px 6px rgba(0,0,0,.18)";
    }
  }

  /* ---------------- 聊天面板 ---------------- */

  function createFrame() {
    var container = document.createElement("div");
    container.id = "beesupport-widget-panel";
    container.className = "beesupport-panel";
    container.style.cssText = [
      "position:fixed",
      "bottom:94px",
      "z-index:2147483000",
      "display:none",
      "overflow:hidden",
      "background:#fff",
      "box-shadow:0 24px 60px -18px rgba(15,23,42,.34),0 6px 18px -8px rgba(15,23,42,.2)",
      "border-radius:18px",
      "border:1px solid rgba(15,23,42,.08)",
    ].join(";");

    var iframe = document.createElement("iframe");
    iframe.title = "在线客服";
    iframe.referrerPolicy = "origin";
    iframe.setAttribute("allow", "clipboard-write");
    iframe.style.cssText =
      "width:100%;height:100%;border:0;display:block;background:#fff";

    var params = new URLSearchParams();
    params.set("key", siteKey);
    if (source.searchParams.get("preview"))
      params.set("preview", source.searchParams.get("preview"));
    params.set("host", window.location.origin);
    params.set("page", window.location.href);
    if (document.title) params.set("title", document.title);
    if (document.referrer) params.set("ref", document.referrer);
    iframe.src = appOrigin + "/widget?" + params.toString();

    container.appendChild(iframe);
    applyFrameLayout(container, iframe);

    elements.container = container;
    elements.iframe = iframe;
    document.body.appendChild(container);

    listen(window, "resize", function () {
      applyLauncherPosition(elements.launcher);
      applyFrameLayout(container, iframe);
    });
  }

  function applyFrameLayout(container, iframe) {
    if (state.lightbox || window.innerWidth < MOBILE_BREAKPOINT) {
      container.style.top = "0";
      container.style.left = "0";
      container.style.right = "0";
      container.style.bottom = "0";
      container.style.width = "100%";
      container.style.height = "100%";
      container.style.borderRadius = "0";
      container.style.border = "0";
      container.style.boxShadow = "none";
      iframe.style.height = "100%";
      return;
    }

    container.style.top = "auto";
    container.style.bottom = "94px";
    container.style.width = "400px";
    container.style.height = "min(640px, calc(100vh - 124px))";
    container.style.borderRadius = "18px";
    container.style.border = "1px solid rgba(15,23,42,.08)";
    container.style.boxShadow =
      "0 24px 60px -18px rgba(15,23,42,.34),0 6px 18px -8px rgba(15,23,42,.2)";

    if (state.position === "left") {
      container.style.left = "22px";
      container.style.right = "auto";
    } else {
      container.style.right = "22px";
      container.style.left = "auto";
    }
    if (state.open && state.launcherDraggable && launcherLocation) {
      var button = elements.launcher;
      var width = Math.min(400, document.documentElement.clientWidth - 2 * LAUNCHER_MARGIN);
      var above = button.offsetTop - 2 * LAUNCHER_MARGIN;
      var below = window.innerHeight - button.offsetTop - button.offsetHeight - 2 * LAUNCHER_MARGIN;
      var opensAbove = above >= below;
      var alignRight = button.offsetLeft + button.offsetWidth / 2 > document.documentElement.clientWidth / 2;
      container.style.width = width + "px";
      container.style.height = Math.min(640, Math.max(0, above, below)) + "px";
      container.style.left = clampLauncherOffset(
        button.offsetLeft + (alignRight ? button.offsetWidth - width : 0),
        document.documentElement.clientWidth - width,
      ) + "px";
      container.style.right = "auto";
      container.style.top = opensAbove ? "auto" : button.offsetTop + button.offsetHeight + LAUNCHER_MARGIN + "px";
      container.style.bottom = opensAbove ? window.innerHeight - button.offsetTop + LAUNCHER_MARGIN + "px" : "auto";
    }
    iframe.style.height = "100%";
  }

  /* ---------------- 开关 / 未读 ---------------- */

  function open() {
    if (state.open) return;
    state.open = true;
    applyFrameLayout(elements.container, elements.iframe);
    elements.container.style.display = "block";
    // 重新播放入场动画
    elements.container.style.animation = "none";
    void elements.container.offsetWidth;
    elements.container.style.animation = "";
    if (elements.launcher) {
      elements.launcher.classList.add("is-open");
      elements.launcher.setAttribute("aria-expanded", "true");
      elements.launcher.setAttribute("aria-label", "关闭客服窗口");
    }
    clearUnread();
    post({ type: "beesupport:opened" });
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    state.lightbox = false;
    applyFrameLayout(elements.container, elements.iframe);
    elements.container.style.display = "none";
    if (elements.launcher) {
      elements.launcher.classList.remove("is-open");
      elements.launcher.setAttribute("aria-expanded", "false");
      elements.launcher.setAttribute(
        "aria-label",
        state.label.trim() || "在线客服",
      );
    }
    post({ type: "beesupport:closed" });
  }

  function toggle() {
    if (state.open) close();
    else open();
  }

  function post(message) {
    if (elements.iframe && elements.iframe.contentWindow) {
      elements.iframe.contentWindow.postMessage(message, appOrigin);
    }
  }

  function clearUnread() {
    state.unread = 0;
    renderBadge();
  }

  function renderBadge() {
    if (!elements.badge) return;
    if (state.unread > 0) {
      elements.badge.textContent =
        state.unread > 99 ? "99+" : String(state.unread);
      if (elements.badge.style.display !== "block") {
        elements.badge.style.display = "block";
        elements.badge.style.animation = "none";
        void elements.badge.offsetWidth;
        elements.badge.style.animation = "";
      }
    } else {
      elements.badge.style.display = "none";
    }
  }

  function applyTheme(config) {
    if (!config) return;
    if (
      launcherStyles.indexOf(config.launcherStyle) !== -1 &&
      !forcedStyle
    )
      state.launcherStyle = config.launcherStyle;
    if (
      typeof config.launcherLabel === "string" &&
      forcedLabel === null
    )
      state.label = config.launcherLabel.slice(0, 20);
    state.logoUrl = safeLogo(config.logoUrl);
    if (config.position && !forcedPosition) {
      state.position = config.position === "left" ? "left" : "right";
    }

    if (config.primaryColor && !forcedColor) {
      state.color = normalizeHex(config.primaryColor);
    }
    if (!state.launcherDraggable && config.launcherDraggable === true)
      launcherLocation = readLauncherLocation();
    state.launcherDraggable = config.launcherDraggable === true;
    applyLauncherTheme();
    elements.launcher.classList.toggle("is-draggable", state.launcherDraggable);
    applyLauncherPosition(elements.launcher);
    applyFrameLayout(elements.container, elements.iframe);
  }

  /* ---------------- 通信 ---------------- */

  listen(window, "message", function (event) {
    if (event.origin !== appOrigin) return;
    if (!elements.iframe || event.source !== elements.iframe.contentWindow)
      return;
    var data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "beesupport:lightbox") {
      state.lightbox = data.open === true;
      applyFrameLayout(elements.container, elements.iframe);
    } else if (data.type === "beesupport:ready") {
      state.ready = true;
      if (state.open) post({ type: "beesupport:opened" });
      applyTheme(data.site);
      renderBadge();
      pushEnv();
      reportNavigation();
      lastUrl = window.location.href;
    } else if (data.type === "beesupport:unread") {
      state.unread = state.open ? 0 : Number(data.count) || 0;
      renderBadge();
    } else if (data.type === "beesupport:close") {
      close();
    } else if (data.type === "beesupport:open") {
      open();
    }
  });

  /* ---------------- 初始化 ---------------- */

  function init() {
    if (destroyed) return;
    if (!document.body) {
      listen(window, "DOMContentLoaded", init);
      return;
    }
    injectStyles();
    createLauncher();
    createFrame();
    renderBadge();
    watchNavigation();
    listen(window, "resize", debounce(pushEnv, 400));
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fn, wait);
    };
  }

  var pending = [];
  if (window.BeeSupport && Array.isArray(window.BeeSupport.q)) {
    pending = window.BeeSupport.q;
  }

  window.BeeSupport = {
    open: open,
    close: close,
    toggle: toggle,
    isOpen: function () {
      return state.open;
    },
    setUnread: function (count) {
      state.unread = Number(count) || 0;
      renderBadge();
    },
    destroy: function () {
      destroyed = true;
      cleanups.forEach(function (cleanup) {
        cleanup();
      });
      cleanups = [];
      if (elements.launcher && elements.launcher.parentNode) {
        elements.launcher.parentNode.removeChild(elements.launcher);
      }
      if (elements.container && elements.container.parentNode) {
        elements.container.parentNode.removeChild(elements.container);
      }
      state.open = false;
      state.ready = false;
      elements = {};
      delete window.BeeSupport;
    },
  };

  init();

  pending.forEach(function (fn) {
    try {
      fn(window.BeeSupport);
    } catch (error) {
      /* 忽略调用方异常 */
    }
  });
})();
