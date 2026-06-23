/**
 * 家用路由器管理程序 - 路由器核心逻辑模块 (TypeScript)
 * 
 * 对应后端 router_manager.py 的 TypeScript 实现
 * 包含模式切换、密码管理、WiFi配置、网络设置、安全设置等核心功能
 * 可用于前端模拟测试或同构逻辑共享
 */

import {
  RouterConfig,
  RouterMode,
  RouterWorkMode,
  WanConfig,
  WanConnectionType,
  LanConfig,
  WifiBandConfig,
  WifiBand,
  WifiEncryption,
  SecurityConfig,
  MacFilterConfig,
  MacFilterMode,
  MacFilterRule,
  PortForwardConfig,
  PortForwardRule,
  ForwardProtocol,
  DdnsConfig,
  DdnsProvider,
  SystemConfig,
  AutoRebootConfig,
  RebootSchedule,
  AdminConfig,
  SystemInfo,
  TrafficStats,
  WifiClient,
  ConnectedDevice,
  LogEntry,
  ApiResponse,
  ModeSwitchResponse,
  PingTestResponse,
  PingResult,
} from './types.js';

// ==================== 默认配置 ====================

/** 默认路由器配置 */
export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  admin: {
    username: 'admin',
    password: 'admin123',
    email: 'admin@router.local',
  },
  work_mode: 'router',
  wan: {
    connection_type: 'dhcp',
    ip_address: '192.168.1.100',
    subnet_mask: '255.255.255.0',
    gateway: '192.168.1.1',
    dns_primary: '8.8.8.8',
    dns_secondary: '8.8.4.4',
    pppoe_username: '',
    pppoe_password: '',
  },
  lan: {
    ip_address: '192.168.31.1',
    subnet_mask: '255.255.255.0',
    dhcp_enabled: true,
    dhcp_start: '192.168.31.100',
    dhcp_end: '192.168.31.200',
    dhcp_lease_time: 86400,
  },
  wifi_2g: {
    enabled: true,
    ssid: 'Home_Router_2G',
    password: 'wifi123456',
    channel: 'auto',
    encryption: 'WPA2-PSK',
    hidden: false,
    max_clients: 32,
  },
  wifi_5g: {
    enabled: true,
    ssid: 'Home_Router_5G',
    password: 'wifi123456',
    channel: 'auto',
    encryption: 'WPA2-PSK',
    hidden: false,
    max_clients: 32,
  },
  security: {
    remote_access: false,
    remote_port: 8443,
    ping_block: false,
    mac_filter: {
      enabled: false,
      mode: 'allow',
      list: [],
    },
    url_filter: {
      enabled: false,
      list: [],
    },
  },
  port_forwarding: {
    enabled: false,
    rules: [],
  },
  ddns: {
    enabled: false,
    provider: '',
    hostname: '',
    username: '',
    password: '',
  },
  system: {
    hostname: 'HomeRouter',
    timezone: 'Asia/Shanghai',
    ntp_server: 'ntp.aliyun.com',
    log_level: 'info',
    auto_reboot: {
      enabled: false,
      schedule: 'weekly',
      day: 'Sunday',
      time: '03:00',
    },
  },
};

// ==================== 工具函数 ====================

/** 生成唯一ID */
function generateId(): string {
  return `rule_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

/** 获取当前时间字符串 */
function getCurrentTime(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/** 深拷贝对象 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/** 递归更新嵌套对象 */
function deepUpdate(base: Record<string, any>, updates: Record<string, any>): void {
  for (const [key, value] of Object.entries(updates)) {
    if (key in base && typeof base[key] === 'object' && !Array.isArray(base[key]) && typeof value === 'object' && !Array.isArray(value)) {
      deepUpdate(base[key], value);
    } else {
      base[key] = value;
    }
  }
}

/** 随机数生成 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 随机浮点数 */
function randomFloat(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

// ==================== 路由器管理器 ====================

/**
 * 路由器管理器 - TypeScript 实现
 * 模拟底层路由器硬件操作，与后端 router_manager.py 功能对应
 */
export class RouterManager {
  config: RouterConfig;
  private _uptime: number;
  private _operationLog: LogEntry[];

  constructor(defaultConfig?: Partial<RouterConfig>) {
    this.config = deepClone(DEFAULT_ROUTER_CONFIG);
    if (defaultConfig) {
      deepUpdate(this.config, defaultConfig as Record<string, any>);
    }
    this._uptime = Date.now();
    this._operationLog = [];
    this._logOperation('系统启动', '路由器初始化完成');
  }

  // ==================== 日志记录 ====================

  private _logOperation(action: string, detail: string = ''): void {
    const entry: LogEntry = {
      timestamp: getCurrentTime(),
      action,
      detail,
    };
    this._operationLog.push(entry);
    // 保留最近1000条日志
    if (this._operationLog.length > 1000) {
      this._operationLog = this._operationLog.slice(-1000);
    }
  }

  /** 获取操作日志 */
  getLogs(limit: number = 50): LogEntry[] {
    return this._operationLog.slice(-limit);
  }

  // ==================== 系统信息 ====================

  /** 获取系统信息 */
  getSystemInfo(): SystemInfo {
    const uptimeMs = Date.now() - this._uptime;
    const uptimeSeconds = Math.floor(uptimeMs / 1000);
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;

    return {
      hostname: this.config.system.hostname,
      uptime: `${days}天 ${hours}小时 ${minutes}分 ${seconds}秒`,
      uptime_seconds: uptimeSeconds,
      current_time: getCurrentTime(),
      timezone: this.config.system.timezone,
      work_mode: this.config.work_mode,
      firmware_version: 'v2.1.0',
      hardware_version: 'R3600 v1.0',
      cpu_usage: randomFloat(5, 45),
      memory_usage: randomFloat(30, 70),
      connections: randomInt(5, 50),
    };
  }

  // ==================== 模式切换 ====================

  /** 获取可用工作模式列表 */
  getAvailableModes(): RouterMode[] {
    return [
      {
        id: 'router',
        name: '路由模式 (Router)',
        description: '标准路由器模式，提供NAT、DHCP、防火墙等功能，适合家庭网络主路由',
        icon: 'router',
      },
      {
        id: 'ap',
        name: 'AP模式 (Access Point)',
        description: '接入点模式，将有线网络转换为WiFi信号，适合扩展有线网络覆盖',
        icon: 'wifi',
      },
      {
        id: 'repeater',
        name: '中继模式 (Repeater)',
        description: '无线中继模式，放大现有WiFi信号，适合扩展无线覆盖范围',
        icon: 'swap',
      },
      {
        id: 'bridge',
        name: '桥接模式 (Bridge)',
        description: '无线桥接模式，连接两个不同的网络段，适合网络互联',
        icon: 'link',
      },
    ];
  }

  /** 获取当前工作模式 */
  getCurrentMode(): RouterMode {
    const modes = this.getAvailableModes();
    return modes.find(m => m.id === this.config.work_mode) || modes[0];
  }

  /** 切换路由器工作模式 */
  switchMode(modeId: RouterWorkMode): ModeSwitchResponse {
    const validModes = this.getAvailableModes().map(m => m.id);
    if (!validModes.includes(modeId)) {
      return { success: false, message: `无效的模式: ${modeId}` };
    }

    const oldMode = this.config.work_mode;
    if (oldMode === modeId) {
      return { success: true, message: `当前已经是${modeId}模式，无需切换` };
    }

    // 根据模式调整默认配置
    this.config.work_mode = modeId;

    if (modeId === 'ap') {
      this.config.lan.dhcp_enabled = false;
      this._logOperation('模式切换', `从${oldMode}切换到AP模式，已禁用DHCP服务器`);
    } else if (modeId === 'repeater') {
      this.config.lan.dhcp_enabled = true;
      this.config.wan.connection_type = 'dhcp';
      this._logOperation('模式切换', `从${oldMode}切换到中继模式`);
    } else if (modeId === 'bridge') {
      this.config.lan.dhcp_enabled = false;
      this._logOperation('模式切换', `从${oldMode}切换到桥接模式，已禁用DHCP服务器`);
    } else {
      this.config.lan.dhcp_enabled = true;
      this._logOperation('模式切换', `从${oldMode}切换到路由模式`);
    }

    return {
      success: true,
      message: `模式切换成功！从"${oldMode}"切换到"${modeId}"模式`,
      old_mode: oldMode,
      new_mode: modeId,
      reboot_required: true,
    };
  }

  // ==================== 密码管理 ====================

  /** 修改管理员密码 */
  changeAdminPassword(oldPassword: string, newPassword: string, confirmPassword: string): ApiResponse {
    if (newPassword !== confirmPassword) {
      return { success: false, message: '两次输入的新密码不一致' };
    }
    if (oldPassword !== this.config.admin.password) {
      return { success: false, message: '当前密码错误' };
    }
    if (newPassword.length < 6) {
      return { success: false, message: '新密码长度不能少于6位' };
    }
    if (newPassword === oldPassword) {
      return { success: false, message: '新密码不能与当前密码相同' };
    }

    this.config.admin.password = newPassword;
    this._logOperation('密码修改', '管理员密码已更改');
    return { success: true, message: '密码修改成功' };
  }

  /** 修改WiFi密码 */
  changeWifiPassword(band: WifiBand, oldPassword: string, newPassword: string, confirmPassword: string): ApiResponse {
    if (!['wifi_2g', 'wifi_5g'].includes(band)) {
      return { success: false, message: '无效的WiFi频段' };
    }
    if (newPassword !== confirmPassword) {
      return { success: false, message: '两次输入的新密码不一致' };
    }
    if (oldPassword !== this.config[band].password) {
      return { success: false, message: '当前WiFi密码错误' };
    }
    if (newPassword.length < 8) {
      return { success: false, message: 'WiFi密码长度不能少于8位' };
    }

    const bandName = band === 'wifi_2g' ? '2.4G' : '5G';
    this.config[band].password = newPassword;
    this._logOperation('WiFi密码修改', `${bandName}频段密码已更改`);
    return { success: true, message: `${bandName} WiFi密码修改成功` };
  }

  // ==================== WiFi管理 ====================

  /** 获取WiFi设置 */
  getWifiSettings(band: WifiBand): WifiBandConfig | null {
    if (!['wifi_2g', 'wifi_5g'].includes(band)) return null;
    return deepClone(this.config[band]);
  }

  /** 更新WiFi设置 */
  updateWifiSettings(band: WifiBand, settings: Partial<WifiBandConfig>): ApiResponse {
    if (!['wifi_2g', 'wifi_5g'].includes(band)) {
      return { success: false, message: '无效的WiFi频段' };
    }

    const bandName = band === 'wifi_2g' ? '2.4G' : '5G';

    // 验证SSID
    if (settings.ssid !== undefined) {
      const ssid = settings.ssid.trim();
      if (ssid.length < 1 || ssid.length > 32) {
        return { success: false, message: 'SSID长度必须在1-32个字符之间' };
      }
      this.config[band].ssid = ssid;
    }

    // 验证密码
    if (settings.password !== undefined && settings.password.length > 0) {
      if (settings.password.length < 8) {
        return { success: false, message: 'WiFi密码长度不能少于8位' };
      }
      this.config[band].password = settings.password;
    }

    // 更新其他设置
    const allowedKeys: (keyof WifiBandConfig)[] = ['enabled', 'channel', 'encryption', 'hidden', 'max_clients'];
    for (const key of allowedKeys) {
      if (settings[key] !== undefined) {
        (this.config[band] as any)[key] = settings[key];
      }
    }

    this._logOperation('WiFi设置更新', `${bandName}频段配置已更新`);
    return { success: true, message: `${bandName} WiFi设置已更新` };
  }

  /** 获取WiFi客户端列表（模拟） */
  getWifiClients(): WifiClient[] {
    const macPrefixes = ['AA:BB:CC', 'DD:EE:FF', '11:22:33', '44:55:66', '77:88:99'];
    const devices = [
      'iPhone 15', 'Xiaomi 14', 'MacBook Pro', 'iPad Air', 'Samsung TV',
      'Google Pixel', 'Windows Laptop', 'Smart Speaker', 'PS5', 'Xbox',
    ];

    const numClients = randomInt(2, 8);
    const clients: WifiClient[] = [];

    for (let i = 0; i < numClients; i++) {
      const prefix = macPrefixes[randomInt(0, macPrefixes.length - 1)];
      const suffix1 = randomInt(10, 99).toString(16).toUpperCase();
      const suffix2 = randomInt(10, 99).toString(16).toUpperCase();
      clients.push({
        mac: `${prefix}:${suffix1}:${suffix2}`,
        device_name: devices[randomInt(0, devices.length - 1)],
        ip: `192.168.31.${randomInt(2, 250)}`,
        band: randomInt(0, 1) === 0 ? '2.4G' : '5G',
        signal: randomInt(40, 100),
        rx_rate: `${randomInt(100, 866)} Mbps`,
        tx_rate: `${randomInt(50, 433)} Mbps`,
        connected_time: `${randomInt(1, 120)}分钟`,
      });
    }

    return clients;
  }

  // ==================== WAN配置 ====================

  /** 获取WAN口设置 */
  getWanSettings(): WanConfig {
    return deepClone(this.config.wan);
  }

  /** 更新WAN口设置 */
  updateWanSettings(settings: Partial<WanConfig>): ApiResponse {
    const validTypes: WanConnectionType[] = ['dhcp', 'static', 'pppoe'];
    if (settings.connection_type && !validTypes.includes(settings.connection_type)) {
      return { success: false, message: '无效的连接类型' };
    }

    for (const [key, value] of Object.entries(settings)) {
      if (key in this.config.wan) {
        (this.config.wan as any)[key] = value;
      }
    }

    this._logOperation('WAN设置更新', `连接类型: ${this.config.wan.connection_type}`);
    return { success: true, message: 'WAN口设置已更新' };
  }

  // ==================== LAN配置 ====================

  /** 获取LAN口设置 */
  getLanSettings(): LanConfig {
    return deepClone(this.config.lan);
  }

  /** 更新LAN口设置 */
  updateLanSettings(settings: Partial<LanConfig>): ApiResponse {
    for (const [key, value] of Object.entries(settings)) {
      if (key in this.config.lan) {
        (this.config.lan as any)[key] = value;
      }
    }

    this._logOperation('LAN设置更新', `LAN IP: ${this.config.lan.ip_address}`);
    return { success: true, message: 'LAN口设置已更新' };
  }

  // ==================== 端口转发 ====================

  /** 获取端口转发规则列表 */
  getPortForwardingRules(): PortForwardRule[] {
    return deepClone(this.config.port_forwarding.rules);
  }

  /** 添加端口转发规则 */
  addPortForwardingRule(rule: Omit<PortForwardRule, 'id' | 'enabled'>): ApiResponse {
    const required: (keyof typeof rule)[] = ['name', 'protocol', 'external_port', 'internal_ip', 'internal_port'];
    for (const field of required) {
      if (!rule[field]) {
        return { success: false, message: `缺少必填字段: ${field}` };
      }
    }

    const validProtocols: ForwardProtocol[] = ['TCP', 'UDP', 'BOTH'];
    if (!validProtocols.includes(rule.protocol)) {
      return { success: false, message: '无效的协议类型' };
    }

    const newRule: PortForwardRule = {
      ...rule,
      id: generateId(),
      enabled: true,
    };

    this.config.port_forwarding.rules.push(newRule);
    this.config.port_forwarding.enabled = true;
    this._logOperation('端口转发添加', `${rule.name}: ${rule.external_port} -> ${rule.internal_ip}:${rule.internal_port}`);
    return { success: true, message: '端口转发规则已添加', rule: newRule };
  }

  /** 删除端口转发规则 */
  removePortForwardingRule(ruleId: string): ApiResponse {
    const index = this.config.port_forwarding.rules.findIndex(r => r.id === ruleId);
    if (index === -1) {
      return { success: false, message: '未找到该规则' };
    }
    const removed = this.config.port_forwarding.rules.splice(index, 1)[0];
    this._logOperation('端口转发删除', `${removed.name} 已删除`);
    return { success: true, message: '端口转发规则已删除' };
  }

  /** 启用/禁用端口转发规则 */
  togglePortForwardingRule(ruleId: string): ApiResponse {
    const rule = this.config.port_forwarding.rules.find(r => r.id === ruleId);
    if (!rule) {
      return { success: false, message: '未找到该规则' };
    }
    rule.enabled = !rule.enabled;
    const status = rule.enabled ? '启用' : '禁用';
    this._logOperation('端口转发切换', `${rule.name} 已${status}`);
    return { success: true, message: `规则已${status}`, enabled: rule.enabled };
  }

  // ==================== MAC地址过滤 ====================

  /** 获取MAC地址过滤设置 */
  getMacFilterSettings(): MacFilterConfig {
    return deepClone(this.config.security.mac_filter);
  }

  /** 更新MAC地址过滤设置 */
  updateMacFilter(settings: Partial<MacFilterConfig>): ApiResponse {
    if (settings.enabled !== undefined) {
      this.config.security.mac_filter.enabled = settings.enabled;
    }
    if (settings.mode && ['allow', 'deny'].includes(settings.mode)) {
      this.config.security.mac_filter.mode = settings.mode;
    }
    this._logOperation('MAC过滤更新', `已${this.config.security.mac_filter.enabled ? '启用' : '禁用'}`);
    return { success: true, message: 'MAC地址过滤设置已更新' };
  }

  /** 添加MAC地址过滤规则 */
  addMacFilterRule(macAddress: string, comment: string = ''): ApiResponse {
    const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
    if (!macRegex.test(macAddress)) {
      return { success: false, message: '无效的MAC地址格式' };
    }

    const macUpper = macAddress.toUpperCase();
    if (this.config.security.mac_filter.list.some(item => item.mac === macUpper)) {
      return { success: false, message: '该MAC地址已存在' };
    }

    this.config.security.mac_filter.list.push({
      mac: macUpper,
      comment,
      added_at: getCurrentTime(),
    });

    this._logOperation('MAC过滤添加', `${macUpper} (${comment})`);
    return { success: true, message: 'MAC地址已添加' };
  }

  /** 删除MAC地址过滤规则 */
  removeMacFilterRule(macAddress: string): ApiResponse {
    const macUpper = macAddress.toUpperCase();
    const index = this.config.security.mac_filter.list.findIndex(item => item.mac === macUpper);
    if (index === -1) {
      return { success: false, message: '未找到该MAC地址' };
    }
    this.config.security.mac_filter.list.splice(index, 1);
    this._logOperation('MAC过滤删除', `${macUpper}`);
    return { success: true, message: 'MAC地址已删除' };
  }

  // ==================== DDNS配置 ====================

  /** 获取DDNS设置 */
  getDdnsSettings(): DdnsConfig {
    return deepClone(this.config.ddns);
  }

  /** 更新DDNS设置 */
  updateDdnsSettings(settings: Partial<DdnsConfig>): ApiResponse {
    for (const [key, value] of Object.entries(settings)) {
      if (key in this.config.ddns) {
        (this.config.ddns as any)[key] = value;
      }
    }
    this._logOperation('DDNS更新', `已${this.config.ddns.enabled ? '启用' : '禁用'}`);
    return { success: true, message: 'DDNS设置已更新' };
  }

  // ==================== 系统设置 ====================

  /** 获取系统设置 */
  getSystemSettings(): SystemConfig {
    return deepClone(this.config.system);
  }

  /** 更新系统设置 */
  updateSystemSettings(settings: Partial<SystemConfig>): ApiResponse {
    for (const [key, value] of Object.entries(settings)) {
      if (key in this.config.system) {
        if (key === 'auto_reboot' && typeof value === 'object' && !Array.isArray(value)) {
          deepUpdate(this.config.system.auto_reboot as any, value as Record<string, any>);
        } else {
          (this.config.system as any)[key] = value;
        }
      }
    }
    this._logOperation('系统设置更新', '系统配置已更新');
    return { success: true, message: '系统设置已更新' };
  }

  /** 重启路由器 */
  reboot(): ApiResponse {
    this._logOperation('系统重启', '路由器正在重启...');
    this._uptime = Date.now();
    return { success: true, message: '路由器正在重启，请等待...' };
  }

  /** 恢复出厂设置 */
  resetFactory(): ApiResponse {
    this.config = deepClone(DEFAULT_ROUTER_CONFIG);
    this._uptime = Date.now();
    this._operationLog = [];
    this._logOperation('恢复出厂', '路由器已恢复出厂设置');
    return { success: true, message: '已恢复出厂设置，路由器将重启' };
  }

  // ==================== 网络诊断 ====================

  /** Ping测试（模拟） */
  pingTest(target: string = '8.8.8.8'): PingTestResponse {
    const results: PingResult[] = [];

    for (let i = 0; i < 4; i++) {
      results.push({
        seq: i + 1,
        delay: randomFloat(5, 50),
        ttl: randomInt(54, 64),
        success: true,
      });
    }

    const delays = results.map(r => r.delay);
    return {
      target,
      sent: 4,
      received: 4,
      lost: 0,
      min: Math.min(...delays),
      max: Math.max(...delays),
      avg: Math.round((delays.reduce((a, b) => a + b, 0) / 4) * 100) / 100,
      results,
    };
  }

  /** 获取流量统计（模拟） */
  getTrafficStats(): TrafficStats {
    return {
      wan_rx: `${randomInt(100, 9999)} MB`,
      wan_tx: `${randomInt(50, 5000)} MB`,
      lan_rx: `${randomInt(500, 20000)} MB`,
      lan_tx: `${randomInt(200, 10000)} MB`,
      wifi_rx: `${randomInt(1000, 30000)} MB`,
      wifi_tx: `${randomInt(500, 15000)} MB`,
      current_download: `${randomInt(100, 50000)} KB/s`,
      current_upload: `${randomInt(50, 10000)} KB/s`,
    };
  }

  /** 获取所有连接设备 */
  getConnectedDevices(): ConnectedDevice[] {
    return [
      ...this.getWifiClients(),
      {
        mac: 'AA:BB:CC:DD:EE:01',
        device_name: 'Desktop PC',
        ip: '192.168.31.10',
        connection_type: '有线',
        port: 'LAN1',
        rx_rate: '1000 Mbps',
        tx_rate: '1000 Mbps',
      },
      {
        mac: 'AA:BB:CC:DD:EE:02',
        device_name: 'NAS Server',
        ip: '192.168.31.20',
        connection_type: '有线',
        port: 'LAN2',
        rx_rate: '1000 Mbps',
        tx_rate: '1000 Mbps',
      },
    ];
  }

  // ==================== 配置备份/恢复 ====================

  /** 获取完整配置快照 */
  getConfigSnapshot(): RouterConfig {
    return deepClone(this.config);
  }

  /** 从备份恢复配置 */
  restoreConfig(configData: RouterConfig): ApiResponse {
    try {
      this.config = deepClone(configData);
      this._logOperation('配置恢复', '配置已从备份恢复');
      return { success: true, message: '配置已恢复' };
    } catch (err) {
      return { success: false, message: `配置恢复失败: ${err}` };
    }
  }
}

// ==================== 导出单例工厂 ====================

let _instance: RouterManager | null = null;

/** 获取路由器管理器单例 */
export function getRouterManager(defaultConfig?: Partial<RouterConfig>): RouterManager {
  if (!_instance) {
    _instance = new RouterManager(defaultConfig);
  }
  return _instance;
}

/** 重置路由器管理器单例（用于测试） */
export function resetRouterManager(): void {
  _instance = null;
}
