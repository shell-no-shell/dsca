"""
路由器管理程序 - 配置文件
"""
import os

# 基础配置
SECRET_KEY = os.environ.get('SECRET_KEY', 'router-admin-secret-key-change-in-production')
DEBUG = os.environ.get('DEBUG', 'True').lower() == 'true'
HOST = '0.0.0.0'
PORT = 8080

# 会话配置
SESSION_TYPE = 'filesystem'
SESSION_PERMANENT = False
SESSION_USE_SIGNER = True

# 路由器默认配置
DEFAULT_CONFIG = {
    # 管理员账户
    'admin': {
        'username': 'admin',
        'password': 'admin123',  # 默认密码，首次登录会提示修改
        'email': 'admin@router.local'
    },
    # 工作模式: router(路由模式) | ap(AP模式) | repeater(中继模式) | bridge(桥接模式)
    'work_mode': 'router',
    # WAN口配置
    'wan': {
        'connection_type': 'dhcp',  # dhcp | static | pppoe
        'ip_address': '192.168.1.100',
        'subnet_mask': '255.255.255.0',
        'gateway': '192.168.1.1',
        'dns_primary': '8.8.8.8',
        'dns_secondary': '8.8.4.4',
        'pppoe_username': '',
        'pppoe_password': ''
    },
    # LAN口配置
    'lan': {
        'ip_address': '192.168.31.1',
        'subnet_mask': '255.255.255.0',
        'dhcp_enabled': True,
        'dhcp_start': '192.168.31.100',
        'dhcp_end': '192.168.31.200',
        'dhcp_lease_time': 86400  # 24小时
    },
    # WiFi配置 (2.4G)
    'wifi_2g': {
        'enabled': True,
        'ssid': 'Home_Router_2G',
        'password': 'wifi123456',
        'channel': 'auto',
        'encryption': 'WPA2-PSK',
        'hidden': False,
        'max_clients': 32
    },
    # WiFi配置 (5G)
    'wifi_5g': {
        'enabled': True,
        'ssid': 'Home_Router_5G',
        'password': 'wifi123456',
        'channel': 'auto',
        'encryption': 'WPA2-PSK',
        'hidden': False,
        'max_clients': 32
    },
    # 安全设置
    'security': {
        'remote_access': False,
        'remote_port': 8443,
        'ping_block': False,
        'mac_filter': {
            'enabled': False,
            'mode': 'allow',  # allow | deny
            'list': []
        },
        'url_filter': {
            'enabled': False,
            'list': []
        }
    },
    # 端口转发
    'port_forwarding': {
        'enabled': False,
        'rules': []
    },
    # DDNS
    'ddns': {
        'enabled': False,
        'provider': '',
        'hostname': '',
        'username': '',
        'password': ''
    },
    # 系统
    'system': {
        'hostname': 'HomeRouter',
        'timezone': 'Asia/Shanghai',
        'ntp_server': 'ntp.aliyun.com',
        'log_level': 'info',
        'auto_reboot': {
            'enabled': False,
            'schedule': 'weekly',  # daily | weekly | monthly
            'day': 'Sunday',
            'time': '03:00'
        }
    }
}
