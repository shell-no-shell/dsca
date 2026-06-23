/**
 * 家用路由器管理程序 - JavaScript
 */

// ==================== Toast 通知系统 ====================
function showToast(message, type = 'success') {
    // 创建容器
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    // 创建toast
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    // 自动移除
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ==================== Tab 切换 ====================
document.addEventListener('DOMContentLoaded', function() {
    // Tab切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const tabId = this.dataset.tab;
            const tabsContainer = this.closest('.tabs');

            // 切换按钮状态
            tabsContainer.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            // 切换内容
            tabsContainer.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            const targetTab = tabsContainer.querySelector(`#tab_${tabId}`);
            if (targetTab) {
                targetTab.classList.add('active');
            }
        });
    });

    // 弹窗关闭
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', function() {
            this.closest('.modal').style.display = 'none';
        });
    });

    // 点击弹窗外部关闭
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                this.style.display = 'none';
            }
        });
    });

    // 弹窗取消按钮
    document.querySelectorAll('#modalCancel').forEach(btn => {
        btn.addEventListener('click', function() {
            this.closest('.modal').style.display = 'none';
        });
    });
});

// ==================== 表单验证 ====================
function validateIPAddress(ip) {
    const parts = ip.split('.');
    if (parts.length !== 4) return false;
    return parts.every(part => {
        const num = parseInt(part, 10);
        return num >= 0 && num <= 255 && part === num.toString();
    });
}

function validateMACAddress(mac) {
    return /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(mac);
}

function validatePort(port) {
    const num = parseInt(port, 10);
    return num >= 1 && num <= 65535;
}

// ==================== 自动刷新 ====================
// 仪表盘自动刷新（每30秒）
if (document.querySelector('.dashboard-page')) {
    setInterval(() => {
        // 静默刷新流量数据
        fetch('/api/traffic/stats')
            .then(r => r.json())
            .then(data => {
                // 更新流量显示
                document.querySelectorAll('[data-traffic]').forEach(el => {
                    const key = el.dataset.traffic;
                    if (data[key]) {
                        el.textContent = data[key];
                    }
                });
            })
            .catch(() => {});
    }, 30000);
}

console.log('路由器管理程序 v2.1.0 已加载');
