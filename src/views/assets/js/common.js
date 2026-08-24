/**
 * WebStatus 前端公共脚本
 * 依赖：TailwindCSS(CDN) / Chart.js(CDN) / fetch
 * 职责：API 封装(自动 CSRF)、主题切换、状态图标与文案、格式化、Toast、后台侧边栏渲染。
 * 注意：所有动态数据渲染必须经过 esc()，防止 XSS。
 */
const WebStatus = (() => {
  'use strict';

  /* ---------------- 工具 ---------------- */
  function esc(v) {
    if (v === undefined || v === null) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function h(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined && html !== null) e.innerHTML = html;
    return e;
  }

  /* ---------------- CSRF / API ---------------- */
  let csrfToken = null;

  function setCsrf(t) { csrfToken = t; }

  /**
   * API 请求封装
   * - 自动携带 JSON Content-Type 与 X-CSRF-Token
   * - code !== 0 时抛出带 message 的 Error
   */
  async function api(path, options = {}) {
    const opts = { ...options, headers: Object.assign({}, options.headers || {}) };
    if (opts.body !== undefined && opts.body !== null && typeof opts.body !== 'string' && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    if (csrfToken) opts.headers['X-CSRF-Token'] = csrfToken;
    const res = await fetch(path, opts);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const json = await res.json();
      if (json.code && json.code !== 0) {
        const err = new Error(json.message || '请求失败');
        err.code = json.code;
        if (json.code === 401 && !path.startsWith('/api/auth')) {
          // 会话过期，跳转登录
          if (location.pathname.startsWith('/admin')) location.href = '/admin/login';
        }
        throw err;
      }
      return json;
    }
    if (!res.ok) throw new Error('请求失败（' + res.status + '）');
    return res;
  }

  /* ---------------- 主题 ---------------- */
  let dark = localStorage.getItem('ws_dark') === '1';

  function applyTheme() {
    document.documentElement.classList.toggle('dark', dark);
  }

  function toggleTheme() {
    dark = !dark;
    localStorage.setItem('ws_dark', dark ? '1' : '0');
    applyTheme();
  }

  /* ---------------- 状态元信息 ---------------- */
  const STATUS_META = {
    1: { text: '正常', dot: 'bg-emerald-500', textCls: 'text-emerald-600', darkText: 'dark:text-emerald-400', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400', icon: 'check' },
    2: { text: '卡顿', dot: 'bg-amber-500', textCls: 'text-amber-600', darkText: 'dark:text-amber-400', badge: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400', icon: 'alert' },
    3: { text: '离线', dot: 'bg-red-500', textCls: 'text-red-600', darkText: 'dark:text-red-400', badge: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400', icon: 'cross' },
    4: { text: '维修', dot: 'bg-blue-500', textCls: 'text-blue-600', darkText: 'dark:text-blue-400', badge: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-400', icon: 'wrench' },
    0: { text: '未检测', dot: 'bg-slate-400', textCls: 'text-slate-500', darkText: 'dark:text-slate-400', badge: 'bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-700/40 dark:text-slate-300', icon: 'unknown' }
  };

  /* ---------------- SVG 图标（线性细描边，lucide 风格） ---------------- */
  const ICONS = {
    check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    cross: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    unknown: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    alertTriangle: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    restore: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>'
  };

  function icon(name, cls) {
    const body = ICONS[name] || ICONS.info;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="' + (cls || 'w-5 h-5') + '">' + body + '</svg>';
  }

  /* ---------------- 格式化 ---------------- */
  function fmtTime(s) { return s || '-'; }
  function fmtDelay(v) {
    if (v === undefined || v === null) return '-';
    const n = Number(v);
    if (isNaN(n)) return '-';
    if (n < 1) return '<1ms';
    return n.toLocaleString() + ' ms';
  }
  function fmtBytes(b) {
    if (b === undefined || b === null) return '-';
    const n = Number(b);
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function toast(msg, type) {
    let box = document.getElementById('ws-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'ws-toast';
      box.className = 'fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none';
      document.body.appendChild(box);
    }
    const colors = type === 'error' ? 'bg-red-600 text-white'
      : type === 'success' ? 'bg-emerald-600 text-white'
      : 'bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900';
    const t = h('div', 'px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium ' + colors);
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => { t.remove(); }, 3000);
  }

  /* ---------------- 后台侧边栏 ---------------- */
  const MENU = [
    { path: '/admin/dashboard', label: '仪表盘', icon: 'grid' },
    { path: '/admin/sites', label: '站点管理', icon: 'globe' },
    { path: '/admin/notices', label: '公告管理', icon: 'megaphone' },
    { path: '/admin/mail', label: '邮件告警设置', icon: 'mail' },
    { path: '/admin/mail-logs', label: '邮件发送日志', icon: 'fileText' },
    { path: '/admin/fault-logs', label: '故障日志', icon: 'alertTriangle' },
    { path: '/admin/settings', label: '系统设置', icon: 'gear' }
  ];

  /**
   * 渲染后台外壳（侧边栏 + 顶栏），校验登录态并初始化 CSRF
   * @param {string} active 当前激活菜单路径
   */
  async function renderAdminShell(active) {
    const status = await api('/api/auth/status').catch(() => ({ code: 401 }));
    if (status.code === 401 || !status.loggedIn) {
      location.href = '/admin/login';
      return;
    }
    setCsrf(status.csrfToken);

    document.body.className = 'bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100';

    const shell = document.getElementById('admin-shell');
    if (!shell) return;

    // 侧边栏
    const sidebar = h('aside', 'fixed inset-y-0 left-0 z-40 w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transform -translate-x-full lg:translate-x-0 transition-transform duration-200');
    sidebar.id = 'ws-sidebar';
    const brand = h('div', 'flex items-center gap-2.5 px-5 h-16 border-b border-slate-200 dark:border-slate-800');
    brand.innerHTML = icon('activity', 'w-6 h-6 text-blue-600') + '<span class="font-semibold text-slate-800 dark:text-slate-100">WebStatus</span><span class="text-xs text-slate-400 ml-1">管理后台</span>';
    sidebar.appendChild(brand);

    const nav = h('nav', 'py-3 px-3 space-y-1');
    for (const m of MENU) {
      const a = h('a', 'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ' +
        (m.path === active
          ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'));
      a.href = m.path;
      a.innerHTML = icon(m.icon, 'w-5 h-5 flex-shrink-0') + '<span>' + m.label + '</span>';
      nav.appendChild(a);
    }
    // 前台入口
    const front = h('a', 'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800');
    front.href = '/';
    front.innerHTML = icon('external', 'w-5 h-5 flex-shrink-0') + '<span>查看前台</span>';
    nav.appendChild(front);
    sidebar.appendChild(nav);
    shell.appendChild(sidebar);

    // 遮罩（移动端）
    const mask = h('div', 'fixed inset-0 z-30 bg-black/40 hidden lg:hidden');
    mask.id = 'ws-mask';
    mask.addEventListener('click', toggleSidebar);
    shell.appendChild(mask);

    // 顶栏
    const top = h('header', 'fixed top-0 left-0 lg:left-64 right-0 z-20 h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4');
    const left = h('div', 'flex items-center gap-3');
    const burger = h('button', 'lg:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800');
    burger.innerHTML = icon('menu', 'w-6 h-6');
    burger.addEventListener('click', toggleSidebar);
    left.appendChild(burger);
    left.appendChild(h('span', 'text-sm text-slate-500 dark:text-slate-400', '运维控制台'));
    top.appendChild(left);

    const right = h('div', 'flex items-center gap-2');
    const themeBtn = h('button', 'p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800');
    themeBtn.innerHTML = icon('moon', 'w-5 h-5');
    themeBtn.addEventListener('click', () => { toggleTheme(); themeBtn.innerHTML = icon(dark ? 'sun' : 'moon', 'w-5 h-5'); });
    right.appendChild(themeBtn);
    const user = h('div', 'flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 px-2');
    user.textContent = status.username || '';
    right.appendChild(user);
    const logout = h('button', 'px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-red-50 hover:text-red-600 dark:text-slate-300 dark:hover:bg-red-500/10 dark:hover:text-red-400');
    logout.textContent = '退出';
    logout.addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
      location.href = '/admin/login';
    });
    right.appendChild(logout);
    top.appendChild(right);
    shell.appendChild(top);

    // 主内容容器
    const main = h('main', 'pt-16 lg:pl-64 min-h-screen');
    main.id = 'ws-main';
    shell.appendChild(main);

    // 主题初始化
    applyTheme();
    themeBtn.innerHTML = icon(dark ? 'sun' : 'moon', 'w-5 h-5');

    return main;
  }

  function toggleSidebar() {
    const sb = document.getElementById('ws-sidebar');
    const mask = document.getElementById('ws-mask');
    if (!sb) return;
    const hidden = sb.classList.contains('-translate-x-full');
    sb.classList.toggle('-translate-x-full', !hidden);
    if (mask) mask.classList.toggle('hidden', !hidden);
  }

  /* ---------------- 初始化 ---------------- */
  applyTheme();

  return {
    api, setCsrf, esc, h, icon, toast, applyTheme, toggleTheme,
    STATUS_META, fmtTime, fmtDelay, fmtBytes, renderAdminShell
  };
})();
