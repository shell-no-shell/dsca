"""
家用路由器管理程序 - Flask Web应用
提供Web管理界面，支持路由器模式切换、密码管理、网络配置等功能
"""
import os
import sys
from functools import wraps
from flask import (
    Flask, render_template, request, redirect,
    url_for, session, jsonify, flash
)

# 将当前目录加入Python路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import DEFAULT_CONFIG
from router_manager import RouterManager

app = Flask(__name__)
app.config.from_object('config')

# 初始化路由器管理器
router = RouterManager(DEFAULT_CONFIG)


# ==================== 登录装饰器 ====================

def login_required(f):
    """登录验证装饰器"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function


# ==================== 认证路由 ====================

@app.route('/login', methods=['GET', 'POST'])
def login():
    """登录页面"""
    if session.get('logged_in'):
        return redirect(url_for('dashboard'))

    error = None
    if request.method == 'POST':
        username = request.form.get('username', '')
        password = request.form.get('password', '')

        if (username == router.config['admin']['username'] and
                password == router.config['admin']['password']):
            session['logged_in'] = True
            session['username'] = username
            session['ip_address'] = request.remote_addr
            router._log_operation('用户登录', f'用户 {username} 从 {request.remote_addr} 登录')
            return redirect(url_for('dashboard'))
        else:
            error = '用户名或密码错误'

    return render_template('login.html', error=error)


@app.route('/logout')
def logout():
    """退出登录"""
    if session.get('logged_in'):
        router._log_operation('用户登出', f'用户 {session.get("username")} 登出')
    session.clear()
    return redirect(url_for('login'))


# ==================== 仪表盘 ====================

@app.route('/')
@login_required
def dashboard():
    """仪表盘主页"""
    system_info = router.get_system_info()
    traffic = router.get_traffic_stats()
    clients = router.get_wifi_clients()
    current_mode = router.get_current_mode()

    return render_template(
        'dashboard.html',
        system_info=system_info,
        traffic=traffic,
        clients=clients,
        current_mode=current_mode
    )


# ==================== 模式切换 ====================

@app.route('/mode')
@login_required
def mode_settings():
    """模式设置页面"""
    current_mode = router.get_current_mode()
    available_modes = router.get_available_modes()
    return render_template(
        'mode.html',
        current_mode=current_mode,
        available_modes=available_modes
    )


@app.route('/api/mode/switch', methods=['POST'])
@login_required
def api_switch_mode():
    """API: 切换路由器模式"""
    data = request.get_json()
    mode_id = data.get('mode', '')
    result = router.switch_mode(mode_id)
    return jsonify(result)


# ==================== 密码管理 ====================

@app.route('/password')
@login_required
def password_settings():
    """密码设置页面"""
    return render_template('password.html')


@app.route('/api/password/admin', methods=['POST'])
@login_required
def api_change_admin_password():
    """API: 修改管理员密码"""
    data = request.get_json()
    result = router.change_admin_password(
        data.get('old_password', ''),
        data.get('new_password', ''),
        data.get('confirm_password', '')
    )
    return jsonify(result)


@app.route('/api/password/wifi', methods=['POST'])
@login_required
def api_change_wifi_password():
    """API: 修改WiFi密码"""
    data = request.get_json()
    result = router.change_wifi_password(
        data.get('band', ''),
        data.get('old_password', ''),
        data.get('new_password', ''),
        data.get('confirm_password', '')
    )
    return jsonify(result)


# ==================== WiFi设置 ====================

@app.route('/wifi')
@login_required
def wifi_settings():
    """WiFi设置页面"""
    wifi_2g = router.get_wifi_settings('wifi_2g')
    wifi_5g = router.get_wifi_settings('wifi_5g')
    clients = router.get_wifi_clients()
    return render_template(
        'wifi.html',
        wifi_2g=wifi_2g,
        wifi_5g=wifi_5g,
        clients=clients
    )


@app.route('/api/wifi/update', methods=['POST'])
@login_required
def api_update_wifi():
    """API: 更新WiFi设置"""
    data = request.get_json()
    band = data.get('band', '')
    settings = data.get('settings', {})
    result = router.update_wifi_settings(band, settings)
    return jsonify(result)


# ==================== 网络设置 ====================

@app.route('/network')
@login_required
def network_settings():
    """网络设置页面"""
    wan = router.get_wan_settings()
    lan = router.get_lan_settings()
    return render_template('network.html', wan=wan, lan=lan)


@app.route('/api/network/wan', methods=['POST'])
@login_required
def api_update_wan():
    """API: 更新WAN设置"""
    data = request.get_json()
    result = router.update_wan_settings(data)
    return jsonify(result)


@app.route('/api/network/lan', methods=['POST'])
@login_required
def api_update_lan():
    """API: 更新LAN设置"""
    data = request.get_json()
    result = router.update_lan_settings(data)
    return jsonify(result)


# ==================== 端口转发 ====================

@app.route('/port_forwarding')
@login_required
def port_forwarding():
    """端口转发页面"""
    rules = router.get_port_forwarding_rules()
    return render_template('port_forwarding.html', rules=rules)


@app.route('/api/port_forwarding/add', methods=['POST'])
@login_required
def api_add_port_forwarding():
    """API: 添加端口转发规则"""
    data = request.get_json()
    result = router.add_port_forwarding_rule(data)
    return jsonify(result)


@app.route('/api/port_forwarding/remove', methods=['POST'])
@login_required
def api_remove_port_forwarding():
    """API: 删除端口转发规则"""
    data = request.get_json()
    result = router.remove_port_forwarding_rule(data.get('id', ''))
    return jsonify(result)


@app.route('/api/port_forwarding/toggle', methods=['POST'])
@login_required
def api_toggle_port_forwarding():
    """API: 切换端口转发规则状态"""
    data = request.get_json()
    result = router.toggle_port_forwarding_rule(data.get('id', ''))
    return jsonify(result)


# ==================== 安全设置 ====================

@app.route('/security')
@login_required
def security_settings():
    """安全设置页面"""
    mac_filter = router.get_mac_filter_settings()
    return render_template('security.html', mac_filter=mac_filter)


@app.route('/api/security/mac_filter', methods=['POST'])
@login_required
def api_update_mac_filter():
    """API: 更新MAC过滤设置"""
    data = request.get_json()
    result = router.update_mac_filter(data)
    return jsonify(result)


@app.route('/api/security/mac_filter/add', methods=['POST'])
@login_required
def api_add_mac_filter():
    """API: 添加MAC过滤规则"""
    data = request.get_json()
    result = router.add_mac_filter_rule(
        data.get('mac', ''),
        data.get('comment', '')
    )
    return jsonify(result)


@app.route('/api/security/mac_filter/remove', methods=['POST'])
@login_required
def api_remove_mac_filter():
    """API: 删除MAC过滤规则"""
    data = request.get_json()
    result = router.remove_mac_filter_rule(data.get('mac', ''))
    return jsonify(result)


# ==================== DDNS ====================

@app.route('/ddns')
@login_required
def ddns_settings():
    """DDNS设置页面"""
    ddns = router.get_ddns_settings()
    return render_template('ddns.html', ddns=ddns)


@app.route('/api/ddns/update', methods=['POST'])
@login_required
def api_update_ddns():
    """API: 更新DDNS设置"""
    data = request.get_json()
    result = router.update_ddns_settings(data)
    return jsonify(result)


# ==================== 系统设置 ====================

@app.route('/system')
@login_required
def system_settings():
    """系统设置页面"""
    system = router.get_system_settings()
    logs = router.get_logs(100)
    return render_template('system.html', system=system, logs=logs)


@app.route('/api/system/update', methods=['POST'])
@login_required
def api_update_system():
    """API: 更新系统设置"""
    data = request.get_json()
    result = router.update_system_settings(data)
    return jsonify(result)


@app.route('/api/system/reboot', methods=['POST'])
@login_required
def api_reboot():
    """API: 重启路由器"""
    result = router.reboot()
    return jsonify(result)


@app.route('/api/system/reset', methods=['POST'])
@login_required
def api_reset():
    """API: 恢复出厂设置"""
    result = router.reset_factory()
    return jsonify(result)


# ==================== 诊断工具 ====================

@app.route('/diagnostics')
@login_required
def diagnostics():
    """诊断工具页面"""
    return render_template('diagnostics.html')


@app.route('/api/diagnostics/ping', methods=['POST'])
@login_required
def api_ping():
    """API: Ping测试"""
    data = request.get_json()
    target = data.get('target', '8.8.8.8')
    result = router.ping_test(target)
    return jsonify(result)


# ==================== API数据接口 ====================

@app.route('/api/system/info')
@login_required
def api_system_info():
    """API: 获取系统信息"""
    return jsonify(router.get_system_info())


@app.route('/api/traffic/stats')
@login_required
def api_traffic_stats():
    """API: 获取流量统计"""
    return jsonify(router.get_traffic_stats())


@app.route('/api/clients')
@login_required
def api_clients():
    """API: 获取连接设备列表"""
    return jsonify(router.get_connected_devices())


@app.route('/api/logs')
@login_required
def api_logs():
    """API: 获取操作日志"""
    limit = request.args.get('limit', 50, type=int)
    return jsonify(router.get_logs(limit))


# ==================== 配置备份 ====================

@app.route('/api/config/backup', methods=['GET'])
@login_required
def api_config_backup():
    """API: 备份配置"""
    config = router.get_config_snapshot()
    return jsonify(config)


@app.route('/api/config/restore', methods=['POST'])
@login_required
def api_config_restore():
    """API: 恢复配置"""
    data = request.get_json()
    result = router.restore_config(data)
    return jsonify(result)


# ==================== 启动 ====================

if __name__ == '__main__':
    print("=" * 60)
    print("  家用路由器管理程序 v2.1.0")
    print("=" * 60)
    print(f"  管理地址: http://{app.config.get('HOST', '0.0.0.0')}:{app.config.get('PORT', 5000)}")
    print(f"  默认用户名: admin")
    print(f"  默认密码: admin123")
    print("=" * 60)
    print("  提示: 首次登录后请立即修改默认密码！")
    print("=" * 60)

    app.run(
        host=app.config.get('HOST', '0.0.0.0'),
        port=app.config.get('PORT', 5000),
        debug=app.config.get('DEBUG', True)
    )
