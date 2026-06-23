"""
路由器核心管理模块 - 模拟路由器硬件管理功能
包含模式切换、网络配置、WiFi管理、安全设置等核心功能
"""
import json
import os
import time
import threading
import hashlib
from datetime import datetime
from copy import deepcopy

# 配置文件路径
CONFIG_FILE = 'router_config.json'
LOG_FILE = 'router_operation.log'


class RouterManager:
    """路由器管理器 - 模拟底层路由器硬件操作"""

    def __init__(self, default_config=None):
        self.config = default_config or {}
        self._running = True
        self._uptime = time.time()
        self._lock = threading.Lock()
        self._operation_log = []
        self._load_config()

    # ==================== 配置持久化 ====================

    def _load_config(self):
        """从文件加载配置"""
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                    saved = json.load(f)
                    self._deep_update(self.config, saved)
                self._log_operation('系统启动', '配置已加载')
            except Exception as e:
                self._log_operation('系统启动', f'配置加载失败: {str(e)}，使用默认配置')
        else:
            self._save_config()
            self._log_operation('系统启动', '使用默认配置初始化')

    def _save_config(self):
        """保存配置到文件"""
        with self._lock:
            try:
                with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                    json.dump(self.config, f, ensure_ascii=False, indent=2)
                return True
            except Exception as e:
                self._log_operation('配置保存', f'失败: {str(e)}')
                return False

    def _deep_update(self, base, updates):
        """递归更新嵌套字典"""
        for key, value in updates.items():
            if key in base and isinstance(base[key], dict) and isinstance(value, dict):
                self._deep_update(base[key], value)
            else:
                base[key] = value

    # ==================== 日志记录 ====================

    def _log_operation(self, action, detail=''):
        """记录操作日志"""
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        log_entry = f'[{timestamp}] {action}: {detail}'
        self._operation_log.append({
            'timestamp': timestamp,
            'action': action,
            'detail': detail
        })
        # 同时写入文件
        try:
            with open(LOG_FILE, 'a', encoding='utf-8') as f:
                f.write(log_entry + '\n')
        except:
            pass
        # 保留最近1000条日志在内存
        if len(self._operation_log) > 1000:
            self._operation_log = self._operation_log[-1000:]

    def get_logs(self, limit=50):
        """获取操作日志"""
        return self._operation_log[-limit:]

    # ==================== 系统信息 ====================

    def get_system_info(self):
        """获取系统信息"""
        uptime_seconds = int(time.time() - self._uptime)
        days = uptime_seconds // 86400
        hours = (uptime_seconds % 86400) // 3600
        minutes = (uptime_seconds % 3600) // 60
        seconds = uptime_seconds % 60

        return {
            'hostname': self.config['system']['hostname'],
            'uptime': f'{days}天 {hours}小时 {minutes}分 {seconds}秒',
            'uptime_seconds': uptime_seconds,
            'current_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'timezone': self.config['system']['timezone'],
            'work_mode': self.config['work_mode'],
            'firmware_version': 'v2.1.0',
            'hardware_version': 'R3600 v1.0',
            'cpu_usage': self._get_cpu_usage(),
            'memory_usage': self._get_memory_usage(),
            'connections': self._get_active_connections()
        }

    def _get_cpu_usage(self):
        """模拟获取CPU使用率"""
        import random
        return round(random.uniform(5, 45), 1)

    def _get_memory_usage(self):
        """模拟获取内存使用率"""
        import random
        return round(random.uniform(30, 70), 1)

    def _get_active_connections(self):
        """模拟获取活跃连接数"""
        import random
        return random.randint(5, 50)

    # ==================== 模式切换 ====================

    def get_available_modes(self):
        """获取可用的路由器工作模式"""
        return [
            {
                'id': 'router',
                'name': '路由模式 (Router)',
                'description': '标准路由器模式，提供NAT、DHCP、防火墙等功能，适合家庭网络主路由',
                'icon': 'router'
            },
            {
                'id': 'ap',
                'name': 'AP模式 (Access Point)',
                'description': '接入点模式，将有线网络转换为WiFi信号，适合扩展有线网络覆盖',
                'icon': 'wifi'
            },
            {
                'id': 'repeater',
                'name': '中继模式 (Repeater)',
                'description': '无线中继模式，放大现有WiFi信号，适合扩展无线覆盖范围',
                'icon': 'swap'
            },
            {
                'id': 'bridge',
                'name': '桥接模式 (Bridge)',
                'description': '无线桥接模式，连接两个不同的网络段，适合网络互联',
                'icon': 'link'
            }
        ]

    def switch_mode(self, mode_id):
        """切换路由器工作模式"""
        valid_modes = [m['id'] for m in self.get_available_modes()]
        if mode_id not in valid_modes:
            return {'success': False, 'message': f'无效的模式: {mode_id}'}

        old_mode = self.config['work_mode']
        if old_mode == mode_id:
            return {'success': True, 'message': f'当前已经是{mode_id}模式，无需切换'}

        # 模拟模式切换过程
        self.config['work_mode'] = mode_id
        self._save_config()

        # 根据模式调整默认配置
        if mode_id == 'ap':
            self.config['lan']['dhcp_enabled'] = False
            self._log_operation('模式切换', f'从{old_mode}切换到AP模式，已禁用DHCP服务器')
        elif mode_id == 'repeater':
            self.config['lan']['dhcp_enabled'] = True
            self.config['wan']['connection_type'] = 'dhcp'
            self._log_operation('模式切换', f'从{old_mode}切换到中继模式')
        elif mode_id == 'bridge':
            self.config['lan']['dhcp_enabled'] = False
            self._log_operation('模式切换', f'从{old_mode}切换到桥接模式，已禁用DHCP服务器')
        else:  # router
            self.config['lan']['dhcp_enabled'] = True
            self._log_operation('模式切换', f'从{old_mode}切换到路由模式')

        self._save_config()

        return {
            'success': True,
            'message': f'模式切换成功！从"{old_mode}"切换到"{mode_id}"模式',
            'old_mode': old_mode,
            'new_mode': mode_id,
            'reboot_required': True
        }

    def get_current_mode(self):
        """获取当前工作模式"""
        mode_id = self.config['work_mode']
        modes = self.get_available_modes()
        for m in modes:
            if m['id'] == mode_id:
                return m
        return modes[0]

    # ==================== 密码管理 ====================

    def change_admin_password(self, old_password, new_password, confirm_password):
        """修改管理员密码"""
        if new_password != confirm_password:
            return {'success': False, 'message': '两次输入的新密码不一致'}

        if old_password != self.config['admin']['password']:
            return {'success': False, 'message': '当前密码错误'}

        if len(new_password) < 6:
            return {'success': False, 'message': '新密码长度不能少于6位'}

        if new_password == old_password:
            return {'success': False, 'message': '新密码不能与当前密码相同'}

        self.config['admin']['password'] = new_password
        self._save_config()
        self._log_operation('密码修改', '管理员密码已更改')
        return {'success': True, 'message': '密码修改成功'}

    def change_wifi_password(self, band, old_password, new_password, confirm_password):
        """修改WiFi密码"""
        if band not in ['wifi_2g', 'wifi_5g']:
            return {'success': False, 'message': '无效的WiFi频段'}

        if new_password != confirm_password:
            return {'success': False, 'message': '两次输入的新密码不一致'}

        if old_password != self.config[band]['password']:
            return {'success': False, 'message': '当前WiFi密码错误'}

        if len(new_password) < 8:
            return {'success': False, 'message': 'WiFi密码长度不能少于8位'}

        band_name = '2.4G' if band == 'wifi_2g' else '5G'
        self.config[band]['password'] = new_password
        self._save_config()
        self._log_operation('WiFi密码修改', f'{band_name}频段密码已更改')
        return {'success': True, 'message': f'{band_name} WiFi密码修改成功'}

    # ==================== WiFi管理 ====================

    def get_wifi_settings(self, band):
        """获取WiFi设置"""
        if band not in ['wifi_2g', 'wifi_5g']:
            return None
        return self.config[band].copy()

    def update_wifi_settings(self, band, settings):
        """更新WiFi设置"""
        if band not in ['wifi_2g', 'wifi_5g']:
            return {'success': False, 'message': '无效的WiFi频段'}

        band_name = '2.4G' if band == 'wifi_2g' else '5G'

        # 验证SSID
        if 'ssid' in settings:
            ssid = settings['ssid'].strip()
            if len(ssid) < 1 or len(ssid) > 32:
                return {'success': False, 'message': 'SSID长度必须在1-32个字符之间'}
            self.config[band]['ssid'] = ssid

        # 验证密码（如果提供）
        if 'password' in settings:
            pwd = settings['password']
            if len(pwd) > 0 and len(pwd) < 8:
                return {'success': False, 'message': 'WiFi密码长度不能少于8位'}
            if len(pwd) > 0:
                self.config[band]['password'] = pwd

        # 更新其他设置
        for key in ['enabled', 'channel', 'encryption', 'hidden', 'max_clients']:
            if key in settings:
                self.config[band][key] = settings[key]

        self._save_config()
        self._log_operation('WiFi设置更新', f'{band_name}频段配置已更新')
        return {'success': True, 'message': f'{band_name} WiFi设置已更新'}

    def get_wifi_clients(self):
        """获取已连接的WiFi客户端列表（模拟）"""
        import random
        clients = []
        mac_prefixes = ['AA:BB:CC', 'DD:EE:FF', '11:22:33', '44:55:66', '77:88:99']
        devices = ['iPhone 15', 'Xiaomi 14', 'MacBook Pro', 'iPad Air', 'Samsung TV',
                   'Google Pixel', 'Windows Laptop', 'Smart Speaker', 'PS5', 'Xbox']

        num_clients = random.randint(2, 8)
        for i in range(num_clients):
            clients.append({
                'mac': f'{random.choice(mac_prefixes)}:{random.randint(10,99):02X}:{random.randint(10,99):02X}',
                'device_name': random.choice(devices),
                'ip': f'192.168.31.{random.randint(2, 250)}',
                'band': random.choice(['2.4G', '5G']),
                'signal': random.randint(40, 100),
                'rx_rate': f'{random.randint(100, 866)} Mbps',
                'tx_rate': f'{random.randint(50, 433)} Mbps',
                'connected_time': f'{random.randint(1, 120)}分钟'
            })
        return clients

    # ==================== WAN配置 ====================

    def get_wan_settings(self):
        """获取WAN口设置"""
        return self.config['wan'].copy()

    def update_wan_settings(self, settings):
        """更新WAN口设置"""
        valid_types = ['dhcp', 'static', 'pppoe']
        if 'connection_type' in settings:
            if settings['connection_type'] not in valid_types:
                return {'success': False, 'message': '无效的连接类型'}

        for key in settings:
            if key in self.config['wan']:
                self.config['wan'][key] = settings[key]

        self._save_config()
        self._log_operation('WAN设置更新', f'连接类型: {self.config["wan"]["connection_type"]}')
        return {'success': True, 'message': 'WAN口设置已更新'}

    # ==================== LAN配置 ====================

    def get_lan_settings(self):
        """获取LAN口设置"""
        return self.config['lan'].copy()

    def update_lan_settings(self, settings):
        """更新LAN口设置"""
        for key in settings:
            if key in self.config['lan']:
                self.config['lan'][key] = settings[key]

        self._save_config()
        self._log_operation('LAN设置更新', f'LAN IP: {self.config["lan"]["ip_address"]}')
        return {'success': True, 'message': 'LAN口设置已更新'}

    # ==================== 端口转发 ====================

    def get_port_forwarding_rules(self):
        """获取端口转发规则列表"""
        return self.config['port_forwarding'].get('rules', [])

    def add_port_forwarding_rule(self, rule):
        """添加端口转发规则"""
        required = ['name', 'protocol', 'external_port', 'internal_ip', 'internal_port']
        for field in required:
            if field not in rule or not rule[field]:
                return {'success': False, 'message': f'缺少必填字段: {field}'}

        valid_protocols = ['TCP', 'UDP', 'BOTH']
        if rule['protocol'] not in valid_protocols:
            return {'success': False, 'message': '无效的协议类型'}

        rule['enabled'] = rule.get('enabled', True)
        rule['id'] = f'rule_{int(time.time())}_{len(self.config["port_forwarding"]["rules"])}'

        self.config['port_forwarding']['rules'].append(rule)
        self.config['port_forwarding']['enabled'] = True
        self._save_config()
        self._log_operation('端口转发添加', f'{rule["name"]}: {rule["external_port"]} -> {rule["internal_ip"]}:{rule["internal_port"]}')
        return {'success': True, 'message': '端口转发规则已添加', 'rule': rule}

    def remove_port_forwarding_rule(self, rule_id):
        """删除端口转发规则"""
        rules = self.config['port_forwarding']['rules']
        for i, rule in enumerate(rules):
            if rule.get('id') == rule_id:
                removed = rules.pop(i)
                self._save_config()
                self._log_operation('端口转发删除', f'{removed["name"]} 已删除')
                return {'success': True, 'message': '端口转发规则已删除'}
        return {'success': False, 'message': '未找到该规则'}

    def toggle_port_forwarding_rule(self, rule_id):
        """启用/禁用端口转发规则"""
        for rule in self.config['port_forwarding']['rules']:
            if rule.get('id') == rule_id:
                rule['enabled'] = not rule.get('enabled', True)
                self._save_config()
                status = '启用' if rule['enabled'] else '禁用'
                self._log_operation('端口转发切换', f'{rule["name"]} 已{status}')
                return {'success': True, 'message': f'规则已{status}', 'enabled': rule['enabled']}
        return {'success': False, 'message': '未找到该规则'}

    # ==================== MAC地址过滤 ====================

    def get_mac_filter_settings(self):
        """获取MAC地址过滤设置"""
        return self.config['security']['mac_filter'].copy()

    def update_mac_filter(self, settings):
        """更新MAC地址过滤设置"""
        if 'enabled' in settings:
            self.config['security']['mac_filter']['enabled'] = settings['enabled']
        if 'mode' in settings:
            if settings['mode'] in ['allow', 'deny']:
                self.config['security']['mac_filter']['mode'] = settings['mode']
        self._save_config()
        self._log_operation('MAC过滤更新', f'已{"启用" if self.config["security"]["mac_filter"]["enabled"] else "禁用"}')
        return {'success': True, 'message': 'MAC地址过滤设置已更新'}

    def add_mac_filter_rule(self, mac_address, comment=''):
        """添加MAC地址过滤规则"""
        import re
        if not re.match(r'^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$', mac_address):
            return {'success': False, 'message': '无效的MAC地址格式'}

        mac_upper = mac_address.upper()
        for item in self.config['security']['mac_filter']['list']:
            if item['mac'] == mac_upper:
                return {'success': False, 'message': '该MAC地址已存在'}

        self.config['security']['mac_filter']['list'].append({
            'mac': mac_upper,
            'comment': comment,
            'added_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        })
        self._save_config()
        self._log_operation('MAC过滤添加', f'{mac_upper} ({comment})')
        return {'success': True, 'message': 'MAC地址已添加'}

    def remove_mac_filter_rule(self, mac_address):
        """删除MAC地址过滤规则"""
        mac_upper = mac_address.upper()
        mac_list = self.config['security']['mac_filter']['list']
        for i, item in enumerate(mac_list):
            if item['mac'] == mac_upper:
                mac_list.pop(i)
                self._save_config()
                self._log_operation('MAC过滤删除', f'{mac_upper}')
                return {'success': True, 'message': 'MAC地址已删除'}
        return {'success': False, 'message': '未找到该MAC地址'}

    # ==================== DDNS配置 ====================

    def get_ddns_settings(self):
        """获取DDNS设置"""
        return self.config['ddns'].copy()

    def update_ddns_settings(self, settings):
        """更新DDNS设置"""
        for key in settings:
            if key in self.config['ddns']:
                self.config['ddns'][key] = settings[key]
        self._save_config()
        self._log_operation('DDNS更新', f'已{"启用" if self.config["ddns"]["enabled"] else "禁用"}')
        return {'success': True, 'message': 'DDNS设置已更新'}

    # ==================== 系统设置 ====================

    def get_system_settings(self):
        """获取系统设置"""
        return self.config['system'].copy()

    def update_system_settings(self, settings):
        """更新系统设置"""
        for key in settings:
            if key in self.config['system']:
                if key == 'auto_reboot' and isinstance(settings[key], dict):
                    self._deep_update(self.config['system']['auto_reboot'], settings[key])
                else:
                    self.config['system'][key] = settings[key]
        self._save_config()
        self._log_operation('系统设置更新', '系统配置已更新')
        return {'success': True, 'message': '系统设置已更新'}

    def reboot(self):
        """模拟重启路由器"""
        self._log_operation('系统重启', '路由器正在重启...')
        # 模拟重启过程
        time.sleep(0.5)
        self._uptime = time.time()
        return {'success': True, 'message': '路由器正在重启，请等待...'}

    def reset_factory(self):
        """恢复出厂设置"""
        from config import DEFAULT_CONFIG
        self.config = DEFAULT_CONFIG.copy()
        self._save_config()
        self._log_operation('恢复出厂', '路由器已恢复出厂设置')
        return {'success': True, 'message': '已恢复出厂设置，路由器将重启'}

    # ==================== 网络诊断 ====================

    def ping_test(self, target='8.8.8.8'):
        """模拟Ping测试"""
        import random
        import time

        results = []
        for i in range(4):
            delay = round(random.uniform(5, 50), 2)
            ttl = random.randint(54, 64)
            results.append({
                'seq': i + 1,
                'delay': delay,
                'ttl': ttl,
                'success': True
            })
            time.sleep(0.1)

        return {
            'target': target,
            'sent': 4,
            'received': 4,
            'lost': 0,
            'min': min(r['delay'] for r in results),
            'max': max(r['delay'] for r in results),
            'avg': round(sum(r['delay'] for r in results) / 4, 2),
            'results': results
        }

    def get_traffic_stats(self):
        """获取流量统计（模拟）"""
        import random
        return {
            'wan_rx': f'{random.randint(100, 9999)} MB',
            'wan_tx': f'{random.randint(50, 5000)} MB',
            'lan_rx': f'{random.randint(500, 20000)} MB',
            'lan_tx': f'{random.randint(200, 10000)} MB',
            'wifi_rx': f'{random.randint(1000, 30000)} MB',
            'wifi_tx': f'{random.randint(500, 15000)} MB',
            'current_download': f'{random.randint(100, 50000)} KB/s',
            'current_upload': f'{random.randint(50, 10000)} KB/s'
        }

    def get_connected_devices(self):
        """获取所有连接的设备列表"""
        return self.get_wifi_clients() + [
            {
                'mac': 'AA:BB:CC:DD:EE:01',
                'device_name': 'Desktop PC',
                'ip': '192.168.31.10',
                'connection_type': '有线',
                'port': 'LAN1',
                'rx_rate': '1000 Mbps',
                'tx_rate': '1000 Mbps'
            },
            {
                'mac': 'AA:BB:CC:DD:EE:02',
                'device_name': 'NAS Server',
                'ip': '192.168.31.20',
                'connection_type': '有线',
                'port': 'LAN2',
                'rx_rate': '1000 Mbps',
                'tx_rate': '1000 Mbps'
            }
        ]

    def get_config_snapshot(self):
        """获取完整配置快照（用于备份）"""
        return deepcopy(self.config)

    def restore_config(self, config_data):
        """从备份恢复配置"""
        try:
            self.config = config_data
            self._save_config()
            self._log_operation('配置恢复', '配置已从备份恢复')
            return {'success': True, 'message': '配置已恢复'}
        except Exception as e:
            return {'success': False, 'message': f'配置恢复失败: {str(e)}'}
