/**
 * 家用路由器管理程序 - TypeScript 前端入口
 * 
 * 提供前端交互逻辑、API调用封装、表单验证等功能
 */

import {
  RouterConfig,
  RouterMode,
  RouterWorkMode,
  WifiBand,
  WifiBandConfig,
  WanConfig,
  LanConfig,
  PortForwardRule,
  MacFilterRule,
  SystemInfo,
  TrafficStats,
  ConnectedDevice,
  LogEntry,
  ApiResponse,
  ModeSwitchResponse,
  PingTestResponse,
  PasswordChangeRequest,
  WifiPasswordChangeRequest,
  isValidIP,
  isValidMAC,
  isValidPort,
  getPasswordStrength
} from './types.js';

// ==================== API 客户端 ====================

class RouterApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl;
  }

  private async request<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${url}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  // 系统信息
  async getSystemInfo(): Promise<SystemInfo> {
    return this.request('/api/system/info');
  }

  // 流量统计
  async getTrafficStats(): Promise<TrafficStats> {
    return this.request('/api/traffic/stats');
  }

  // 连接设备
  async getConnectedDevices(): Promise<ConnectedDevice[]> {
    return this.request('/api/clients');
  }

  // 操作日志
  async getLogs(limit: number = 50): Promise<LogEntry[]> {
    return this.request(`/api/logs?limit=${limit}`);
  }

  // 模式切换
  async switchMode(mode: RouterWorkMode): Promise<ModeSwitchResponse> {
    return this.request('/api/mode/switch', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    });
  }

  // 修改管理员密码
  async changeAdminPassword(data: PasswordChangeRequest): Promise<ApiResponse> {
    return this.request('/api/password/admin', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // 修改WiFi密码
  async changeWifiPassword(data: WifiPasswordChangeRequest): Promise<ApiResponse> {
    return this.request('/api/password/wifi', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // 更新WiFi设置
  async updateWifiSettings(band: WifiBand, settings: Partial<WifiBandConfig>): Promise<ApiResponse> {
    return this.request('/api/wifi/update', {
      method: 'POST',
      body: JSON.stringify({ band, settings }),
    });
  }

  // 更新WAN设置
  async updateWanSettings(settings: Partial<WanConfig>): Promise<ApiResponse> {
    return this.request('/api/network/wan', {
      method: 'POST',
      body: JSON.stringify(settings),
    });
  }

  // 更新LAN设置
  async updateLanSettings(settings: Partial<LanConfig>): Promise<ApiResponse> {
    return this.request('/api/network/lan', {
      method: 'POST',
      body: JSON.stringify(settings),
    });
  }

  // 端口转发
  async addPortForwardRule(rule: Omit<PortForwardRule, 'id' | 'enabled'>): Promise<ApiResponse> {
    return this.request('/api/port_forwarding/add', {
      method: 'POST',
      body: JSON.stringify(rule),
    });
  }

  async removePortForwardRule(id: string): Promise<ApiResponse> {
    return this.request('/api/port_forwarding/remove', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
  }

  async togglePortForwardRule(id: string): Promise<ApiResponse> {
    return this.request('/api/port_forwarding/toggle', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
  }

  // MAC过滤
  async updateMacFilter(settings: { enabled: boolean; mode: string }): Promise<ApiResponse> {
    return this.request('/api/security/mac_filter', {
      method: 'POST',
      body: JSON.stringify(settings),
    });
  }

  async addMacFilterRule(mac: string, comment: string): Promise<ApiResponse> {
    return this.request('/api/security/mac_filter/add', {
      method: 'POST',
      body: JSON.stringify({ mac, comment }),
    });
  }

  async removeMacFilterRule(mac: string): Promise<ApiResponse> {
    return this.request('/api/security/mac_filter/remove', {
      method: 'POST',
      body: JSON.stringify({ mac }),
    });
  }

  // DDNS
  async updateDdnsSettings(settings: Record<string, any>): Promise<ApiResponse> {
    return this.request('/api/ddns/update', {
      method: 'POST',
      body: JSON.stringify(settings),
    });
  }

  // 系统
  async updateSystemSettings(settings: Record<string, any>): Promise<ApiResponse> {
    return this.request('/api/system/update', {
      method: 'POST',
      body: JSON.stringify(settings),
    });
  }

  async rebootRouter(): Promise<ApiResponse> {
    return this.request('/api/system/reboot', { method: 'POST' });
  }

  async resetRouter(): Promise<ApiResponse> {
    return this.request('/api/system/reset', { method: 'POST' });
  }

  // 诊断
  async pingTest(target: string = '8.8.8.8'): Promise<PingTestResponse> {
    return this.request('/api/diagnostics/ping', {
      method: 'POST',
      body: JSON.stringify({ target }),
    });
  }

  // 配置备份/恢复
  async backupConfig(): Promise<RouterConfig> {
    return this.request('/api/config/backup');
  }

  async restoreConfig(config: RouterConfig): Promise<ApiResponse> {
    return this.request('/api/config/restore', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }
}

// ==================== UI 工具函数 ====================

class ToastManager {
  private container: HTMLElement;

  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    document.body.appendChild(this.container);
  }

  show(message: string, type: 'success' | 'error' | 'warning' = 'success'): void {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    this.container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

class TabManager {
  init(): void {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const tabId = target.dataset.tab;
        const tabsContainer = target.closest('.tabs');

        if (!tabsContainer || !tabId) return;

        // 切换按钮状态
        tabsContainer.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        target.classList.add('active');

        // 切换内容
        tabsContainer.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        const targetTab = tabsContainer.querySelector(`#tab_${tabId}`);
        if (targetTab) {
          targetTab.classList.add('active');
        }
      });
    });
  }
}

class ModalManager {
  init(): void {
    // 关闭按钮
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const modal = target.closest('.modal') as HTMLElement;
        if (modal) modal.style.display = 'none';
      });
    });

    // 点击外部关闭
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          (modal as HTMLElement).style.display = 'none';
        }
      });
    });

    // 取消按钮
    document.querySelectorAll('#modalCancel').forEach(btn => {
      btn.addEventListener('click', () => {
        const modal = btn.closest('.modal') as HTMLElement;
        if (modal) modal.style.display = 'none';
      });
    });
  }

  show(modalId: string): void {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'flex';
  }

  hide(modalId: string): void {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
  }
}

// ==================== 表单验证器 ====================

class FormValidator {
  static validateIP(ip: string): boolean {
    return isValidIP(ip);
  }

  static validateMAC(mac: string): boolean {
    return isValidMAC(mac);
  }

  static validatePort(port: string): boolean {
    const num = parseInt(port, 10);
    return isValidPort(num);
  }

  static validatePassword(password: string, minLength: number = 6): { valid: boolean; message: string } {
    if (password.length < minLength) {
      return { valid: false, message: `密码长度不能少于${minLength}位` };
    }
    return { valid: true, message: '' };
  }

  static validatePasswordMatch(password: string, confirm: string): { valid: boolean; message: string } {
    if (password !== confirm) {
      return { valid: false, message: '两次输入的密码不一致' };
    }
    return { valid: true, message: '' };
  }

  static validateSSID(ssid: string): { valid: boolean; message: string } {
    if (ssid.length < 1 || ssid.length > 32) {
      return { valid: false, message: 'SSID长度必须在1-32个字符之间' };
    }
    return { valid: true, message: '' };
  }
}

// ==================== 自动刷新管理器 ====================

class AutoRefreshManager {
  private intervals: Map<string, number> = new Map();

  start(key: string, callback: () => void, intervalMs: number = 30000): void {
    this.stop(key);
    callback(); // 立即执行一次
    const id = window.setInterval(callback, intervalMs);
    this.intervals.set(key, id);
  }

  stop(key: string): void {
    const id = this.intervals.get(key);
    if (id) {
      clearInterval(id);
      this.intervals.delete(key);
    }
  }

  stopAll(): void {
    this.intervals.forEach((id) => clearInterval(id));
    this.intervals.clear();
  }
}

// ==================== 应用初始化 ====================

class RouterApp {
  api: RouterApiClient;
  toast: ToastManager;
  tabs: TabManager;
  modal: ModalManager;
  autoRefresh: AutoRefreshManager;

  constructor() {
    this.api = new RouterApiClient();
    this.toast = new ToastManager();
    this.tabs = new TabManager();
    this.modal = new ModalManager();
    this.autoRefresh = new AutoRefreshManager();
  }

  init(): void {
    console.log('路由器管理程序 v2.1.0 已加载');
    this.tabs.init();
    this.modal.init();
    this.initAutoRefresh();
  }

  private initAutoRefresh(): void {
    // 仪表盘页面自动刷新流量数据
    if (document.querySelector('.dashboard-page')) {
      this.autoRefresh.start('traffic', async () => {
        try {
          const stats = await this.api.getTrafficStats();
          this.updateTrafficDisplay(stats);
        } catch (err) {
          console.error('刷新流量数据失败:', err);
        }
      }, 30000);
    }
  }

  private updateTrafficDisplay(stats: TrafficStats): void {
    document.querySelectorAll('[data-traffic]').forEach(el => {
      const key = (el as HTMLElement).dataset.traffic;
      if (key && stats[key as keyof TrafficStats]) {
        el.textContent = stats[key as keyof TrafficStats] as string;
      }
    });
  }
}

// ==================== 导出 ====================

export {
  RouterApiClient,
  ToastManager,
  TabManager,
  ModalManager,
  FormValidator,
  AutoRefreshManager,
  RouterApp,
};

export default RouterApp;
