'use strict';
/**
 * 错误代码解读库
 * 覆盖 HTTP 状态码、DNS、网络连接、SSL/TLS、系统自定义异常。
 * 每条包含：code 错误代码、name 中文名称、cause 故障成因、
 *          causes 可能诱因、tips 排查建议、level 影响等级(1低 2中 3高)。
 * 前台异常卡片与后台故障日志均展示完整解读。
 */
const ERROR_CODES = {

  // ================= HTTP 4xx =================
  HTTP_400: {
    code: 'HTTP_400', name: '请求错误', level: 2,
    cause: '服务器无法理解客户端发送的请求，语法有误。',
    causes: ['请求参数格式错误', 'URL 路径写错', '请求头缺失或非法', '请求体过大'],
    tips: '检查请求地址与参数；核对 Content-Type 与请求体格式；抓包确认原始请求内容。'
  },
  HTTP_401: {
    code: 'HTTP_401', name: '未授权访问', level: 2,
    cause: '请求需要身份验证，但客户端未提供有效凭证。',
    causes: ['未登录或登录过期', 'Cookie/Token 失效', '缺少 Authorization 头', '账号被禁用'],
    tips: '重新登录获取凭证；检查接口是否需要携带认证信息；确认账号权限未被收回。'
  },
  HTTP_403: {
    code: 'HTTP_403', name: '禁止访问', level: 2,
    cause: '服务器已理解请求但拒绝执行，通常与权限相关。',
    causes: ['IP/地域被防火墙拦截', '访问了未授权目录', 'WAF 误拦截', '文件权限设置错误'],
    tips: '检查服务器防火墙与 WAF 规则；确认访问路径的权限配置；尝试更换出口 IP 排查封锁。'
  },
  HTTP_404: {
    code: 'HTTP_404', name: '页面不存在', level: 2,
    cause: '服务器无法找到请求的资源，资源可能已不存在或路径错误。',
    causes: ['URL 路径错误', '页面/接口已被删除或改名', '静态资源未部署', '反向代理配置错误导致转发失败'],
    tips: '核对 URL 是否与站点实际路径一致；确认资源是否被误删；检查 Nginx/代理的 location 与 root 配置。'
  },
  HTTP_405: {
    code: 'HTTP_405', name: '请求方法不被允许', level: 2,
    cause: '目标资源不支持当前 HTTP 方法（如对静态页发起 POST）。',
    causes: ['接口方法限制', 'Web 服务器禁用了该请求方法', '代理层修改了请求方法'],
    tips: '改用正确的请求方法；检查服务器与代理的方法允许配置（allow_methods）。'
  },
  HTTP_408: {
    code: 'HTTP_408', name: '请求超时', level: 3,
    cause: '服务器在等待客户端发送请求时超时，或响应超过规定时限。',
    causes: ['源站处理缓慢', '网络链路拥塞', '代理/负载均衡超时阈值过短', '后端线程被占满'],
    tips: '查看源站响应耗时；调大代理超时阈值；排查源站高负载或慢查询。'
  },
  HTTP_410: {
    code: 'HTTP_410', name: '资源已删除', level: 1,
    cause: '请求的资源已被永久删除，且不会再有地址。',
    causes: ['内容被彻底下架', '接口版本被废弃', '数据清理任务误删'],
    tips: '确认资源是否应保留；修改前台指向新地址或恢复内容。'
  },
  HTTP_429: {
    code: 'HTTP_429', name: '请求过多', level: 2,
    cause: '客户端在单位时间内发送的请求超出服务器限流阈值。',
    causes: ['站点被刷流量', '客户端脚本死循环请求', '限流阈值配置过小', '触发 WAF/CC 防护'],
    tips: '检查是否被攻击或爬虫高频抓取；适当调大限流阈值；按来源 IP 定向处理恶意流量。'
  },

  // ================= HTTP 5xx =================
  HTTP_500: {
    code: 'HTTP_500', name: '服务器内部错误', level: 3,
    cause: '服务器遇到意外情况，无法完成请求。',
    causes: ['后端代码异常', '依赖服务/数据库不可用', '配置错误', '内存或资源耗尽', '未捕获的运行时异常'],
    tips: '查看源站应用错误日志定位堆栈；检查依赖的数据库/缓存是否正常；确认资源使用率。'
  },
  HTTP_501: {
    code: 'HTTP_501', name: '功能未实现', level: 2,
    cause: '服务器不支持请求所需的功能。',
    causes: ['服务端版本过旧', '模块未安装', '功能代码未上线'],
    tips: '确认目标服务版本与模块；确认功能是否已部署。'
  },
  HTTP_502: {
    code: 'HTTP_502', name: '网关错误', level: 3,
    cause: '反向代理/网关从上游收到无效响应，常见于 Nginx 后源站崩溃。',
    causes: ['源站进程崩溃或未启动', 'PHP-FPM/Node/Java 进程退出', '上游端口未监听', '代理与上游协议不匹配'],
    tips: '重启或排查源站进程；确认上游服务监听端口；查看 Nginx error.log 中的 upstream 错误。'
  },
  HTTP_503: {
    code: 'HTTP_503', name: '服务不可用', level: 3,
    cause: '服务器当前无法处理请求，通常是过载或正在维护。',
    causes: ['源站过载或线程耗尽', '正在进行维护', '依赖组件宕机', '磁盘/内存资源不足'],
    tips: '检查源站负载与资源；确认是否有维护窗口；查看服务健康状态与告警。'
  },
  HTTP_504: {
    code: 'HTTP_504', name: '网关超时', level: 3,
    cause: '反向代理等待上游响应超时，上游处理超过了代理的等待时限。',
    causes: ['源站脚本执行过慢', '数据库慢查询', '代理超时阈值过小', '源站进程阻塞'],
    tips: '定位源站慢请求（日志中耗时长的请求）；优化慢查询；适当调大 proxy_read_timeout。'
  },
  HTTP_521: {
    code: 'HTTP_521', name: '源站服务器宕机', level: 3,
    cause: 'CDN/代理无法建立到源站服务器的连接。',
    causes: ['源站服务器关机或重启', '源站 IP/端口变更未同步', '源站网络中断'],
    tips: '确认源站服务器运行状态；核对源站地址与端口；检查源站网络连通性。'
  },
  HTTP_522: {
    code: 'HTTP_522', name: '连接源站超时', level: 3,
    cause: '代理能够联系源站服务器，但握手建立连接耗时过长。',
    causes: ['源站防火墙拦截', '源站负载过高', '网络路由异常', '源站开启了 SYN 防护'],
    tips: '检查源站防火墙是否放行代理 IP；排查网络延迟；确认源站负载。'
  },
  HTTP_525: {
    code: 'HTTP_525', name: 'SSL 握手失败', level: 3,
    cause: '代理与源站之间 TLS 握手失败。',
    causes: ['源站证书无效或过期', '源站不支持所需 TLS 版本', '源站端口不是 HTTPS', '证书链不完整'],
    tips: '检查源站证书有效性；确认源站 HTTPS 端口与协议支持；补全证书链。'
  },

  // ================= DNS / 网络 =================
  DNS_FAILED: {
    code: 'DNS_FAILED', name: '域名解析失败', level: 3,
    cause: '无法通过 DNS 将域名解析为 IP 地址。',
    causes: ['域名未续费或已过期', 'DNS 记录被删除/未配置', '本地 DNS 服务器异常', '域名拼写错误'],
    tips: '检查域名注册状态；在域名控制台核对 A/AAAA 记录；尝试更换 DNS 服务器（如 8.8.8.8）验证。'
  },
  ENOTFOUND: {
    code: 'ENOTFOUND', name: '域名不存在', level: 3,
    cause: 'DNS 查询返回无记录，域名在当前网络不可解析。',
    causes: ['域名未注册', '记录未生效（新解析有延迟）', 'DNS 污染', '内网域名未配置 hosts'],
    tips: '确认域名是否有效注册；等待解析生效（通常几分钟到几小时）；检查是否需要配置 hosts。'
  },
  EAI_AGAIN: {
    code: 'EAI_AGAIN', name: 'DNS 临时解析失败', level: 2,
    cause: 'DNS 服务器暂时无法完成解析，多为瞬时性故障。',
    causes: ['DNS 服务器临时不可用', '网络抖动', '递归查询超时'],
    tips: '稍后重试；检查本地网络与 DNS 配置；必要时更换 DNS 服务器。'
  },
  ETIMEDOUT: {
    code: 'ETIMEDOUT', name: '连接超时', level: 3,
    cause: '建立到目标服务器的 TCP 连接在限时内未完成。',
    causes: ['目标服务器宕机或离线', '防火墙丢弃 SYN 包', '目标端口未开放', '网络链路中断', '被运营商屏蔽'],
    tips: '确认目标主机在线；用 telnet/nc 测试端口连通性；检查防火墙与安全组规则。'
  },
  ECONNREFUSED: {
    code: 'ECONNREFUSED', name: '连接被拒绝', level: 3,
    cause: '目标主机可达但端口未监听或主动拒绝连接。',
    causes: ['应用进程未启动', '端口监听错误', '防火墙返回 RST', '服务绑定到了其他 IP'],
    tips: '确认应用已启动并监听正确端口（ss -lntp）；检查监听地址是否为 0.0.0.0；查看防火墙规则。'
  },
  ECONNRESET: {
    code: 'ECONNRESET', name: '连接被重置', level: 3,
    cause: '连接在建立后中途被对端强行关闭（RST）。',
    causes: ['对端服务崩溃重启', 'WAF/防火墙主动切断', '代理层异常', '请求头过大触发防护'],
    tips: '查看源站崩溃日志；检查防火墙/WAF 拦截记录；抓包确认 RST 来源。'
  },
  EHOSTUNREACH: {
    code: 'EHOSTUNREACH', name: '主机不可达', level: 3,
    cause: '网络层无法路由到目标主机。',
    causes: ['目标主机离线', '路由配置错误', '网络隔离/防火墙丢弃', 'IP 地址不存在于当前网络'],
    tips: 'ping 目标 IP 验证连通；检查路由与网络隔离策略；确认 IP 归属正确。'
  },
  ENETUNREACH: {
    code: 'ENETUNREACH', name: '网络不可达', level: 3,
    cause: '没有到达目标网络的路由。',
    causes: ['出口网络断开', '路由表异常', 'VPN/代理未连接', '防火墙默认丢弃'],
    tips: '检查本机网络与默认网关；确认 VPN/代理状态；测试到公网的连通性。'
  },
  EADDRNOTAVAIL: {
    code: 'EADDRNOTAVAIL', name: '地址不可用', level: 2,
    cause: '无法获取到可用的源/目标网络地址。',
    causes: ['DNS 返回了不可用的地址', '本机网络栈异常', 'IPv6/IPv4 兼容问题'],
    tips: '检查 DNS 返回的 IP 有效性；重置网络栈；尝试强制 IPv4 或 IPv6。'
  },
  ERR_SOCKET_TIMEOUT: {
    code: 'ERR_SOCKET_TIMEOUT', name: '套接字超时', level: 3,
    cause: 'socket 层等待数据超时，目标响应缓慢或无响应。',
    causes: ['目标服务器处理缓慢', '网络丢包严重', 'TLS 握手超时', '防火墙静默丢弃'],
    tips: '测试目标响应耗时；检查链路丢包；适当调大探测超时阈值对比。'
  },
  TIMEOUT: {
    code: 'TIMEOUT', name: '探测超时', level: 3,
    cause: 'HTTP 请求超过设定的超时时间仍未收到完整响应。',
    causes: ['目标服务器响应过慢', '探测超时阈值设置过小', '网络带宽拥塞', '目标站点本身卡顿'],
    tips: '确认目标站点实际访问速度；核对探测超时配置；若仅为瞬时波动可观察抖动抑制后的结果。'
  },
  NETWORK_ERROR: {
    code: 'NETWORK_ERROR', name: '网络异常', level: 3,
    cause: '探测过程中发生未分类的网络级错误。',
    causes: ['网络栈异常', '代理设置冲突', '系统资源受限'],
    tips: '检查服务器网络状态；查看系统错误日志；用 curl 手动验证连通性。'
  },

  // ================= SSL / TLS =================
  SSL_ERROR: {
    code: 'SSL_ERROR', name: 'SSL/TLS 握手错误', level: 3,
    cause: 'TLS 握手过程中发生未分类的错误。',
    causes: ['证书链不完整', '加密套件不匹配', 'TLS 版本不一致', '服务器 SSL 配置错误'],
    tips: '用 openssl s_client 测试握手；核对服务器证书链与加密套件；确认 TLS 最低版本设置。'
  },
  CERT_HAS_EXPIRED: {
    code: 'CERT_HAS_EXPIRED', name: '证书已过期', level: 3,
    cause: '服务器提供的 TLS 证书已超过有效期。',
    causes: ['未配置自动续期', 'Let’s Encrypt 续期失败', '时钟不同步'],
    tips: '尽快更新证书；检查证书自动续期任务；核对服务器系统时间是否准确。'
  },
  DEPTH_ZERO_SELF_SIGNED_CERT: {
    code: 'DEPTH_ZERO_SELF_SIGNED_CERT', name: '自签名证书', level: 2,
    cause: '服务器使用了自签名证书，未由受信任 CA 签发。',
    causes: ['测试环境未签发正规证书', '内网证书未加入信任库', '误配置为自签名'],
    tips: '生产环境应使用正规 CA 证书；内网可导入根证书到系统信任库；确认部署是否故意使用自签名。'
  },
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: {
    code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', name: '证书链验证失败', level: 3,
    cause: '无法验证证书链中最终证书的签名。',
    causes: ['证书链不完整（缺少中间证书）', '证书与实际私钥不匹配', '中间证书未配置'],
    tips: '在服务器上补全完整证书链（fullchain）；用在线工具检测证书链；确认私钥与证书匹配。'
  },
  ERR_TLS_CERT_ALTNAME_INVALID: {
    code: 'ERR_TLS_CERT_ALTNAME_INVALID', name: '证书域名不匹配', level: 3,
    cause: '证书的 SAN 字段不包含当前访问的域名。',
    causes: ['证书是为其他域名签发的', '访问了别名域名', '多域名证书漏配'],
    tips: '检查证书包含的域名（SAN）；为当前域名签发/补发证书；确认访问域名与证书一致。'
  },
  CERT_NOT_YET_VALID: {
    code: 'CERT_NOT_YET_VALID', name: '证书尚未生效', level: 2,
    cause: '服务器系统时间早于证书的生效时间。',
    causes: ['系统时钟错误', '证书被提前部署', 'NTP 同步失败'],
    tips: '核对并校准服务器系统时间；确认证书生效时间与部署时间。'
  },
  SSL_HTTP_REQUEST: {
    code: 'SSL_HTTP_REQUEST', name: 'HTTPS 端口收到明文请求', level: 3,
    cause: '向 HTTPS 端口发送了明文 HTTP 请求，TLS 层无法解析。',
    causes: ['客户端用 http:// 访问 https 端口', '端口转发配置错误', '监控探测未走 HTTPS'],
    tips: '确认站点应使用的协议；用 https:// 正确访问；检查代理端口与协议配置。'
  },
  HANDSHAKE_TIMEOUT: {
    code: 'HANDSHAKE_TIMEOUT', name: 'TLS 握手超时', level: 3,
    cause: 'TLS 握手在限时内未完成。',
    causes: ['目标服务器负载过高', '网络延迟大', '防火墙干扰握手', '服务器 SSL 进程阻塞'],
    tips: '观察目标负载与响应速度；检查链路质量；确认防火墙未拦截 TLS 流量。'
  },
  ERR_SSL_PROTOCOL_ERROR: {
    code: 'ERR_SSL_PROTOCOL_ERROR', name: 'SSL 协议错误', level: 3,
    cause: 'TLS 层出现协议级错误。',
    causes: ['TLS 版本不兼容', '加密套件协商失败', '中间设备篡改流量', '客户端/服务器 OpenSSL 版本过旧'],
    tips: '升级客户端与服务端 TLS 库；调整加密套件配置；检查中间设备是否干扰 TLS。'
  },

  // ================= v1.1 增强检测：SSL 证书监控 =================
  CERT_WARN: {
    code: 'CERT_WARN', name: '证书即将过期', level: 2,
    cause: '服务器 TLS 证书剩余有效期已低于预警阈值。',
    causes: ['未配置自动续期', 'Let’s Encrypt 续期失败', '证书签发周期较长'],
    tips: '及时续期证书；检查自动续期任务（如 certbot）；核对证书预警天数设置。'
  },
  CERT_PARSE: {
    code: 'CERT_PARSE', name: '证书解析失败', level: 3,
    cause: '无法解析服务器返回的 TLS 证书内容。',
    causes: ['服务器返回了非证书数据', 'TLS 实现异常', '中间设备篡改证书'],
    tips: '用 openssl s_client 检查服务器证书；确认服务器 SSL 配置正确；尝试清空本地证书缓存。'
  },
  CERT_TIMEOUT: {
    code: 'CERT_TIMEOUT', name: '证书检测超时', level: 3,
    cause: 'TLS 证书获取在限时内未完成。',
    causes: ['目标服务器负载过高', '网络延迟大', '防火墙干扰 TLS 握手'],
    tips: '检查目标服务器响应；确认链路质量；核对防火墙是否拦截 TLS 流量。'
  },
  CERT_REVOKED: {
    code: 'CERT_REVOKED', name: '证书已被吊销', level: 3,
    cause: '通过 OCSP 查询确认服务器证书已被 CA 吊销。',
    causes: ['证书私钥泄露', '证书申请信息有误被吊销', '域名所有权争议', 'CA 操作失误'],
    tips: '立即停止使用该证书；向 CA 申请新证书并替换；排查私钥是否泄露。'
  },

  // ================= v1.1 增强检测：OCSP 吊销状态 =================
  OCSP_DISABLED: {
    code: 'OCSP_DISABLED', name: 'OCSP 吊销检测未启用', level: 2,
    cause: '系统未安装 ocsp 依赖，无法进行证书吊销状态在线查询。',
    causes: ['ocsp 依赖未安装', 'npm 安装被裁剪'],
    tips: '如需证书吊销检测，请安装 ocsp 依赖；当前状态仅做记录，不影响主监控。'
  },
  OCSP_NO_ISSUER: {
    code: 'OCSP_NO_ISSUER', name: '缺少签发者证书', level: 2,
    cause: '服务器未提供完整证书链，无法取得签发者证书进行 OCSP 查询。',
    causes: ['证书链不完整', '服务器未下发中间证书'],
    tips: '在服务器上补全完整证书链（fullchain）；用在线工具检测证书链完整性。'
  },
  OCSP_ERROR: {
    code: 'OCSP_ERROR', name: 'OCSP 查询失败', level: 2,
    cause: '向 OCSP 服务器发起吊销状态查询时出错。',
    causes: ['OCSP 服务器不可达', '网络被拦截', 'OCSP 响应格式异常'],
    tips: '检查到 OCSP 服务器的网络连通性；稍后重试；以证书有效期与吊销状态综合判断。'
  },
  OCSP_EXCEPTION: {
    code: 'OCSP_EXCEPTION', name: 'OCSP 校验异常', level: 2,
    cause: 'OCSP 吊销检测过程中发生未分类异常。',
    causes: ['ocsp 库与 Node 版本兼容问题', '证书数据异常', '系统资源受限'],
    tips: '查看服务端日志；确认 Node 版本与 ocsp 依赖兼容；必要时关闭该站点的 OCSP 检测。'
  },

  // ================= v1.1 增强检测：域名到期（RDAP） =================
  DOMAIN_INVALID: {
    code: 'DOMAIN_INVALID', name: '域名格式不正确', level: 3,
    cause: '待检测的域名格式不合法，无法发起 RDAP 查询。',
    causes: ['域名拼写错误', '包含非法字符', '站点地址填写异常'],
    tips: '核对站点域名，需为纯域名形式（如 example.com）。'
  },
  DOMAIN_NO_EXPIRY: {
    code: 'DOMAIN_NO_EXPIRY', name: '未获取到过期时间', level: 2,
    cause: 'RDAP 服务器未返回该域名的过期事件。',
    causes: ['RDAP 记录不全', '注册局数据同步延迟', '域名状态特殊（如保留域名）'],
    tips: '稍后重试；也可在注册商后台手动核对域名到期时间。'
  },
  DOMAIN_EXPIRED: {
    code: 'DOMAIN_EXPIRED', name: '域名已过期', level: 3,
    cause: 'RDAP 返回的域名过期时间已过，域名可能已失效。',
    causes: ['未及时续费', '自动续费失败', '支付方式失效'],
    tips: '立即联系注册商续费；注意域名进入赎回期后恢复成本会大幅上升。'
  },
  RDAP_FAILED: {
    code: 'RDAP_FAILED', name: 'RDAP 查询失败', level: 3,
    cause: '向 RDAP 服务器查询域名信息时发生错误。',
    causes: ['RDAP 引导服务器不可达', '网络异常', '域名 TLD 无对应 RDAP 服务'],
    tips: '检查服务器网络连通性；稍后重试；必要时在注册商后台查询域名状态。'
  },
  DOMAIN_LOOKUP_UNAVAILABLE: {
    code: 'DOMAIN_LOOKUP_UNAVAILABLE', name: '无法自动获取到期信息', level: 2,
    cause: '该域名所属注册局（如 CNNIC 管理的 .cn）暂不支持通过 RDAP/WHOIS 自动查询到期时间。',
    causes: ['注册局 RDAP 服务不完善', 'rdap.org 引导不稳定', '域名状态特殊'],
    tips: '到域名注册商后台查看到期时间；可手动在系统里记录到期日期。'
  },

  // ================= 系统自定义 =================
  URL_INVALID: {
    code: 'URL_INVALID', name: 'URL 格式错误', level: 1,
    cause: '配置的站点 URL 无法被解析。',
    causes: ['地址缺少协议头', '包含非法字符', '域名/路径书写错误'],
    tips: '检查站点地址是否正确，需形如 https://example.com。'
  },
  URL_PROTOCOL: {
    code: 'URL_PROTOCOL', name: '协议不支持', level: 1,
    cause: '站点使用了非 http/https 协议。',
    causes: ['填写了 ftp/ws 等协议', '端口配置异常'],
    tips: '仅支持 http 与 https 协议，请修正站点地址。'
  },
  SSRF_BLOCKED: {
    code: 'SSRF_BLOCKED', name: '内网地址拦截', level: 2,
    cause: '站点域名解析到内网/回环地址，被安全策略拦截。',
    causes: ['站点指向了服务器本机或内网', 'DNS 解析到保留网段', '配置失误'],
    tips: '系统出于安全考虑禁止探测内网地址；请核对站点是否为公网地址。'
  },
  PING_FAILED: {
    code: 'PING_FAILED', name: 'Ping 失败', level: 2,
    cause: 'ICMP ping 无法获取目标主机延迟。',
    causes: ['目标禁 ping（防火墙丢弃 ICMP）', '网络不可达', '服务器无 ping 权限/二进制'],
    tips: '多数站点禁 ping 属正常现象，系统会以 HTTP 探测结果为准；检查探测服务器权限。'
  },
  PROBE_ERROR: {
    code: 'PROBE_ERROR', name: '探测异常', level: 3,
    cause: '探测过程中发生未分类异常。',
    causes: ['探测模块异常', '系统资源不足', '目标返回非法数据'],
    tips: '查看服务端日志定位异常；用 curl 手动探测对比；确认系统资源充足。'
  }
};

/**
 * 根据错误码获取完整解读
 * @param {string} code 错误码
 * @param {string} fallbackMsg 兜底描述（错误码不存在时使用）
 * @returns 完整解读对象
 */
function getErrorExplain(code, fallbackMsg) {
  const item = ERROR_CODES[code];
  if (item) return { ...item };
  return {
    code: code || 'UNKNOWN',
    name: '未知错误',
    level: 2,
    cause: fallbackMsg || '发生未知异常。',
    causes: ['无法识别具体错误类型'],
    tips: '查看服务端日志获取详细信息；可访问站点确认实际状态。'
  };
}

/** 完整错误码列表（用于后台筛选） */
function allCodes() {
  return Object.keys(ERROR_CODES).map(k => ({ code: k, name: ERROR_CODES[k].name }));
}

module.exports = { ERROR_CODES, getErrorExplain, allCodes };
