/**
 * WebStatus 前端公共脚本
 * 依赖：Chart.js(CDN) / fetch；样式由编译后的 app.css（含 Tailwind）提供
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
  let lang = localStorage.getItem('ws_lang') === 'en' ? 'en' : 'zh';
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
    server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'
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

  /* ---------------- i18n（中 / English） ---------------- */
  // 语言字典：key -> { zh, en }。语言存 localStorage('ws_lang')，默认 zh。
  const I18N = {
    'lang.switch': { zh: 'EN', en: '中' },
    'app.subtitle': { zh: '网站状态监控', en: 'Website Status Monitor' },
    'common.loading': { zh: '加载中...', en: 'Loading...' },
    'common.loadFailed': { zh: '加载失败', en: 'Failed to load' },
    'common.save': { zh: '保存', en: 'Save' },
    'common.saved': { zh: '已保存', en: 'Saved' },
    'common.cancel': { zh: '取消', en: 'Cancel' },
    'common.delete': { zh: '删除', en: 'Delete' },
    'common.deleted': { zh: '已删除', en: 'Deleted' },
    'common.edit': { zh: '编辑', en: 'Edit' },
    'common.detail': { zh: '详情', en: 'Details' },
    'common.search': { zh: '查询', en: 'Search' },
    'common.empty': { zh: '暂无记录', en: 'No records' },
    'common.prevPage': { zh: '上一页', en: 'Prev' },
    'common.nextPage': { zh: '下一页', en: 'Next' },
    'common.success': { zh: '成功', en: 'Success' },
    'common.failed': { zh: '失败', en: 'Failed' },
    'common.saving': { zh: '保存中...', en: 'Saving...' },

    'status.up': { zh: '正常', en: 'Up' },
    'status.slow': { zh: '卡顿', en: 'Slow' },
    'status.down': { zh: '离线', en: 'Down' },
    'status.maintenance': { zh: '维修', en: 'Maintenance' },
    'status.unknown': { zh: '未检测', en: 'Unknown' },

    'nav.admin': { zh: '管理后台', en: 'Admin' },
    'nav.dashboard': { zh: '仪表盘', en: 'Dashboard' },
    'nav.sites': { zh: '站点管理', en: 'Sites' },
    'nav.notices': { zh: '公告管理', en: 'Notices' },
    'nav.mail': { zh: '邮件告警设置', en: 'Mail Alerts' },
    'nav.mailLogs': { zh: '邮件发送日志', en: 'Mail Logs' },
    'nav.faultLogs': { zh: '故障日志', en: 'Fault Logs' },
    'nav.settings': { zh: '系统设置', en: 'Settings' },
    'nav.accounts': { zh: '账号管理', en: 'Accounts' },
    'nav.sessions': { zh: '会话管理', en: 'Sessions' },
    'nav.report': { zh: '报表中心', en: 'Reports' },
    'nav.alerts': { zh: '告警设置', en: 'Alerts' },
    'nav.version': { zh: '版本更新', en: 'Version' },
    'nav.maintenance': { zh: '维护计划', en: 'Maintenance' },
    'nav.front': { zh: '查看前台', en: 'View Front' },
    'admin.console': { zh: '运维控制台', en: 'Console' },
    'logout': { zh: '退出', en: 'Logout' },

    'home.cardView': { zh: '卡片', en: 'Cards' },
    'home.listView': { zh: '列表', en: 'List' },
    'home.empty': { zh: '暂无监控站点', en: 'No monitored sites yet' },
    'home.footer': { zh: '开源自托管网站状态监控系统', en: 'Open-source self-hosted status monitoring' },
    'home.metric.delay': { zh: '延迟', en: 'Delay' },
    'home.metric.code': { zh: '状态码', en: 'Status' },
    'home.metric.checked': { zh: '最近检测', en: 'Checked' },
    'home.maintenance': { zh: '维修说明：', en: 'Maintenance: ' },
    'home.probeError': { zh: '探测异常', en: 'Probe error' },
    'home.refreshNow': { zh: '获取最新情况', en: 'Refresh now' },
    'home.refreshing': { zh: '检测中...', en: 'Checking...' },
    'home.refreshDone': { zh: '本轮检测完成', en: 'Check done' },

    'site.title': { zh: '站点详情', en: 'Site Details' },
    'site.chartTitle': { zh: '延迟曲线', en: 'Latency' },
    'site.exportCsv': { zh: '导出 CSV', en: 'Export CSV' },
    'site.chartHint': { zh: '响应耗时（ms），颜色对应状态', en: 'Response time (ms), colored by status' },
    'site.timelineTitle': { zh: '状态时间线', en: 'Status Timeline' },
    'site.timelineEmpty': { zh: '该时间段内暂无状态记录', en: 'No status records in this period' },
    'site.faultTitle': { zh: '故障记录', en: 'Fault History' },
    'site.faultEmpty': { zh: '暂无历史故障', en: 'No historical faults' },
    'site.chartLabel': { zh: '响应耗时(ms)', en: 'Response time (ms)' },
    'site.tooltipDelay': { zh: '耗时', en: 'Latency' },
    'site.ongoing': { zh: '进行中', en: 'ongoing' },
    'site.duration': { zh: '持续', en: 'for' },
    'site.metric.http': { zh: 'HTTP', en: 'HTTP' },
    'site.range.hour': { zh: '1小时', en: '1h' },
    'site.range.day': { zh: '24小时', en: '24h' },
    'site.range.week': { zh: '7天', en: '7d' },
    'site.range.month': { zh: '30天', en: '30d' },
    'dur.day': { zh: '天', en: 'd' },
    'dur.hour': { zh: '时', en: 'h' },
    'dur.min': { zh: '分', en: 'm' },
    'dur.sec': { zh: '秒', en: 's' },

    'login.title': { zh: 'WebStatus 管理后台', en: 'WebStatus Admin' },
    'login.subtitle': { zh: '网站状态监控系统', en: 'Website Status Monitoring' },
    'login.username': { zh: '用户名', en: 'Username' },
    'login.password': { zh: '密码', en: 'Password' },
    'login.submit': { zh: '登录', en: 'Sign in' },
    'login.loggingIn': { zh: '登录中...', en: 'Signing in...' },
    'login.failed': { zh: '登录失败', en: 'Login failed' },
    'login.back': { zh: '← 返回状态面板', en: '← Back to status panel' },

    'install.wizard': { zh: '安装向导', en: 'Installation Wizard' },
    'install.checking': { zh: '正在检查运行环境...', en: 'Checking runtime...' },
    'install.step1': { zh: '环境检查', en: 'Environment' },
    'install.step2': { zh: '数据库', en: 'Database' },
    'install.step3': { zh: '模式选择', en: 'Mode' },
    'install.step4': { zh: '管理员', en: 'Admin' },
    'install.step5': { zh: '系统参数', en: 'Settings' },
    'install.step6': { zh: 'SMTP', en: 'SMTP' },
    'install.step7': { zh: '完成', en: 'Done' },
    'install.next': { zh: '通过，下一步', en: 'Pass, next' },
    'install.retry': { zh: '环境异常，请先修复（仍可重试检查）', en: 'Fix issues, then retry' },
    'install.testDb': { zh: '测试连接并继续', en: 'Test & continue' },
    'install.testingDb': { zh: '连接测试中...', en: 'Testing...' },
    'install.chooseFresh': { zh: '选择全新初始化', en: 'Fresh init' },
    'install.chooseRestore': { zh: '选择恢复备份', en: 'Restore backup' },
    'install.createAdmin': { zh: '创建账号，下一步', en: 'Create account & next' },
    'install.saveParams': { zh: '保存参数，下一步', en: 'Save & next' },
    'install.saveSmtp': { zh: '保存并继续', en: 'Save & continue' },
    'install.skipSmtp': { zh: '跳过此步', en: 'Skip' },
    'install.back': { zh: '上一步', en: 'Back' },
    'install.finish': { zh: '完成安装', en: 'Finish' },
    'install.finishing': { zh: '正在生成配置...', en: 'Generating config...' },
    'install.dbConfig': { zh: '数据库连接配置', en: 'Database Connection' },
    'install.modeInit': { zh: '数据库初始化模式', en: 'Initialization Mode' },
    'install.adminCreate': { zh: '创建管理员账号', en: 'Create Admin Account' },
    'install.sysParams': { zh: '系统参数配置', en: 'System Parameters' },
    'install.smtpConfig': { zh: 'SMTP 邮件配置（可选）', en: 'SMTP Email Config (Optional)' },
    'install.finishTitle': { zh: '即将完成安装', en: 'Almost Done' },
    'install.complete': { zh: '安装完成', en: 'Installation Complete' },
    'install.modeA': { zh: '模式 A：全新初始化', en: 'Mode A: Fresh Init' },
    'install.modeB': { zh: '模式 B：上传备份恢复', en: 'Mode B: Restore Backup' },
    'install.modeBTitle': { zh: '模式 B：上传 SQL 备份恢复', en: 'Mode B: Upload SQL Backup' },

    'dashboard.total': { zh: '站点总数', en: 'Total Sites' },
    'dashboard.svcRunning': { zh: '巡检任务运行中', en: 'Monitor running' },
    'dashboard.svcStopped': { zh: '巡检任务已停止', en: 'Monitor stopped' },
    'dashboard.lastRun': { zh: '上次巡检：', en: 'Last run: ' },
    'dashboard.neverRun': { zh: '尚未运行', en: 'never' },
    'dashboard.recentFaults': { zh: '最近故障', en: 'Recent Faults' },
    'dashboard.noFaults': { zh: '暂无故障记录', en: 'No fault records' },
    'dashboard.recentMails': { zh: '最近邮件发送', en: 'Recent Mail Sends' },
    'dashboard.noMails': { zh: '暂无邮件记录', en: 'No mail records' },
    'dashboard.round': { zh: '本轮 {total} 站 · 正常 {up} · 卡顿 {slow} · 离线 {down} · 维修 {maintenance}', en: 'Round: {total} sites · up {up} · slow {slow} · down {down} · maintenance {maintenance}' },
    'mailType.alert': { zh: '告警', en: 'Alert' },
    'mailType.recover': { zh: '恢复', en: 'Recover' },
    'mailType.test': { zh: '测试', en: 'Test' },

    'sites.add': { zh: '新增站点', en: 'Add Site' },
    'sites.edit': { zh: '编辑站点', en: 'Edit Site' },
    'sites.empty': { zh: '暂无站点，点击右上角添加', en: 'No sites — click the top-right button to add' },
    'sites.disabled': { zh: '监控已停用', en: 'Monitoring disabled' },
    'sites.enabled': { zh: '启用监控', en: 'Monitoring enabled' },
    'sites.maintenanceMode': { zh: '维修模式', en: 'Maintenance mode' },
    'sites.maintenanceNote': { zh: '维修备注', en: 'Maintenance note' },
    'sites.field.name': { zh: '站点名称 *', en: 'Site name *' },
    'sites.field.domain': { zh: '站点域名/URL *', en: 'Site domain / URL *' },
    'sites.field.desc': { zh: '站点简介', en: 'Description' },
    'sites.field.icon': { zh: '站点图标 URL（外部）', en: 'Icon URL (external)' },
    'sites.field.sort': { zh: '排序', en: 'Sort order' },
    'sites.field.seoTitle': { zh: 'SEO 标题', en: 'SEO title' },
    'sites.field.seoDesc': { zh: 'SEO Meta-Description', en: 'SEO meta description' },
    'sites.field.seoKw': { zh: 'SEO Meta-Keywords', en: 'SEO meta keywords' },
    'sites.confirmDelete': { zh: '确定删除站点「{name}」吗？相关历史数据将一并删除。', en: 'Delete site "{name}"? Its history will also be deleted.' },

    'notices.publish': { zh: '发布公告', en: 'Publish Notice' },
    'notices.edit': { zh: '编辑公告', en: 'Edit Notice' },
    'notices.empty': { zh: '暂无公告', en: 'No notices' },
    'notices.pinned': { zh: '置顶', en: 'Pinned' },
    'notices.field.title': { zh: '公告标题 *', en: 'Notice title *' },
    'notices.field.content': { zh: '公告内容（支持简单 HTML）', en: 'Content (simple HTML supported)' },
    'notices.field.sort': { zh: '排序', en: 'Sort order' },
    'notices.confirmDelete': { zh: '确定删除公告「{title}」吗？', en: 'Delete notice "{title}"?' },

    'mail.tab.smtp': { zh: 'SMTP 配置', en: 'SMTP' },
    'mail.tab.recipients': { zh: '接收邮箱', en: 'Recipients' },
    'mail.tab.templates': { zh: '邮件模板', en: 'Templates' },
    'mail.toggleTitle': { zh: '全局邮件告警总开关', en: 'Global mail alert switch' },
    'mail.toggleDesc': { zh: '关闭后不发送任何告警 / 恢复通知邮件', en: 'When off, no alert or recovery emails are sent' },
    'mail.saveConfig': { zh: '保存配置', en: 'Save' },
    'mail.sendTest': { zh: '发送测试邮件', en: 'Send test mail' },
    'mail.testTo': { zh: '测试收件邮箱（留空用发件邮箱）', en: 'Test recipient (empty = from)' },
    'mail.addEmail': { zh: '添加邮箱', en: 'Add' },
    'mail.noRecipients': { zh: '暂无接收邮箱', en: 'No recipients' },
    'mail.enableSmtp': { zh: '启用 SMTP', en: 'Enable SMTP' },
    'mail.saveTemplate': { zh: '保存模板', en: 'Save' },
    'mail.resetTemplate': { zh: '重置为默认', en: 'Reset' },
    'mail.subject': { zh: '邮件主题', en: 'Subject' },
    'mail.htmlBody': { zh: '邮件 HTML 正文', en: 'HTML body' },
    'mail.tplVars': { zh: '可用模板变量：', en: 'Available variables:' },
    'mail.tplAlert': { zh: '告警模板', en: 'Alert template' },
    'mail.tplRecover': { zh: '恢复通知模板', en: 'Recovery template' },
    'mail.smtpNote': { zh: 'SMTP 敏感凭证仅保存于 config.json，数据库中不存储明文密码。', en: 'Sensitive SMTP credentials live only in config.json, never in the DB.' },
    'mail.field.host': { zh: 'SMTP 服务器', en: 'SMTP server' },
    'mail.field.port': { zh: '端口', en: 'Port' },
    'mail.field.user': { zh: '发件账号', en: 'From account' },
    'mail.field.pass': { zh: '发件密码 / 授权码', en: 'Password / app key' },
    'mail.field.fromName': { zh: '发件人名称', en: 'From name' },
    'mail.field.fromEmail': { zh: '发件邮箱', en: 'From email' },

    'mailLogs.th.time': { zh: '时间', en: 'Time' },
    'mailLogs.th.to': { zh: '收件邮箱', en: 'Recipient' },
    'mailLogs.th.type': { zh: '类型', en: 'Type' },
    'mailLogs.th.status': { zh: '状态', en: 'Status' },
    'mailLogs.th.error': { zh: '失败原因', en: 'Error' },
    'mailLogs.fType': { zh: '全部类型', en: 'All types' },
    'mailLogs.fStatus': { zh: '全部状态', en: 'All statuses' },
    'mailLogs.fKeyword': { zh: '搜索收件邮箱', en: 'Search recipient' },
    'mailLogs.lblType': { zh: '类型', en: 'Type' },
    'mailLogs.lblStatus': { zh: '状态', en: 'Status' },
    'mailLogs.lblKeyword': { zh: '关键字', en: 'Keyword' },
    'mailLogs.pager': { zh: '共 {total} 条 · 第 {page} / {pages} 页', en: '{total} records · page {page} / {pages}' },

    'faultLogs.allSites': { zh: '全部站点', en: 'All sites' },
    'faultLogs.allStatus': { zh: '全部状态', en: 'All statuses' },
    'faultLogs.codePlaceholder': { zh: '错误码（如 HTTP_503）', en: 'Error code (e.g. HTTP_503)' },
    'faultLogs.lblSite': { zh: '站点', en: 'Site' },
    'faultLogs.lblStatus': { zh: '状态', en: 'Status' },
    'faultLogs.lblCode': { zh: '错误码', en: 'Error code' },
    'faultLogs.sitePrefix': { zh: '站点#', en: 'Site #' },
    'faultLogs.explainName': { zh: '名称：', en: 'Name: ' },
    'faultLogs.explainCause': { zh: '成因：', en: 'Cause: ' },
    'faultLogs.explainTriggers': { zh: '诱因：', en: 'Triggers: ' },
    'faultLogs.explainTips': { zh: '建议：', en: 'Tips: ' },
    'faultLogs.explainLevel': { zh: '影响等级：', en: 'Severity: ' },
    'faultLogs.levelHigh': { zh: '高', en: 'High' },
    'faultLogs.levelMid': { zh: '中', en: 'Mid' },
    'faultLogs.levelLow': { zh: '低', en: 'Low' },
    'faultLogs.pager': { zh: '共 {total} 条 · 第 {page} / {pages} 页', en: '{total} records · page {page} / {pages}' },

    'settings.params': { zh: '业务参数', en: 'Monitor Parameters' },
    'settings.saveParams': { zh: '保存业务参数', en: 'Save parameters' },
    'settings.ops': { zh: '运维操作', en: 'Operations' },
    'settings.service': { zh: '服务运行状态', en: 'Service Status' },
    'settings.lastRunTime': { zh: '上次巡检时间：', en: 'Last run: ' },
    'settings.svcStopped': { zh: '巡检任务未运行', en: 'Monitor not running' },
    'settings.modeNote': { zh: '巡检模式：仅后端定时任务，页面访问不触发探测', en: 'Probing runs only in the backend scheduler.' },
    'settings.roundSummary': { zh: '最近一轮：站点 {total} · 正常 {up} · 卡顿 {slow} · 离线 {down} · 维修 {maintenance}', en: 'Last round: {total} sites · up {up} · slow {slow} · down {down} · maintenance {maintenance}' },
    'settings.param.slow': { zh: '卡顿延迟阈值(ms)', en: 'Slow threshold (ms)' },
    'settings.param.check': { zh: '巡检间隔(秒)', en: 'Check interval (s)' },
    'settings.param.streak': { zh: '抖动抑制·连续异常次数', en: 'Alert streak (N)' },
    'settings.param.cooldown': { zh: '邮件告警冷却(秒)', en: 'Alert cooldown (s)' },
    'settings.param.history': { zh: '历史数据保留(天)', en: 'History retention (days)' },
    'settings.param.logs': { zh: '日志保留(天)', en: 'Log retention (days)' },
    'settings.param.cache': { zh: '公开缓存 TTL(秒)', en: 'Public cache TTL (s)' },
    'settings.param.refresh': { zh: '前端刷新间隔(秒)', en: 'Frontend refresh (s)' },
    'settings.param.upload': { zh: 'SQL 备份上传上限(MB)', en: 'Backup upload limit (MB)' },
    'settings.op.export': { zh: '导出数据库备份', en: 'Export backup' },
    'settings.op.exportDesc': { zh: '下载完整 .sql 备份文件，可用于安装向导「模式 B」恢复', en: 'Download a full .sql backup for install wizard Mode B' },
    'settings.op.run': { zh: '手动触发完整巡检', en: 'Run monitor now' },
    'settings.op.runDesc': { zh: '立即对所有启用站点执行一轮探测', en: 'Run one probe round for all enabled sites' },
    'settings.op.clearHistory': { zh: '清空监控历史', en: 'Clear history' },
    'settings.op.clearHistoryDesc': { zh: '删除全部状态历史数据（不可恢复）', en: 'Delete all status history (irreversible)' },
    'settings.op.clearFaults': { zh: '清空故障日志', en: 'Clear fault logs' },
    'settings.op.clearFaultsDesc': { zh: '删除全部故障记录（不可恢复）', en: 'Delete all fault records (irreversible)' },
    'settings.op.clearMails': { zh: '清空邮件发送日志', en: 'Clear mail logs' },
    'settings.op.clearMailsDesc': { zh: '删除全部邮件发送记录（不可恢复）', en: 'Delete all mail records (irreversible)' },
    'settings.confirm.run': { zh: '确定立即执行一轮完整巡检？', en: 'Run a full monitor round now?' },
    'settings.confirm.clearHistory': { zh: '确定清空全部监控历史数据？此操作不可恢复！', en: 'Clear all monitoring history? This cannot be undone!' },
    'settings.confirm.clearFaults': { zh: '确定清空全部故障日志？此操作不可恢复！', en: 'Clear all fault logs? Cannot be undone!' },
    'settings.confirm.clearMails': { zh: '确定清空全部邮件发送日志？此操作不可恢复！', en: 'Clear all mail logs? Cannot be undone!' },

    'version.current': { zh: '当前版本', en: 'Current version' },
    'version.gitCommit': { zh: 'Git 提交', en: 'Git commit' },
    'version.gitAt': { zh: '提交时间', en: 'Committed at' },
    'version.checkUpdate': { zh: '检查更新', en: 'Check for updates' },
    'version.checking': { zh: '检查中...', en: 'Checking...' },
    'version.latest': { zh: '最新版本', en: 'Latest version' },
    'version.hasUpdate': { zh: '发现新版本，请前往 GitHub 下载更新', en: 'New version available, download from GitHub' },
    'version.noUpdate': { zh: '已是最新版本', en: 'Already up to date' },
    'version.download': { zh: '前往 GitHub 下载', en: 'Go to GitHub Releases' },
    'version.checkFailed': { zh: '检查更新失败', en: 'Update check failed' },
    'version.repo': { zh: '开源仓库', en: 'Repository' },
    'version.updateTips': { zh: '更新前请先导出数据库备份，更新包替换后重启服务即可。', en: 'Export a DB backup before updating; restart after replacing files.' },

    'report.title': { zh: '报表', en: 'Reports' },
    'report.chooseSite': { zh: '请选择站点', en: 'Select a site' },
    'report.days7': { zh: '近 7 天', en: 'Last 7 days' },
    'report.days30': { zh: '近 30 天', en: 'Last 30 days' },
    'report.days90': { zh: '近 90 天', en: 'Last 90 days' },
    'report.export': { zh: '导出 CSV', en: 'Export CSV' },
    'report.availability': { zh: '每日可用率', en: 'Daily availability' },
    'report.date': { zh: '日期', en: 'Date' },
    'report.availabilityRate': { zh: '可用率', en: 'Availability' },
    'report.blocks': { zh: '近 7 天状态方块图（每小时）', en: 'Status blocks (hourly, 7 days)' },
    'report.legend': { zh: '图例：', en: 'Legend: ' },
    'report.noData': { zh: '无数据', en: 'No data' },
    'report.selectFirst': { zh: '请先选择站点', en: 'Select a site first' },
    'report.emptyDays': { zh: '可用率', en: 'Availability' },

    'mf.title': { zh: '手动故障事件', en: 'Manual Faults' },
    'mf.desc': { zh: '用于记录不经过自动检测的维护 / 故障事件，会计入报表与导出。', en: 'Record manual maintenance / incidents; counted in reports & exports.' },
    'mf.add': { zh: '添加故障', en: 'Add fault' },
    'mf.edit': { zh: '编辑', en: 'Edit' },
    'mf.delete': { zh: '删除', en: 'Delete' },
    'mf.saved': { zh: '已解决', en: 'Resolved' },
    'mf.progress': { zh: '处理中', en: 'In progress' },
    'mf.titleLabel': { zh: '标题 *', en: 'Title *' },
    'mf.descLabel': { zh: '故障说明', en: 'Description' },
    'mf.progressLabel': { zh: '处理进度', en: 'Progress' },
    'mf.siteLabel': { zh: '站点 *', en: 'Site *' },
    'mf.saveEdit': { zh: '保存修改', en: 'Save changes' },
    'mf.cancel': { zh: '取消', en: 'Cancel' },
    'mf.empty': { zh: '暂无手动故障记录', en: 'No manual fault records' },
    'mf.updated': { zh: '已更新', en: 'Updated' },
    'mf.added': { zh: '已添加', en: 'Added' },
    'mf.deleted': { zh: '已删除', en: 'Deleted' },
    'mf.needSite': { zh: '请选择站点', en: 'Please select a site' },
    'mf.needTitle': { zh: '请填写标题', en: 'Please enter a title' },
    'mf.confirmDelete': { zh: '确定删除故障事件「{title}」吗？', en: 'Delete fault "{title}"?' }
  };

  function t(key) {
    const e = I18N[key];
    if (!e) return key;
    return lang === 'en' ? (e.en !== undefined ? e.en : e.zh) : e.zh;
  }

  function applyI18n(root) {
    root = root || document;
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('[data-i18n]').forEach(el => {
      const k = el.getAttribute('data-i18n');
      if (k) el.textContent = t(k);
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const k = el.getAttribute('data-i18n-placeholder');
      if (k) el.setAttribute('placeholder', t(k));
    });
  }

  /** 切换语言并重渲染当前页（data-i18n 静态文案 + 广播 ws-langchange 供页面重渲染动态内容） */
  function setLang(l) {
    lang = l === 'en' ? 'en' : 'zh';
    localStorage.setItem('ws_lang', lang);
    applyI18n(document);
    document.dispatchEvent(new CustomEvent('ws-langchange'));
  }

  const STATUS_KEY = { 1: 'status.up', 2: 'status.slow', 3: 'status.down', 4: 'status.maintenance' };
  /** 状态文本（i18n 化） */
  function tStatus(status) {
    return t(STATUS_KEY[status] || 'status.unknown');
  }

  /** 语言切换按钮（显示目标语言） */
  function langBtn() {
    const b = h('button', 'px-2.5 py-1.5 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800');
    b.id = 'ws-lang-btn';
    function refresh() {
      b.textContent = t('lang.switch');
      b.title = lang === 'zh' ? 'Switch to English' : '切换到中文';
    }
    refresh();
    b.addEventListener('click', () => setLang(lang === 'zh' ? 'en' : 'zh'));
    document.addEventListener('ws-langchange', refresh);
    return b;
  }

  /** skeleton 加载占位块 */
  function skeleton(cls) {
    return h('div', 'animate-pulse bg-slate-200 dark:bg-slate-800 ' + (cls || 'rounded-lg'));
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

  /* ---------------- 版权保护（隐蔽校验，改动即停止渲染） ---------------- */
  const CP_STR = '© Wutong|梧桐|3363047365|github.com/wutong0377';
  const CP_SUM = 57172;
  function cpSum(s) { let t = 0; for (let i = 0; i < s.length; i++) t = (t + s.charCodeAt(i)) >>> 0; return t; }
  function copyrightOk() { return cpSum(CP_STR) === CP_SUM; }
  const AUTHOR = '梧桐 Wutong';            // 梧桐 Wutong
  const GITHUB = 'https://github.com/wutong0377';
  const QQ = '3363047365';
  /**
   * 渲染版权页脚；版权数据被改动则停止渲染页面内容
   * @param {HTMLElement} [container] 可选容器，缺省查找 #ws-copyright
   */
  function renderCopyright(container) {
    if (!copyrightOk()) {
      document.body.innerHTML = '<div style="padding:60px;text-align:center;font-family:sans-serif;color:#64748b"><p>版权信息异常，服务已停止运行。</p></div>';
      throw new Error('copyright integrity check failed');
    }
    const host = container || document.getElementById('ws-copyright');
    if (host) {
      host.innerHTML = '<a href="' + GITHUB + '" target="_blank" rel="noopener" class="hover:underline">© ' + AUTHOR + '</a><span class="mx-1">·</span>QQ ' + QQ;
    }
  }

  /* ---------------- 后台侧边栏 ---------------- */
  const MENU = [
    { path: '/admin/dashboard', label: '仪表盘', key: 'nav.dashboard', icon: 'grid' },
    { path: '/admin/sites', label: '站点管理', key: 'nav.sites', icon: 'globe' },
    { path: '/admin/notices', label: '公告管理', key: 'nav.notices', icon: 'megaphone' },
    { path: '/admin/mail', label: '邮件告警设置', key: 'nav.mail', icon: 'mail' },
    { path: '/admin/mail-logs', label: '邮件发送日志', key: 'nav.mailLogs', icon: 'fileText' },
    { path: '/admin/fault-logs', label: '故障日志', key: 'nav.faultLogs', icon: 'alertTriangle' },
    { path: '/admin/settings', label: '系统设置', key: 'nav.settings', icon: 'gear' },
    { path: '/admin/accounts', label: '账号管理', key: 'nav.accounts', icon: 'shield' },
    { path: '/admin/sessions', label: '会话管理', key: 'nav.sessions', icon: 'clock' },
    { path: '/admin/report', label: '报表中心', key: 'nav.report', icon: 'fileText' },
    { path: '/admin/alerts', label: '告警设置', key: 'nav.alerts', icon: 'alertTriangle' },
    { path: '/admin/alerts#windows', label: '维护计划', key: 'nav.maintenance', icon: 'clock' },
    { path: '/admin/version', label: '版本更新', key: 'nav.version', icon: 'gear' }
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
    const sidebar = h('aside', 'fixed inset-y-0 left-0 z-40 w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transform -translate-x-full lg:translate-x-0 transition-transform duration-200 flex flex-col');
    sidebar.id = 'ws-sidebar';
    const brand = h('div', 'flex items-center gap-2.5 px-5 h-16 border-b border-slate-200 dark:border-slate-800');
    brand.innerHTML = icon('activity', 'w-6 h-6 text-blue-600') + '<span class="font-semibold text-slate-800 dark:text-slate-100">WebStatus</span><span class="text-xs text-slate-400 ml-1" data-i18n="nav.admin">' + t('nav.admin') + '</span>';
    sidebar.appendChild(brand);

    const nav = h('nav', 'py-3 px-3 space-y-1 flex-1 overflow-y-auto');
    for (const m of MENU) {
      const a = h('a', 'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ' +
        (m.path === active
          ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'));
      a.href = m.path;
      a.innerHTML = icon(m.icon, 'w-5 h-5 flex-shrink-0') + '<span data-i18n="' + m.key + '">' + t(m.key) + '</span>';
      nav.appendChild(a);
    }
    // 前台入口
    const front = h('a', 'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800');
    front.href = '/';
    front.innerHTML = icon('external', 'w-5 h-5 flex-shrink-0') + '<span data-i18n="nav.front">' + t('nav.front') + '</span>';
    nav.appendChild(front);
    sidebar.appendChild(nav);
    // 侧边栏底部版权（隐蔽校验）
    const cpBox = h('div', 'px-5 py-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-400');
    cpBox.id = 'ws-copyright';
    sidebar.appendChild(cpBox);
    renderCopyright(cpBox);
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
    const consoleLabel = h('span', 'text-sm text-slate-500 dark:text-slate-400', t('admin.console'));
    consoleLabel.setAttribute('data-i18n', 'admin.console');
    left.appendChild(consoleLabel);
    top.appendChild(left);

    const right = h('div', 'flex items-center gap-2');
    right.appendChild(langBtn());
    const themeBtn = h('button', 'p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800');
    themeBtn.innerHTML = icon('moon', 'w-5 h-5');
    themeBtn.addEventListener('click', () => { toggleTheme(); themeBtn.innerHTML = icon(dark ? 'sun' : 'moon', 'w-5 h-5'); });
    right.appendChild(themeBtn);
    const user = h('div', 'flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 px-2');
    user.textContent = status.username || '';
    right.appendChild(user);
    const logout = h('button', 'px-3 py-1.5 rounded-lg text-sm text-slate-600 hover:bg-red-50 hover:text-red-600 dark:text-slate-300 dark:hover:bg-red-500/10 dark:hover:text-red-400');
    logout.textContent = t('logout');
    logout.setAttribute('data-i18n', 'logout');
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

    // 初始化 i18n 静态文案
    applyI18n();

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
    STATUS_META, fmtTime, fmtDelay, fmtBytes, renderAdminShell,
    t, setLang, applyI18n, tStatus, langBtn, skeleton, renderCopyright,
    get isDark() { return dark; },
    get currentLang() { return lang; }
  };
})();
