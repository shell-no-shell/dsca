/**
 * 家用路由器管理程序 - TypeScript 类型定义
 * 
 * 定义路由器配置、WiFi设置、安全设置等核心数据结构的接口
 */

// ==================== 路由器工作模式 ====================

/** 路由器工作模式枚举 */
export type RouterWorkMode = 'router' | 'ap' | 'repeater' | 'bridge';

/** 工作模式信息 */
export interface RouterMode {
  id: RouterWorkMode;
  name: string;
  description: string;
  icon: string;
}

// ==================== 网络配置 ====================

/** WAN口连接类型 */
export type WanConnectionType = 'dhcp' | 'static' | 'pppoe';

/** WAN口配置 */
export interface WanConfig {
  connection_type: WanConnectionType;
  ip_address: string;
  subnet_mask: string;
  gateway: string;
  dns_primary: string;
  dns_secondary: string;
  pppoe_username: string;
  pppoe_password: string;
}

/** LAN口配置 */
export interface LanConfig {
  ip_address: string;
  subnet_mask: string;
  dhcp_enabled: boolean;
  dhcp_start: string;
  dhcp_end: string;
  dhcp_lease_time: number;
}

// ==================== WiFi配置 ====================

/** WiFi加密方式 */
export type WifiEncryption = 'WPA2-PSK' | 'WPA3-SAE' | 'WPA2/WPA3';

/** WiFi频段配置 */
export interface WifiBandConfig {
  enabled: boolean;
  ssid: string;
  password: string;
  channel: string;
  encryption: WifiEncryption;
  hidden: boolean;
  max_clients: number;
}

/** WiFi频段标识 */
export type WifiBand = 'wifi_2g' | 'wifi_5g';

// ==================== 安全配置 ====================

/** MAC过滤模式 */
export type MacFilterMode = 'allow' | 'deny';

/** MAC地址过滤规则 */
export interface MacFilterRule {
  mac: string;
  comment: string;
  added_at: string;
}

/** MAC过滤配置 */
export interface MacFilterConfig {
  enabled: boolean;
  mode: MacFilterMode;
  list: MacFilterRule[];
}

/** 安全配置 */
export interface SecurityConfig {
  remote_access: boolean;
  remote_port: number;
  ping_block: boolean;
  mac_filter: MacFilterConfig;
  url_filter: {
    enabled: boolean;
    list: string[];
  };
}

// ==================== 端口转发 ====================

/** 端口转发协议 */
export type ForwardProtocol = 'TCP' | 'UDP' | 'BOTH';

/** 端口转发规则 */
export interface PortForwardRule {
  id: string;
  name: string;
  protocol: ForwardProtocol;
  external_port: string;
  internal_ip: string;
  internal_port: string;
  enabled: boolean;
}

/** 端口转发配置 */
export interface PortForwardConfig {
  enabled: boolean;
  rules: PortForwardRule[];
}

// ==================== DDNS ====================

/** DDNS服务提供商 */
export type DdnsProvider = '' | 'aliyun' | 'dnspod' | 'noip' | 'duckdns';

/** DDNS配置 */
export interface DdnsConfig {
  enabled: boolean;
  provider: DdnsProvider;
  hostname: string;
  username: string;
  password: string;
}

// ==================== 系统配置 ====================

/** 自动重启频率 */
export type RebootSchedule = 'daily' | 'weekly' | 'monthly';

/** 自动重启配置 */
export interface AutoRebootConfig {
  enabled: boolean;
  schedule: RebootSchedule;
  day: string;
  time: string;
}

/** 系统配置 */
export interface SystemConfig {
  hostname: string;
  timezone: string;
  ntp_server: string;
  log_level: string;
  auto_reboot: AutoRebootConfig;
}

// ==================== 管理员配置 ====================

/** 管理员账户配置 */
export interface AdminConfig {
  username: string;
  password: string;
  email: string;
}

// ==================== 完整路由器配置 ====================

/** 完整路由器配置 */
export interface RouterConfig {
  admin: AdminConfig;
  work_mode: RouterWorkMode;
  wan: WanConfig;
  lan: LanConfig;
  wifi_2g: WifiBandConfig;
  wifi_5g: WifiBandConfig;
  security: SecurityConfig;
  port_forwarding: PortForwardConfig;
  ddns: DdnsConfig;
  system: SystemConfig;
}

// ==================== API 响应类型 ====================

/** 通用API响应 */
export interface ApiResponse {
  success: boolean;
  message: string;
  [key: string]: any;
}

/** 模式切换响应 */
export interface ModeSwitchResponse extends ApiResponse {
  old_mode?: string;
  new_mode?: string;
  reboot_required?: boolean;
}

/** Ping测试结果 */
export interface PingResult {
  seq: number;
  delay: number;
  ttl: number;
  success: boolean;
}

/** Ping测试响应 */
export interface PingTestResponse {
  target: string;
  sent: number;
  received: number;
  lost: number;
  min: number;
  max: number;
  avg: number;
  results: PingResult[];
}

// ==================== 系统信息类型 ====================

/** 系统信息 */
export interface SystemInfo {
  hostname: string;
  uptime: string;
  uptime_seconds: number;
  current_time: string;
  timezone: string;
  work_mode: string;
  firmware_version: string;
  hardware_version: string;
  cpu_usage: number;
  memory_usage: number;
  connections: number;
}

/** 流量统计 */
export interface TrafficStats {
  wan_rx: string;
  wan_tx: string;
  lan_rx: string;
  lan_tx: string;
  wifi_rx: string;
  wifi_tx: string;
  current_download: string;
  current_upload: string;
}

// ==================== 设备类型 ====================

/** WiFi客户端设备 */
export interface WifiClient {
  mac: string;
  device_name: string;
  ip: string;
  band: string;
  signal: number;
  rx_rate: string;
  tx_rate: string;
  connected_time: string;
}

/** 有线连接设备 */
export interface WiredDevice {
  mac: string;
  device_name: string;
  ip: string;
  connection_type: string;
  port: string;
  rx_rate: string;
  tx_rate: string;
}

/** 连接设备联合类型 */
export type ConnectedDevice = WifiClient | WiredDevice;

// ==================== 操作日志 ====================

/** 操作日志条目 */
export interface LogEntry {
  timestamp: string;
  action: string;
  detail: string;
}

// ==================== 密码修改 ====================

/** 密码修改请求 */
export interface PasswordChangeRequest {
  old_password: string;
  new_password: string;
  confirm_password: string;
}

/** WiFi密码修改请求 */
export interface WifiPasswordChangeRequest extends PasswordChangeRequest {
  band: WifiBand;
}

// ==================== 表单验证 ====================

/** 表单验证结果 */
export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

/** IP地址验证 */
export function isValidIP(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255 && part === num.toString();
  });
}

/** MAC地址验证 */
export function isValidMAC(mac: string): boolean {
  return /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(mac);
}

/** 端口号验证 */
export function isValidPort(port: number): boolean {
  return port >= 1 && port <= 65535;
}

/** 密码强度验证 */
export function getPasswordStrength(password: string): 'weak' | 'medium' | 'strong' {
  if (password.length < 8) return 'weak';
  let score = 0;
  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  if (password.length >= 12) score++;
  if (score <= 2) return 'weak';
  if (score <= 3) return 'medium';
  return 'strong';
}
