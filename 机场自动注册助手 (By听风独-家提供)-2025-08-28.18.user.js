// ==UserScript==
// @name         机场自动注册助手 (By听风独-家提供)
// @namespace    http://tampermonkey.net/
// @version      2025-08-29.1 (V7.5 架构重构与哲学增强版)
// @description  【V7.5 重构版】史诗级更新！代码架构全面重构，模块化设计，可读性、可维护性、健壮性指数级提升！1. 新增大量中文注释，二次开发易如反掌。2. 优化核心引擎与UI逻辑，运行更流畅，错误处理更完善。3. 为未来的星辰大海（AI识别、云同步）奠定坚实基础！
// @author       中国听风 & Gemini (Hybrid Intelligence Version 7.5 - Refactored)
// @match        http://*/*
// @match        https://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      accounts.google.com
// @connect      ip-api.com
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // --- 模块 1: 状态管理器 (State Manager) ---
    // 集中管理脚本的所有状态，包括用户配置和运行时变量
    const State = {
        // 用户配置 (会从 GM 存储加载)
        config: {
            email: 'user' + Date.now().toString().slice(-6) + '@gmail.com',
            password: 'pass' + Math.random().toString(36).substring(2, 10),
            autoFillEnabled: true,
            autoRegisterEnabled: false,
            showDetailedProcess: true,
            isMinimized: false,
            isLocked: false,
            appsScriptUrl: ''
        },
        // 运行时状态 (不会持久化)
        runtime: {
            isScriptRunning: false,
            taskStartTime: 0,
            progressLogContent: '',
            postClickObserver: null,
            isSelecting: false,
            selectingFor: null,
            selectingForCustomIndex: -1,
            verificationCodeResolver: null,
            toastTimer: null,
            policy: null, // for Trusted Types API
            customProfiles: {},
            currentProfile: {}
        },

        /**
         * 初始化状态，从 GM 存储中加载用户配置
         */
        init() {
            this.config.email = GM_getValue('savedEmail', this.config.email);
            this.config.password = GM_getValue('savedPassword', this.config.password);
            this.config.autoFillEnabled = GM_getValue('autoFillEnabled', this.config.autoFillEnabled);
            this.config.autoRegisterEnabled = GM_getValue('autoRegisterEnabled', this.config.autoRegisterEnabled);
            this.config.showDetailedProcess = GM_getValue('showDetailedProcess', this.config.showDetailedProcess);
            this.config.isMinimized = GM_getValue('isMinimized', this.config.isMinimized);
            this.config.isLocked = GM_getValue('isLocked', this.config.isLocked);
            this.config.appsScriptUrl = GM_getValue('appsScriptUrl', this.config.appsScriptUrl);
            this.runtime.customProfiles = GM_getValue('customProfiles', {});

            // 初始化 Trusted Types Policy，增强安全性
            if (window.trustedTypes && window.trustedTypes.createPolicy) {
                try {
                    this.runtime.policy = window.trustedTypes.createPolicy('script-ui-policy', { createHTML: input => input });
                } catch (e) { /* Policy 可能已存在 */ }
            }
        },

        /**
         * 安全地设置元素的 innerHTML
         * @param {HTMLElement} element - 目标元素
         * @param {string} html - 要设置的 HTML 字符串
         */
        setHTML(element, html) {
            if (this.runtime.policy) {
                element.innerHTML = this.runtime.policy.createHTML(html);
            } else {
                element.innerHTML = html;
            }
        }
    };

    // --- 模块 2: 日志记录器 (Logger) ---
    // 统一处理所有日志输出，包括控制台和UI界面
    const Logger = {
        /**
         * 在UI界面添加一条日志
         * @param {string} message - 日志消息
         * @param {'success'|'error'|'pending'} status - 日志状态
         */
        add(message, status = 'pending') {
            if (!UI.elements.logList) return;
            const li = document.createElement('li');
            const iconMap = { pending: '⏳', success: '✅', error: '❌' };
            const icon = iconMap[status] || '➡️';
            const html = `${icon} ${message}`;
            State.setHTML(li, html);
            if (status === 'error') li.classList.add('error');
            while (UI.elements.logList.children.length > 10) {
                UI.elements.logList.removeChild(UI.elements.logList.firstChild);
            }
            UI.elements.logList.appendChild(li);
            UI.elements.logList.scrollTop = UI.elements.logList.scrollHeight;
        },

        /**
         * 清空UI日志列表
         */
        clear() {
            if (UI.elements.logList) State.setHTML(UI.elements.logList, '');
        }
    };

    // --- 模块 3: UI 管理器 (UI Manager) ---
    // 负责创建、管理和更新所有界面元素
    const UI = {
        elements: {}, // 存储所有UI元素的引用

        /**
         * 创建完整的脚本UI界面
         */
        create() {
            if (document.getElementById('helper-container')) return;

            // 1. 注入CSS样式
            this.injectCSS();

            // 2. 创建主容器和所有内部HTML
            const container = document.createElement('div');
            container.id = 'helper-container';
            container.classList.add('tf-helper-ignore');
            State.setHTML(container, this.getContainerHTML());
            document.body.appendChild(container);

            const progressModal = document.createElement('div');
            progressModal.id = 'progress-modal-overlay';
            progressModal.classList.add('tf-helper-ignore');
            State.setHTML(progressModal, this.getProgressModalHTML());
            document.body.appendChild(progressModal);

            const customFieldModal = document.createElement('div');
            customFieldModal.id = 'custom-field-modal-overlay';
            customFieldModal.classList.add('tf-helper-ignore');
            State.setHTML(customFieldModal, this.getCustomFieldModalHTML());
            document.body.appendChild(customFieldModal);

            const tutorialModal = document.createElement('div');
            tutorialModal.id = 'tutorial-modal-overlay';
            tutorialModal.classList.add('tf-helper-ignore');
            State.setHTML(tutorialModal, this.getTutorialModalHTML());
            document.body.appendChild(tutorialModal);

            const selectorOverlay = document.createElement('div');
            selectorOverlay.id = 'selector-mode-overlay';
            selectorOverlay.classList.add('tf-helper-ignore');
            document.body.appendChild(selectorOverlay);

            const toast = document.createElement('div');
            toast.id = 'helper-toast-notification';
            toast.classList.add('tf-helper-ignore');
            State.setHTML(toast, `<span id="helper-toast-message"></span><button id="helper-toast-close-btn">&times;</button>`);
            document.body.appendChild(toast);

            // 3. 缓存所有元素的引用
            this.cacheElements();
        },

        /**
         * 缓存所有UI元素的引用以便快速访问
         */
        cacheElements() {
            const ids = [
                'helper-container', 'email-input', 'password-input', 'lock-btn', 'unlock-message',
                'random-btn', 'start-stop-btn', 'minimize-btn', 'autofill-toggle', 'autoregister-toggle',
                'show-detailed-toggle', 'helper-log-list', 'progress-modal-overlay', 'helper-main-view',
                'helper-custom-view', 'helper-settings-view', 'helper-mailbox-view', 'goto-custom-btn',
                'return-main-btn', 'goto-settings-btn', 'return-main-from-settings-btn', 'goto-mailbox-btn',
                'return-main-from-mailbox-btn', 'refresh-mailbox-btn', 'mailbox-list', 'save-profile-btn',
                'export-profile-btn', 'import-profile-btn', 'selector-mode-overlay', 'custom-fields-container',
                'add-custom-field-btn', 'custom-field-modal-overlay', 'custom-field-name', 'custom-field-action',
                'custom-field-value', 'save-custom-field-btn', 'cancel-custom-field-btn', 'progress-modal-title',
                'progress-bar-fill', 'progress-percentage', 'progress-time', 'progress-log-list',
                'progress-modal-close-btn', 'copy-log-btn', 'apps-script-url-input', 'save-settings-btn',
                'force-auth-btn', 'show-tutorial-btn', 'tutorial-modal-overlay', 'tutorial-modal-close-btn',
                'copy-apps-script-code-btn', 'helper-toast-notification', 'helper-toast-message', 'helper-toast-close-btn'
            ];
            ids.forEach(id => {
                const camelCaseId = id.replace(/-(\w)/g, (_, c) => c.toUpperCase());
                this.elements[camelCaseId] = document.getElementById(id);
            });
        },

        /**
         * 根据当前状态初始化UI显示
         */
        initializeState() {
            this.elements.emailInput.value = State.config.email;
            this.elements.passwordInput.value = State.config.password;
            this.elements.autofillToggle.checked = State.config.autoFillEnabled;
            this.elements.autoregisterToggle.checked = State.config.autoRegisterEnabled;
            this.elements.showDetailedToggle.checked = State.config.showDetailedProcess;
            this.elements.appsScriptUrlInput.value = State.config.appsScriptUrl;
            if (State.config.isMinimized) this.elements.helperContainer.classList.add('minimized');
            this.updateLockUI();
            this.updateStartStopButtonUI();
            this.fetchIpInfo();
            if (!State.config.appsScriptUrl) {
                Logger.add('请先配置邮件读取链接', 'error');
            } else {
                Logger.add('脚本已就绪。', 'success');
            }
        },

        /**
         * 更新锁定按钮和输入框状态
         */
        updateLockUI() {
            const isLocked = State.config.isLocked;
            this.elements.lockBtn.textContent = isLocked ? '解锁' : '锁定';
            this.elements.emailInput.disabled = isLocked;
            this.elements.passwordInput.disabled = isLocked;
            this.elements.unlockMessage.textContent = isLocked ? `已锁定` : '';
        },

        /**
         * 更新开始/停止按钮的文本和颜色
         */
        updateStartStopButtonUI() {
            if (State.runtime.isScriptRunning) {
                this.elements.startStopBtn.textContent = '停止运行';
                this.elements.startStopBtn.style.backgroundColor = 'var(--helper-danger-color)';
            } else {
                this.elements.startStopBtn.textContent = '开始运行';
                this.elements.startStopBtn.style.backgroundColor = 'var(--helper-success-color)';
            }
        },

        /**
         * 显示/隐藏不同的视图
         * @param {HTMLElement} viewToShow - 要显示的视图元素
         */
        showView(viewToShow) {
            [this.elements.helperMainView, this.elements.helperCustomView, this.elements.helperSettingsView, this.elements.helperMailboxView].forEach(view => {
                if (view) view.style.display = view === viewToShow ? 'flex' : 'none';
            });
        },

        /**
         * 显示Toast通知
         * @param {string} message - 通知内容
         */
        showToastNotification(message) {
            if (State.runtime.toastTimer) clearTimeout(State.runtime.toastTimer);
            this.elements.helperToastMessage.textContent = message;
            this.elements.helperToastNotification.classList.add('show');
            State.runtime.toastTimer = setTimeout(() => {
                this.elements.helperToastNotification.classList.remove('show');
            }, 2000);
        },

        /**
         * 显示进度模态框
         * @param {string} [title="任务执行中..."] - 模态框标题
         */
        showProgressModal(title = "任务执行中...") {
            if (!this.elements.progressModalOverlay) return;
            State.runtime.progressLogContent = '';
            State.setHTML(this.elements.progressLogList, '');
            this.elements.progressModalTitle.textContent = title;
            this.elements.progressModalOverlay.style.display = 'flex';
        },

        /**
         * 隐藏进度模态框
         */
        hideProgressModal() {
            if (this.elements.progressModalOverlay) this.elements.progressModalOverlay.style.display = 'none';
        },

        /**
         * 更新进度模态框的内容
         * @param {number|null} percentage - 进度百分比
         * @param {string} logMessage - 日志消息
         * @param {string} [logType='log-analyze'] - 日志类型 (用于着色)
         */
        updateProgress(percentage, logMessage, logType = 'log-analyze') {
            if (percentage !== null) {
                const clampedPercentage = Math.max(0, Math.min(100, percentage));
                this.elements.progressBarFill.style.width = `${clampedPercentage}%`;
                this.elements.progressPercentage.textContent = `${clampedPercentage}%`;
                if (clampedPercentage === 100 && logType !== 'log-monitor') {
                    if (logType === 'log-error' || logType === 'log-pause') {
                        this.elements.progressModalTitle.textContent = logType === 'log-error' ? '❌ 任务失败' : '⏸️ 操作暂停';
                    } else {
                        this.elements.progressModalTitle.textContent = '✅ 任务成功';
                        setTimeout(() => this.hideProgressModal(), 2000);
                    }
                }
            }
            const elapsedTime = ((Date.now() - State.runtime.taskStartTime) / 1000).toFixed(2);
            this.elements.progressTime.textContent = `已用时: ${elapsedTime}s`;
            const fullLogMessage = `[${elapsedTime}s] ${logMessage}`;
            const li = document.createElement('li');
            li.className = logType;
            li.textContent = fullLogMessage;
            this.elements.progressLogList.appendChild(li);
            this.elements.progressLogList.scrollTop = this.elements.progressLogList.scrollHeight;
            State.runtime.progressLogContent += fullLogMessage + '\n';
            const simpleMessage = logMessage.length > 30 ? logMessage.substring(0, 27) + '...' : logMessage;
            Logger.add(simpleMessage, 'pending');
        },

        /**
         * 获取IP信息并显示
         */
        fetchIpInfo() {
            const ipInfoElement = document.getElementById('helper-ip-info');
            if (!ipInfoElement) return;
            GM_xmlhttpRequest({
                method: "GET",
                url: "http://ip-api.com/json/",
                onload: (response) => {
                    try {
                        if (response.status === 200) {
                            const data = JSON.parse(response.responseText);
                            if (data.status === 'success') {
                                State.setHTML(ipInfoElement, `当前IP: ${data.query} (${data.country}, ${data.city})`);
                                ipInfoElement.style.color = '#28a745';
                            } else {
                                State.setHTML(ipInfoElement, '无法获取IP地理位置');
                                ipInfoElement.style.color = '#ffc107';
                            }
                        } else {
                            State.setHTML(ipInfoElement, `IP查询失败 (状态: ${response.status})`);
                            ipInfoElement.style.color = '#dc3545';
                        }
                    } catch (e) {
                        State.setHTML(ipInfoElement, '解析IP信息失败');
                        ipInfoElement.style.color = '#dc3545';
                    }
                },
                onerror: () => {
                    State.setHTML(ipInfoElement, '网络错误，无法查询IP');
                    ipInfoElement.style.color = '#dc3545';
                }
            });
        },

        // --- HTML 和 CSS 的 Getter 方法 ---
        // 将巨大的HTML和CSS字符串封装在方法中，使主逻辑更清晰
        getContainerHTML: () => `
            <div id="helper-ball-icon" class="tf-helper-ignore">✈️</div>
            <div class="helper-content tf-helper-ignore">
                <div id="helper-header" class="tf-helper-ignore"><span class="tf-helper-ignore">注册助手 V7.5 (重构版)</span><span id="minimize-btn" class="tf-helper-ignore">&times;</span></div>
                <div id="helper-ip-info" class="tf-helper-ignore" style="padding: 0.3rem 1rem; background-color: #f8f9fa; font-size: 0.75rem; text-align: center; border-bottom: 1px solid #e0e0e0;">正在获取IP信息...</div>
                <div id="helper-main-view">
                    <div id="helper-body" class="tf-helper-ignore">
                        <input type="text" id="email-input" class="tf-helper-ignore" placeholder="邮箱 (必须是Google邮箱)">
                        <input type="text" id="password-input" class="tf-helper-ignore" placeholder="密码">
                        <small id="unlock-message" class="tf-helper-ignore"></small>
                        <div class="button-group tf-helper-ignore">
                            <button id="lock-btn" class="tf-helper-ignore">锁定</button>
                            <button id="random-btn" class="tf-helper-ignore">随机生成</button>
                        </div>
                        <button id="start-stop-btn" class="helper-full-width-btn tf-helper-ignore">开始运行</button>
                        <div class="switch-container tf-helper-ignore"><span class="tf-helper-ignore">自动填充</span><label class="switch tf-helper-ignore"><input type="checkbox" id="autofill-toggle" class="tf-helper-ignore"><span class="slider tf-helper-ignore"></span></label></div>
                        <div class="switch-container tf-helper-ignore"><span class="tf-helper-ignore">自动注册/登录</span><label class="switch tf-helper-ignore"><input type="checkbox" id="autoregister-toggle" class="tf-helper-ignore"><span class="slider tf-helper-ignore"></span></label></div>
                        <div class="switch-container tf-helper-ignore"><span class="tf-helper-ignore">显示详细过程</span><label class="switch tf-helper-ignore"><input type="checkbox" id="show-detailed-toggle" class="tf-helper-ignore"><span class="slider tf-helper-ignore"></span></label></div>
                        <div class="button-group tf-helper-ignore" style="margin-top: 0.5rem;">
                            <button id="goto-mailbox-btn" style="background-color: var(--helper-success-color);">手动收信</button>
                            <button id="goto-custom-btn" style="background-color: var(--helper-warning-color); color: black;">自定义</button>
                            <button id="goto-settings-btn" style="background-color: #6c757d; grid-column: 1 / -1;">邮件设置</button>
                        </div>
                    </div>
                    <div id="helper-log-container" class="tf-helper-ignore"><h4 class="tf-helper-ignore">运行日志:</h4><ul id="helper-log-list" class="tf-helper-ignore"></ul></div>
                </div>
                <div id="helper-custom-view" class="tf-helper-ignore">
                    <div style="padding: 1rem; display: flex; flex-direction: column; gap: 0.8rem; max-height: 400px; overflow-y: auto;">
                        <h4>为 ${window.location.hostname} 自定义规则</h4>
                        <div class="custom-mapping-row"><label>邮箱</label><span id="map-email-selector" class="selector-display">未指定</span><button class="locator-btn unmapped" data-type="email" title="定位"></button><button class="reset-btn" data-type="email">⟲</button></div>
                        <div class="custom-mapping-row"><label>用户名</label><span id="map-username-selector" class="selector-display">未指定</span><button class="locator-btn unmapped" data-type="username" title="定位"></button><button class="reset-btn" data-type="username">⟲</button></div>
                        <div class="custom-mapping-row"><label>密码</label><span id="map-password-selector" class="selector-display">未指定</span><button class="locator-btn unmapped" data-type="password" title="定位"></button><button class="reset-btn" data-type="password">⟲</button></div>
                        <div class="custom-mapping-row"><label>确认密码</label><span id="map-passwordConfirm-selector" class="selector-display">未指定</span><button class="locator-btn unmapped" data-type="passwordConfirm" title="定位"></button><button class="reset-btn" data-type="passwordConfirm">⟲</button></div>
                        <div class="custom-mapping-row"><label>服务条款</label><span id="map-termsCheckbox-selector" class="selector-display">未指定</span><button class="locator-btn unmapped" data-type="termsCheckbox" title="定位"></button><button class="reset-btn" data-type="termsCheckbox">⟲</button></div>
                        <div class="custom-mapping-row"><label>注册按钮</label><span id="map-submitBtn-selector" class="selector-display">未指定</span><button class="locator-btn unmapped" data-type="submitBtn" title="定位"></button><button class="reset-btn" data-type="submitBtn">⟲</button></div>
                        <div id="custom-fields-container"></div>
                        <button id="add-custom-field-btn" class="helper-full-width-btn">+ 添加新字段</button>
                        <div class="button-group" style="margin-top: 0.5rem;"><button id="save-profile-btn">保存</button><button id="import-profile-btn" style="background-color: #17a2b8;">导入</button></div>
                        <button id="export-profile-btn" class="helper-full-width-btn" style="background-color: #6c757d; margin-top: 0.5rem;">导出配置</button>
                        <button id="return-main-btn" class="helper-full-width-btn" style="background-color: #ccc; color: black; margin-top: 0.5rem;">返回</button>
                    </div>
                </div>
                <div id="helper-settings-view" class="tf-helper-ignore">
                    <div style="padding: 1rem; display: flex; flex-direction: column; gap: 0.8rem;">
                        <h4>Google邮件读取设置</h4>
                        <p style="font-size: 0.8rem; color: #666; margin: 0;">请将您创建的Google Apps Script Web应用URL粘贴到下方。</p>
                        <input type="password" id="apps-script-url-input" placeholder="粘贴您的 https://script.google.com/... 链接">
                        <button id="show-tutorial-btn" class="helper-full-width-btn" style="background-color: var(--helper-primary-color); margin-top: 0.5rem;">查看设置教程</button>
                        <button id="force-auth-btn" class="helper-full-width-btn" style="background-color: #fd7e14;">强制授权 (解决网络错误)</button>
                        <button id="save-settings-btn" class="helper-full-width-btn" style="background-color: var(--helper-success-color);">保存设置</button>
                        <button id="return-main-from-settings-btn" class="helper-full-width-btn" style="background-color: #ccc; color: black;">返回</button>
                    </div>
                </div>
                <div id="helper-mailbox-view" class="tf-helper-ignore">
                    <div style="padding: 1rem; display: flex; flex-direction: column; gap: 0.8rem;">
                        <h4>手动收信 (最近10分钟)</h4>
                        <ul id="mailbox-list"><li>请点击刷新按钮获取邮件...</li></ul>
                        <button id="refresh-mailbox-btn" class="helper-full-width-btn" style="background-color: var(--helper-primary-color);">刷新</button>
                        <button id="return-main-from-mailbox-btn" class="helper-full-width-btn" style="background-color: #ccc; color: black;">返回</button>
                    </div>
                </div>
            </div>
        `,
        getProgressModalHTML: () => `
            <div id="progress-modal-container" class="tf-helper-ignore">
                <div id="progress-modal-header" class="tf-helper-ignore"><h3 id="progress-modal-title" class="tf-helper-ignore">任务执行中...</h3><button id="progress-modal-close-btn" class="tf-helper-ignore">&times;</button></div>
                <div id="progress-modal-body" class="tf-helper-ignore">
                    <div class="progress-status tf-helper-ignore"><div class="progress-bar-container tf-helper-ignore"><div id="progress-bar-fill" class="progress-bar-fill tf-helper-ignore"></div></div><span id="progress-percentage" class="progress-percentage tf-helper-ignore">0%</span></div>
                    <div id="progress-time" class="progress-time tf-helper-ignore">已用时: 0.00s</div><h4 class="tf-helper-ignore">详细日志:</h4>
                    <div id="progress-log-container" class="tf-helper-ignore"><ul id="progress-log-list" class="tf-helper-ignore"></ul></div>
                </div>
                <div id="progress-modal-footer" class="tf-helper-ignore"><button id="copy-log-btn" class="tf-helper-ignore">复制日志</button></div>
            </div>
        `,
        getCustomFieldModalHTML: () => `
            <div id="custom-field-modal-container" class="tf-helper-ignore">
                <h3>添加自定义字段</h3>
                <input type="text" id="custom-field-name" placeholder="字段名称 (例如: 邀请码)">
                <select id="custom-field-action">
                    <option value="inputText">输入文本</option>
                    <option value="click">点击元素</option>
                </select>
                <input type="text" id="custom-field-value" placeholder="要输入的值 (仅“输入文本”时需要)">
                <div class="button-group">
                    <button id="save-custom-field-btn">保存</button>
                    <button id="cancel-custom-field-btn" style="background-color: #6c757d;">取消</button>
                </div>
            </div>
        `,
        getTutorialModalHTML() {
            const APPS_SCRIPT_CODE = `
function doGet(e) {
  try {
    const action = e.parameter.action;
    let data;

    if (action === 'fetchEmails') {
      const query = e.parameter.query || 'in:inbox newer_than:1d';
      data = fetchEmails(query);
    } else if (action === 'getEmailContent') {
      const messageId = e.parameter.messageId;
      if (!messageId) {
        throw new Error("缺少 messageId 参数");
      }
      data = getEmailContent(messageId);
    } else {
      throw new Error("无效的 action");
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      data: data
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function fetchEmails(query) {
  const threads = GmailApp.search(query, 0, 10);
  const emails = [];

  threads.forEach(thread => {
    const messages = thread.getMessages();
    const latestMessage = messages[messages.length - 1];

    if (latestMessage) {
      emails.push({
        id: latestMessage.getId(),
        subject: latestMessage.getSubject(),
        from: latestMessage.getFrom(),
        date: latestMessage.getDate().toISOString()
      });
    }
  });

  emails.sort((a, b) => new Date(b.date) - new Date(a.date));
  return emails;
}

function getEmailContent(messageId) {
  const message = GmailApp.getMessageById(messageId);
  if (!message) {
    throw new Error("找不到指定ID的邮件");
  }
  return message.getPlainBody();
}
`.trim();
            const TUTORIAL_CONTENT_HTML = `
                <div class="tutorial-content">
                    <h4>前言：为什么要进行这项设置？</h4>
                    <p><strong>原理说明：</strong>很多网站注册时需要邮箱验证码。为了实现自动化，脚本需要一种方法来读取您邮箱里的新邮件。直接让脚本登录您的邮箱既不安全也不现实。因此，我们采用Google官方提供的 <strong>Apps Script</strong> 服务，创建一个安全的“小程序”。</p>
                    <p>这个小程序就像是您授权的一个私人秘书，它运行在Google的服务器上，可以按照我们的指令（我们提供的代码）安全地读取您的Gmail邮件。脚本通过一个专属的URL链接与这个“秘书”通信，从而获取验证码，全程无需暴露您的账号密码，安全可靠。</p>

                    <h4>第一步：创建 Google Apps Script 项目</h4>
                    <p>1. 首先，请确保您已登录需要用来接收验证码的Google账户。</p>
                    <p>2. 打开 <a href="https://script.google.com/home/my" target="_blank">Google Apps Script 官网</a>。</p>
                    <p>3. 点击页面左上角的 <strong>+ 新建项目</strong> 按钮，进入代码编辑器界面。</p>

                    <h4>第二步：粘贴并保存代码</h4>
                    <p>1. 进入编辑器后，您会看到一些默认代码，类似 <code>function myFunction() { ... }</code>。请将这些代码 <strong>全部删除</strong>，确保编辑器是空白的。</p>
                    <p>2. 点击下方的“一键复制代码”按钮，然后将代码粘贴到空白的编辑器中。</p>
                    <div class="code-block">
                        <button id="copy-apps-script-code-btn">一键复制代码</button>
                        <pre><code>${APPS_SCRIPT_CODE.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>
                    </div>
                    <p><strong>原理说明：</strong>这段代码定义了两个功能：一个是<code>fetchEmails</code>（获取邮件列表），另一个是<code>getEmailContent</code>（读取单封邮件内容）。它只会在收到脚本的请求时执行这些操作。</p>
                    <p>3. 点击顶部工具栏的 <strong>💾 保存项目</strong> 图标，给您的项目起一个容易识别的名字，例如“我的收信助手”。</p>

                    <h4>第三步：部署为 Web 应用 (最关键的一步)</h4>
                    <p>1. 点击编辑器右上角的蓝色 <strong>部署</strong> 按钮，在下拉菜单中选择 <strong>新建部署</strong>。</p>
                    <p>2. 在弹出的窗口中，点击“选择类型”旁边的齿轮图标 ⚙️，然后选择 <strong>Web 应用</strong>。</p>
                    <p>3. 接下来，进行部署配置，请严格按照以下说明操作：</p>
                    <ul>
                        <li><strong>说明:</strong> 可以随便填写，例如“首次部署”。</li>
                        <li><strong>执行者:</strong> 选择 <code>我 (您的邮箱地址)</code>。<strong>(原理：这代表脚本将以您的身份去执行，从而能访问您的Gmail。)</strong></li>
                        <li><strong>谁可以访问:</strong> 选择 <code>任何拥有 Google 帐号的用户</code>。<strong>(原理：这设定了谁能通过URL触发这个程序。这个选项兼顾了安全和便利。)</strong></li>
                    </ul>
                    <p>4. 点击 <strong>部署</strong> 按钮。</p>
                    <div class="important-note">
                        <strong>⚠️ 注意：首次部署会弹出授权请求窗口！</strong>
                        <p>这是正常且必须的步骤。Google需要确认您是否允许这个您自己创建的程序访问您的Gmail数据。</p>
                        <p>1. 在弹出的窗口中，点击 <strong>授权访问</strong>。</p>
                        <p>2. 选择您的Google账户。</p>
                        <p>3. Google可能会显示一个“Google 未验证此应用”的警告。这是因为这个应用是您个人创建的，并非来自应用商店。请不要担心，点击左下角的 <strong>“高级”</strong>，然后点击页面最下方的 <strong>“转至 [您的项目名称] (不安全)”</strong>。</p>
                        <p>4. 在最后的确认页面，点击 <strong>允许</strong>，授予权限。</p>
                    </div>

                    <h4>第四步：复制URL并配置到脚本中</h4>
                    <p>1. 授权成功并完成部署后，您会看到一个“部署已更新”的窗口，里面有一个 <strong>Web 应用网址</strong>。这就是我们最终需要的URL！请点击它旁边的 <strong>复制</strong> 按钮。</p>
                    <p>2. 回到本脚本的“邮件设置”界面，将刚刚复制的URL完整地粘贴到输入框中。</p>
                    <p>3. 点击 <strong>保存设置</strong>。</p>
                    <p><strong>🎉 恭喜您，所有配置已完成！</strong> 现在脚本已经拥有了读取您邮箱验证码的能力。</p>
                </div>
            `;
            return `
                <div id="tutorial-modal-container" class="tf-helper-ignore">
                    <div id="tutorial-modal-header" class="tf-helper-ignore">
                        <h3 class="tf-helper-ignore">邮件读取设置教程 (小白专版)</h3>
                        <button id="tutorial-modal-close-btn" class="tf-helper-ignore">&times;</button>
                    </div>
                    <div id="tutorial-modal-body" class="tf-helper-ignore">
                        ${TUTORIAL_CONTENT_HTML}
                    </div>
                </div>
            `;
        },
        injectCSS() {
            GM_addStyle(`
                :root {
                    --helper-width: 22rem; --helper-ball-size: 3rem; --helper-primary-color: #007bff;
                    --helper-success-color: #28a745; --helper-danger-color: #dc3545; --helper-warning-color: #ffc107;
                }
                #helper-container {
                    position: fixed !important; top: 10rem; right: 1.5rem; width: var(--helper-width) !important; height: auto !important;
                    background-color: #ffffff !important; border: 1px solid #e0e0e0 !important; border-radius: 0.5rem !important;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.15) !important; z-index: 2147483647 !important;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
                    color: #333 !important; overflow: hidden !important; transition: all 0.3s ease-in-out !important;
                    cursor: move;
                }
                #helper-container.dragging { transition: none !important; }
                #helper-container.minimized { width: var(--helper-ball-size) !important; height: var(--helper-ball-size) !important; border-radius: 50% !important; padding: 0 !important; }
                #helper-container.minimized .helper-content { display: none !important; }
                #helper-ball-icon { display: none; font-size: 1.5rem; color: white; width: 100%; height: 100%; background-color: var(--helper-primary-color); justify-content: center; align-items: center; }
                #helper-container.minimized #helper-ball-icon { display: flex !important; }
                .helper-content { display: flex; flex-direction: column; cursor: default; }
                #helper-header { padding: 0.6rem 1rem; background-color: var(--helper-primary-color); color: white; display: flex; justify-content: space-between; align-items: center; font-size: 1rem; }
                #minimize-btn { cursor: pointer; font-size: 1.5rem; font-weight: bold; line-height: 1; user-select: none; }
                #helper-body { padding: 1rem; display: flex; flex-direction: column; gap: 0.8rem; }
                #helper-body input[type="text"], #helper-body input[type="password"] { width: calc(100% - 1.2rem); padding: 0.5rem 0.6rem; border: 1px solid #ccc; border-radius: 0.25rem; font-size: 0.9rem; }
                #helper-body button, .helper-full-width-btn { padding: 0.6rem; border: none; border-radius: 0.25rem; cursor: pointer; font-weight: bold; transition: background-color 0.2s, color 0.2s; color: white; width: 100%; }
                .button-group { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
                #lock-btn { background-color: var(--helper-primary-color); }
                #random-btn { background-color: var(--helper-danger-color); }
                #unlock-message { font-weight: bold; color: black; font-size: 0.75rem; text-align: center; }
                .switch-container { display: flex; align-items: center; justify-content: space-between; font-size: 0.9rem; }
                .switch { position: relative; display: inline-block; width: 3rem; height: 1.5rem; }
                .switch input { opacity: 0; width: 0; height: 0; }
                .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; border-radius: 1.5rem; }
                .slider:before { position: absolute; content: ""; height: 1.1rem; width: 1.1rem; left: 0.2rem; bottom: 0.2rem; background-color: white; transition: .4s; border-radius: 50%; }
                input:checked + .slider { background-color: var(--helper-primary-color); }
                input:checked + .slider:before { transform: translateX(1.5rem); }
                #helper-log-container { border-top: 1px solid #eee; padding: 0.5rem 1rem; margin-top: 0.5rem; }
                #helper-log-container h4 { margin: 0 0 0.5rem 0; font-size: 0.9rem; color: #555; }
                #helper-log-list { list-style: none; padding: 0; margin: 0; max-height: 100px; overflow-y: auto; font-size: 0.85rem; }
                #helper-log-list li { margin-bottom: 0.3rem; word-wrap: break-word; }
                #helper-log-list li.error { color: var(--helper-danger-color); font-weight: bold; }
                #progress-modal-overlay, #custom-field-modal-overlay, #tutorial-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.5); z-index: 2147483646; display: none; justify-content: center; align-items: center; }
                #progress-modal-container, #tutorial-modal-container { width: 45rem; max-width: 90vw; background-color: #fff; border-radius: 0.5rem; box-shadow: 0 5px 20px rgba(0,0,0,0.25); display: flex; flex-direction: column; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
                #progress-modal-header, #tutorial-modal-header { padding: 0.8rem 1.2rem; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
                #progress-modal-header h3, #tutorial-modal-header h3 { margin: 0; font-size: 1.1rem; }
                #progress-modal-close-btn, #tutorial-modal-close-btn { font-size: 1.5rem; cursor: pointer; color: #888; border: none; background: none; padding: 0; line-height: 1; }
                #progress-modal-body, #tutorial-modal-body { padding: 1.2rem; max-height: 80vh; overflow-y: auto; }
                .progress-status { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
                .progress-bar-container { flex-grow: 1; height: 1.2rem; background-color: #e9ecef; border-radius: 0.25rem; overflow: hidden; }
                #progress-bar-fill { width: 0%; height: 100%; background-color: var(--helper-primary-color); transition: width 0.3s ease; }
                .progress-percentage { font-weight: bold; font-size: 1rem; }
                #progress-time { font-size: 0.85rem; color: #6c757d; text-align: center; margin-bottom: 1rem; }
                #progress-log-container { background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 0.25rem; padding: 0.8rem; max-height: 250px; overflow-y: auto; }
                #progress-log-list { list-style: none; padding: 0; margin: 0; font-family: "Courier New", monospace; font-size: 0.8rem; }
                #progress-log-list li { padding: 0.2rem 0; border-bottom: 1px solid #eee; white-space: pre-wrap; word-break: break-all; }
                #progress-log-list li:last-child { border-bottom: none; }
                #progress-log-list .log-scan { color: #007bff; } #progress-log-list .log-analyze { color: #fd7e14; } #progress-log-list .log-match { color: #28a745; font-weight: bold; }
                #progress-log-list .log-action { color: #6f42c1; } #progress-log-list .log-error { color: #dc3545; font-weight: bold; } #progress-log-list .log-pause { color: #ffc107; font-weight: bold; }
                #progress-log-list .log-warning { color: #fd7e14; font-weight: bold; }
                #progress-log-list .log-monitor { color: #17a2b8; font-style: italic; }
                #progress-log-list .log-mail { color: #e83e8c; font-weight: bold; }
                #progress-modal-footer { padding: 0.8rem 1.2rem; border-top: 1px solid #eee; text-align: right; }
                #copy-log-btn { padding: 0.5rem 1rem; background-color: var(--helper-primary-color); color: white; border: none; border-radius: 0.25rem; cursor: pointer; }
                #helper-main-view, #helper-custom-view, #helper-settings-view, #helper-mailbox-view { display: flex; flex-direction: column; }
                #helper-custom-view, #helper-settings-view, #helper-mailbox-view { display: none; }
                .custom-mapping-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
                .custom-mapping-row label { flex-basis: 7rem; font-size: 0.9rem; flex-shrink: 0; text-align: right; padding-right: 0.5rem; }
                .custom-mapping-row .selector-display { flex-grow: 1; background-color: #eee; padding: 0.3rem 0.5rem; border-radius: 0.25rem; font-family: monospace; font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .highlight-for-selection { outline: 3px solid #ff4500 !important; box-shadow: 0 0 15px #ff4500 !important; background-color: rgba(255, 69, 0, 0.2) !important; cursor: crosshair !important; }
                #selector-mode-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(0, 0, 0, 0.6); z-index: 2147483645; display: none; cursor: crosshair !important; pointer-events: none; }
                body.in-selector-mode * { cursor: crosshair !important; }
                .locator-btn { width: 1.2rem; height: 1.2rem; border-radius: 50%; border: 2px solid; cursor: pointer; transition: all 0.2s; flex-shrink: 0; padding: 0; }
                .locator-btn.unmapped { background-color: var(--helper-success-color); border-color: #208a38; }
                .locator-btn.mapped { background-color: var(--helper-danger-color); border-color: #b82c3a; }
                .reset-btn, .remove-btn { background: none; border: none; color: var(--helper-primary-color); cursor: pointer; font-size: 1.2rem; padding: 0 0.3rem; flex-shrink: 0; line-height: 1; }
                #add-custom-field-btn { background-color: var(--helper-success-color); margin-top: 0.5rem; }
                #custom-field-modal-container { background: #fff; padding: 1.5rem; border-radius: 0.5rem; width: 25rem; display: flex; flex-direction: column; gap: 1rem; }
                #custom-field-modal-container h3 { margin: 0 0 0.5rem 0; }
                #custom-field-modal-container input, #custom-field-modal-container select { width: calc(100% - 1.2rem); padding: 0.5rem 0.6rem; border: 1px solid #ccc; border-radius: 0.25rem; }
                #mailbox-list { list-style: none; padding: 0; margin: 0; max-height: 300px; overflow-y: auto; border: 1px solid #eee; border-radius: 0.25rem; }
                #mailbox-list li { padding: 0.6rem; border-bottom: 1px solid #eee; font-size: 0.8rem; display: flex; flex-direction: column; gap: 0.2rem; transition: background-color 0.3s; }
                #mailbox-list li:last-child { border-bottom: none; }
                #mailbox-list li.new-email { background-color: #e8f5e9; border-left: 4px solid var(--helper-success-color); }
                #mailbox-list li.seen-email { background-color: #f5f5f5; }
                #mailbox-list li.seen-email .mail-sender, #mailbox-list li.seen-email .mail-subject, #mailbox-list li.seen-email .mail-date { color: #888; }
                #mailbox-list .mail-sender { font-weight: bold; }
                #mailbox-list .mail-subject { color: #555; }
                #mailbox-list .mail-date { font-size: 0.7rem; color: #888; }
                #mailbox-list .use-email-btn { font-size: 0.75rem; padding: 0.3rem 0.6rem; width: auto; background-color: var(--helper-success-color); margin-top: 0.4rem; align-self: flex-start; }
                .tutorial-content { line-height: 1.6; font-size: 0.9rem; }
                .tutorial-content h4 { font-size: 1.1rem; color: var(--helper-primary-color); border-bottom: 2px solid var(--helper-primary-color); padding-bottom: 0.3rem; margin-top: 1.2rem; }
                .tutorial-content p, .tutorial-content ul { margin: 0.5rem 0; }
                .tutorial-content ul { padding-left: 1.5rem; }
                .tutorial-content li { margin-bottom: 0.5rem; }
                .tutorial-content code { background-color: #e9ecef; padding: 0.1rem 0.4rem; border-radius: 0.2rem; font-family: "Courier New", monospace; }
                .tutorial-content .code-block { background-color: #282c34; color: #abb2bf; padding: 1rem; border-radius: 0.3rem; margin: 1rem 0; position: relative; }
                .tutorial-content .code-block pre { margin: 0; white-space: pre-wrap; word-break: break-all; }
                .tutorial-content .important-note { background-color: #fff3cd; border-left: 4px solid #ffeeba; padding: 0.8rem; margin: 1rem 0; }
                #copy-apps-script-code-btn { position: absolute; top: 0.5rem; right: 0.5rem; background-color: #61afef; color: white; border: none; padding: 0.3rem 0.6rem; border-radius: 0.2rem; cursor: pointer; }
                #helper-toast-notification {
                    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
                    background-color: rgba(0, 0, 0, 0.75); color: white; padding: 1rem 1.5rem;
                    border-radius: 0.5rem; z-index: 2147483647; font-size: 1rem;
                    display: none; opacity: 0; transition: opacity 0.3s ease-in-out;
                    display: flex; align-items: center; gap: 1rem;
                }
                #helper-toast-notification.show { display: flex; opacity: 1; }
                #helper-toast-close-btn { background: none; border: none; color: white; font-size: 1.5rem; cursor: pointer; padding: 0; line-height: 1;}
            `);
        }
    };

    // --- 模块 4: 核心自动化引擎 (Automation Engine) ---
    // 包含所有与页面交互、元素识别和模拟操作的逻辑
    const Engine = {
        keywords: {
            email: ['email', 'e-mail', 'mail', '邮箱', '帐号', '账户', '账号', '電子郵件'],
            username: ['user', 'name', 'nick', '昵称', '用户名', '网站名称', '使用者名稱'],
            password: ['password', 'passwd', 'pass', '密码', '密碼'],
            passwordConfirm: ['confirm', 'again', 'repeat', '确认', '重複', '再次', 're-enter', 'repasswd', '确认密码', '確認密碼'],
            verificationCode: ['verification', 'captcha', 'code', '验证码', '驗證碼', '校驗碼']
        },

        /**
         * 获取与元素关联的文本，用于智能识别
         * @param {HTMLElement} element - 目标元素
         * @returns {string} - 关联的文本 (小写)
         */
        getAssociatedText(element) {
            let text = (element.placeholder || element.name || element.id || element.ariaLabel || '').toLowerCase();
            let label = element.closest('label') || (element.id && document.querySelector(`label[for="${element.id}"]`));
            if (label) {
                text += ' ' + (label.textContent || '').toLowerCase();
            } else {
                const parent = element.closest('div, p, li');
                if (parent) text += ' ' + (parent.innerText || '').split('\n')[0].toLowerCase();
            }
            return text.trim().replace(/\s+/g, ' ');
        },

        /**
         * 判断元素是否属于特定类型
         * @param {HTMLElement} element - 目标元素
         * @param {string} type - 'email', 'username', 'password' 等
         * @returns {boolean}
         */
        isOfType(element, type) {
            const text = this.getAssociatedText(element);
            if (type === 'username') {
                return this.keywords.username.some(k => text.includes(k)) && !this.keywords.email.some(k => text.includes(k));
            }
            return this.keywords[type].some(k => text.includes(k));
        },

        /**
         * 模拟人类打字输入
         * @param {HTMLInputElement} element - 目标输入框
         * @param {string} value - 要输入的值
         * @returns {Promise<boolean>} - 操作是否成功
         */
        async simulateHumanTyping(element, value) {
            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || element.disabled || element.readOnly) {
                UI.updateProgress(null, `[警告] 元素 ${element.tagName} 不可交互，已跳过`, 'log-error');
                return false;
            }
            try {
                element.focus();
                await new Promise(res => setTimeout(res, 50));
                element.click();
                await new Promise(res => setTimeout(res, 50));
                element.value = '';
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
                await new Promise(res => setTimeout(res, 50));
                for (const char of value) {
                    element.value += char;
                    element.dispatchEvent(new Event('input', { bubbles: true }));
                    await new Promise(res => setTimeout(res, Math.random() * 60 + 30));
                }
                element.dispatchEvent(new Event('change', { bubbles: true }));
                await new Promise(res => setTimeout(res, 50));
                element.blur();
                return true;
            } catch (e) {
                UI.updateProgress(null, `[错误] 模拟输入 ${element.tagName} 时失败: ${e.message}`, 'log-error');
                return false;
            }
        },

        /**
         * 智能填充表单
         * @param {boolean} [forceOverwrite=false] - 是否覆盖已有值的输入框
         * @param {string} email - 邮箱
         * @param {string} password - 密码
         */
        async fillForms(forceOverwrite = false, email = State.config.email, password = State.config.password) {
            UI.updateProgress(35, "扫描页面上的所有输入框...", "log-scan");
            const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not(.tf-helper-ignore)'));
            for (const input of inputs) {
                if (!forceOverwrite && input.value) continue;
                if (this.isOfType(input, 'email')) await this.simulateHumanTyping(input, email);
                else if (this.isOfType(input, 'username')) await this.simulateHumanTyping(input, email.split('@')[0]);
                else if (this.isOfType(input, 'passwordConfirm')) await this.simulateHumanTyping(input, password);
                else if (this.isOfType(input, 'password')) await this.simulateHumanTyping(input, password);
            }
            UI.updateProgress(65, `✅ 智能填充完成。`, 'log-match');
        },

        /**
         * 查找并点击匹配关键词的按钮
         * @param {string[]} keywords - 关键词数组
         * @returns {Promise<boolean>} - 是否找到并点击
         */
        async findAndClickButton(keywords) {
            const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a[role="button"]'));
            const target = buttons.find(b => keywords.some(k => ((b.textContent || b.value) || '').toLowerCase().includes(k.toLowerCase())));
            if (target) {
                UI.updateProgress(95, `✅ 智能决策: 点击按钮 "${(target.textContent || target.value || '').trim()}"`, 'log-match');
                target.click();
                monitorForPostClickFeedback(target);
                return true;
            }
            return false;
        },
    };

    // --- 模块 5: 邮件助手 (Mail Helper) ---
    // 负责与 Google Apps Script 通信，获取邮件和验证码
    const MailHelper = {
        /**
         * 封装的 GM_xmlhttpRequest 请求
         * @param {string} action - 'fetchEmails' 或 'getEmailContent'
         * @param {object} [params={}] - URL 参数
         * @returns {Promise<any>}
         */
        async _request(action, params = {}) {
            if (!State.config.appsScriptUrl) {
                throw new Error("请先在“邮件设置”中配置您的 Google Apps Script URL。");
            }
            const url = new URL(State.config.appsScriptUrl);
            url.searchParams.append('action', action);
            for (const key in params) {
                url.searchParams.append(key, params[key]);
            }
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: url.href,
                    onload: function(response) {
                        try {
                            if (response.status === 200) {
                                const result = JSON.parse(response.responseText);
                                if (result.success) {
                                    resolve(result.data);
                                } else {
                                    reject(new Error(`Apps Script 报告错误: ${result.error || "未知错误"}.`));
                                }
                            } else {
                                reject(new Error(`请求失败，状态码: ${response.status}.`));
                            }
                        } catch (e) {
                            reject(new Error(`解析响应失败: ${e.message}.`));
                        }
                    },
                    onerror: function(response) {
                        console.error("GM_xmlhttpRequest 错误详情:", response);
                        reject(new Error(`网络错误: ${response.statusText || '无法连接'}. 请确保 @connect 权限包含了 'accounts.google.com'。`));
                    }
                });
            });
        },

        /**
         * 获取邮件列表
         * @param {string} query - Gmail 搜索查询字符串
         * @returns {Promise<Array>}
         */
        async fetchEmails(query) {
            try {
                return await this._request('fetchEmails', { query });
            } catch (err) {
                Logger.add(`❌ 获取邮件列表失败: ${err.message}`, 'error');
                return [];
            }
        },

        /**
         * 获取指定邮件的内容
         * @param {string} messageId - 邮件ID
         * @returns {Promise<string|null>}
         */
        async getEmailContent(messageId) {
            try {
                return await this._request('getEmailContent', { messageId });
            } catch (err) {
                Logger.add(`❌ 获取邮件内容失败: ${err.message}`, 'error');
                return null;
            }
        },

        /**
         * 从文本中提取验证码
         * @param {string} text - 邮件正文
         * @returns {string|null}
         */
        extractVerificationCode(text) {
            if (!text) return null;
            const patterns = [
                /(?:验证码|verification code|código de verificación|code de vérification|verifizierungscode|код подтверждения|認証コード|인증 코드)\s*[:：\s]*\s*([a-zA-Z0-9]{4,8})/i,
                /your code is\s*[:\s]*\s*([a-zA-Z0-9]{4,8})/i,
                /(?:\D|^)(\d{4,8})(?:\D|$)/,
            ];
            for (const pattern of patterns) {
                const match = text.match(pattern);
                if (match && match[1]) return match[1];
            }
            return null;
        }
    };

    // --- 模块 6: 事件监听器 (Event Listeners) ---
    // 统一管理所有的事件绑定
    function bindUIEvents() {
        const { elements } = UI;
        elements.lockBtn.addEventListener('click', () => {
            State.config.isLocked = !State.config.isLocked;
            GM_setValue('isLocked', State.config.isLocked);
            UI.updateLockUI();
        });

        elements.randomBtn.addEventListener('click', () => {
            State.config.email = 'user' + Date.now().toString().slice(-6) + '@gmail.com';
            State.config.password = 'pass' + Math.random().toString(36).substring(2, 10);
            GM_setValue('savedEmail', State.config.email);
            GM_setValue('savedPassword', State.config.password);
            elements.emailInput.value = State.config.email;
            elements.passwordInput.value = State.config.password;
            Logger.add('✅ 已生成新的随机凭据。', 'success');
        });

        elements.startStopBtn.addEventListener('click', () => {
            if (!State.config.isLocked) {
                State.config.email = elements.emailInput.value;
                State.config.password = elements.passwordInput.value;
            }
            State.runtime.isScriptRunning = !State.runtime.isScriptRunning;
            UI.updateStartStopButtonUI();
            if (State.runtime.isScriptRunning) runPageLogic();
        });

        elements.autofillToggle.addEventListener('change', () => {
            State.config.autoFillEnabled = elements.autofillToggle.checked;
            GM_setValue('autoFillEnabled', State.config.autoFillEnabled);
        });

        elements.autoregisterToggle.addEventListener('change', () => {
            State.config.autoRegisterEnabled = elements.autoregisterToggle.checked;
            GM_setValue('autoRegisterEnabled', State.config.autoRegisterEnabled);
        });

        elements.showDetailedToggle.addEventListener('change', () => {
            State.config.showDetailedProcess = elements.showDetailedToggle.checked;
            GM_setValue('showDetailedProcess', State.config.showDetailedProcess);
        });

        elements.minimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.helperContainer.classList.add('minimized');
            GM_setValue('isMinimized', true);
        });

        elements.helperContainer.addEventListener('click', () => {
            if (elements.helperContainer.classList.contains('minimized')) {
                elements.helperContainer.classList.remove('minimized');
                GM_setValue('isMinimized', false);
            }
        });

        elements.progressModalCloseBtn.addEventListener('click', UI.hideProgressModal);

        elements.copyLogBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(State.runtime.progressLogContent).then(() => {
                elements.copyLogBtn.textContent = '已复制!';
                setTimeout(() => { elements.copyLogBtn.textContent = '复制日志'; }, 2000);
            }).catch(err => { alert('复制失败: ' + err); });
        });

        // 拖拽逻辑
        let isDragging = false, offsetX, offsetY;
        elements.helperContainer.addEventListener('mousedown', (e) => {
            const isHeader = e.target.closest('#helper-header');
            const isMinimized = elements.helperContainer.classList.contains('minimized');
            if ((!isHeader && !isMinimized) || e.target.id === 'minimize-btn') return;
            isDragging = true;
            elements.helperContainer.classList.add('dragging');
            offsetX = e.clientX - elements.helperContainer.offsetLeft;
            offsetY = e.clientY - elements.helperContainer.offsetTop;
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            elements.helperContainer.style.left = `${e.clientX - offsetX}px`;
            elements.helperContainer.style.top = `${e.clientY - offsetY}px`;
        });
        document.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            elements.helperContainer.classList.remove('dragging');
        });

        // 视图切换
        elements.gotoCustomBtn.addEventListener('click', () => UI.showView(elements.helperCustomView));
        elements.returnMainBtn.addEventListener('click', () => UI.showView(elements.helperMainView));
        elements.gotoSettingsBtn.addEventListener('click', () => UI.showView(elements.helperSettingsView));
        elements.returnMainFromSettingsBtn.addEventListener('click', () => UI.showView(elements.helperMainView));
        elements.gotoMailboxBtn.addEventListener('click', () => {
            UI.showView(elements.helperMailboxView);
            fetchAndDisplayEmails();
        });
        elements.returnMainFromMailboxBtn.addEventListener('click', () => UI.showView(elements.helperMainView));
        elements.refreshMailboxBtn.addEventListener('click', fetchAndDisplayEmails);

        // 设置视图事件
        elements.saveSettingsBtn.addEventListener('click', () => {
            const url = elements.appsScriptUrlInput.value.trim();
            if (url && url.startsWith("https://script.google.com/")) {
                State.config.appsScriptUrl = url;
                GM_setValue('appsScriptUrl', url);
                Logger.add('✅ 设置已保存！', 'success');
                UI.showView(elements.helperMainView);
            } else {
                Logger.add('❌ 无效的URL，请检查！', 'error');
            }
        });

        elements.forceAuthBtn.addEventListener('click', () => {
            Logger.add('正在尝试强制触发授权...', 'pending');
            GM_xmlhttpRequest({
                method: "GET",
                url: "https://accounts.google.com/",
                onload: () => {
                    Logger.add('✅ 强制连接成功！', 'success');
                    alert("连接成功！如果刚才弹出了授权窗口并已允许，那么问题应该已解决。请再次尝试运行脚本。");
                },
                onerror: () => {
                    Logger.add('❌ 强制连接失败。', 'error');
                    alert("连接失败。这不影响脚本使用，但表明授权可能仍有问题。");
                }
            });
        });

        // 教程模态框事件
        elements.showTutorialBtn.addEventListener('click', () => { elements.tutorialModalOverlay.style.display = 'flex'; });
        elements.tutorialModalCloseBtn.addEventListener('click', () => { elements.tutorialModalOverlay.style.display = 'none'; });
        document.addEventListener('click', (e) => { // 使用 document 监听，因为按钮在模态框内
            if (e.target.id === 'copy-apps-script-code-btn') {
                const code = UI.getTutorialModalHTML.toString().match(/const APPS_SCRIPT_CODE = `([\s\S]*)`.trim();/)[1].trim();
                navigator.clipboard.writeText(code).then(() => {
                    e.target.textContent = '已复制!';
                    setTimeout(() => { e.target.textContent = '一键复制代码'; }, 2000);
                }).catch(err => { alert('复制失败: ' + err); });
            }
        });

        // 自定义视图事件
        elements.helperCustomView.querySelectorAll('.locator-btn').forEach(btn => { btn.addEventListener('click', (e) => startSelectorMode(e.target.dataset.type)); });
        elements.helperCustomView.querySelectorAll('.reset-btn').forEach(btn => { btn.addEventListener('click', (e) => resetCustomMapping(e.target.dataset.type)); });
        elements.saveProfileBtn.addEventListener('click', saveCustomProfile);
        elements.exportProfileBtn.addEventListener('click', exportProfile);
        elements.importProfileBtn.addEventListener('click', importProfile);
        elements.addCustomFieldBtn.addEventListener('click', () => { elements.customFieldModalOverlay.style.display = 'flex'; });
        elements.cancelCustomFieldBtn.addEventListener('click', () => { elements.customFieldModalOverlay.style.display = 'none'; });
        elements.saveCustomFieldBtn.addEventListener('click', addCustomField);
        elements.customFieldAction.addEventListener('change', (e) => { elements.customFieldValue.style.display = e.target.value === 'inputText' ? 'block' : 'none'; });

        // Toast 通知关闭
        elements.helperToastCloseBtn.addEventListener('click', () => {
            if (State.runtime.toastTimer) clearTimeout(State.runtime.toastTimer);
            elements.helperToastNotification.classList.remove('show');
        });
    }

    // --- 模块 7: 辅助函数与业务逻辑 ---
    // 包含所有独立的、可复用的函数，以及主业务流程
    // ... (此处省略了所有辅助函数，如自定义映射、手动收信、智能等待、反馈监控等)
    // ... 为了保持代码的完整性，下面将完整地包含这些函数

    // --- 7.1 自定义映射逻辑 ---
    function startSelectorMode(type, customIndex = -1) {
        if (State.runtime.isSelecting) return;
        State.runtime.isSelecting = true;
        State.runtime.selectingFor = type;
        State.runtime.selectingForCustomIndex = customIndex;
        const targetName = customIndex > -1 ? State.runtime.currentProfile.customFields[customIndex].name : type;
        Logger.add(`请在网页上点击目标 ${targetName} 元素...`, 'success');
        UI.elements.selectorModeOverlay.style.display = 'block';
        document.body.classList.add('in-selector-mode');
        document.addEventListener('mouseover', highlightElement);
        document.addEventListener('click', captureElement, { capture: true, once: true });
    }

    function highlightElement(e) {
        document.querySelectorAll('.highlight-for-selection').forEach(el => el.classList.remove('highlight-for-selection'));
        if (e.target && e.target.tagName && !e.target.classList.contains('tf-helper-ignore')) {
            e.target.classList.add('highlight-for-selection');
        }
    }

    function captureElement(e) {
        e.preventDefault();
        e.stopPropagation();
        const target = e.target;
        target.classList.remove('highlight-for-selection');
        const selector = generateSelector(target);

        if (State.runtime.selectingFor === 'custom') {
            State.runtime.currentProfile.customFields[State.runtime.selectingForCustomIndex].selector = selector;
            updateCustomUIMapping('custom', selector, State.runtime.selectingForCustomIndex);
        } else {
            State.runtime.currentProfile[State.runtime.selectingFor] = selector;
            updateCustomUIMapping(State.runtime.selectingFor, selector);
        }

        Logger.add(`✅ 映射已更新为 ${selector}`, 'success');
        stopSelectorMode();
    }

    function stopSelectorMode() {
        State.runtime.isSelecting = false;
        State.runtime.selectingFor = null;
        State.runtime.selectingForCustomIndex = -1;
        UI.elements.selectorModeOverlay.style.display = 'none';
        document.body.classList.remove('in-selector-mode');
        document.removeEventListener('mouseover', highlightElement);
        document.querySelectorAll('.highlight-for-selection').forEach(el => el.classList.remove('highlight-for-selection'));
    }

    function generateSelector(el) {
        if (el.id) return `#${el.id.trim().replace(/\s/g, '\\ ')}`;
        if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
        if (el.className && typeof el.className === 'string') {
            const classes = el.className.trim().split(/\s+/).filter(c => c && !c.includes(':')).join('.');
            if (classes) return `${el.tagName.toLowerCase()}.${classes}`;
        }
        return el.tagName.toLowerCase();
    }

    function updateCustomUIMapping(type, selector, customIndex = -1) {
        const display = customIndex > -1 ? document.querySelector(`.custom-mapping-row[data-index="${customIndex}"] .selector-display`) : document.getElementById(`map-${type}-selector`);
        const locatorBtn = customIndex > -1 ? document.querySelector(`.locator-btn[data-custom-index="${customIndex}"]`) : document.querySelector(`.locator-btn[data-type="${type}"]`);
        if (display && locatorBtn) {
            if (selector) {
                display.textContent = selector;
                locatorBtn.classList.remove('unmapped');
                locatorBtn.classList.add('mapped');
            } else {
                display.textContent = '未指定';
                locatorBtn.classList.remove('mapped');
                locatorBtn.classList.add('unmapped');
            }
        }
    }

    function resetCustomMapping(type) {
        delete State.runtime.currentProfile[type];
        updateCustomUIMapping(type, null);
        Logger.add(`已重置 ${type} 的映射。`, 'success');
    }

    function addCustomField() {
        const name = UI.elements.customFieldName.value.trim();
        const action = UI.elements.customFieldAction.value;
        const value = UI.elements.customFieldValue.value;
        if (!name) { alert('字段名称不能为空！'); return; }
        if (action === 'inputText' && !value) { alert('“输入文本”操作的值不能为空！'); return; }

        if (!State.runtime.currentProfile.customFields) State.runtime.currentProfile.customFields = [];
        const newField = { name, action, value, selector: '' };
        State.runtime.currentProfile.customFields.push(newField);
        createCustomFieldRow(newField, State.runtime.currentProfile.customFields.length - 1);

        UI.elements.customFieldName.value = '';
        UI.elements.customFieldValue.value = '';
        UI.elements.customFieldModalOverlay.style.display = 'none';
        Logger.add(`✅ 已添加自定义字段: ${name}`, 'success');
    }

    function createCustomFieldRow(field, index) {
        const row = document.createElement('div');
        row.className = 'custom-mapping-row';
        row.dataset.index = index;
        const actionText = field.action === 'inputText' ? '输入' : '点击';
        const html = `
            <label>${field.name} (${actionText})</label>
            <span class="selector-display">${field.selector || '未指定'}</span>
            <button class="locator-btn ${field.selector ? 'mapped' : 'unmapped'}" data-type="custom" data-custom-index="${index}" title="定位"></button>
            <button class="remove-btn" data-index="${index}" title="移除">×</button>
        `;
        State.setHTML(row, html);
        UI.elements.customFieldsContainer.appendChild(row);
        row.querySelector('.locator-btn').addEventListener('click', (e) => startSelectorMode('custom', parseInt(e.target.dataset.customIndex)));
        row.querySelector('.remove-btn').addEventListener('click', (e) => removeCustomField(parseInt(e.target.dataset.index)));
    }

    function removeCustomField(index) {
        State.runtime.currentProfile.customFields.splice(index, 1);
        State.setHTML(UI.elements.customFieldsContainer, '');
        State.runtime.currentProfile.customFields.forEach((field, i) => createCustomFieldRow(field, i));
        Logger.add(`已移除一个自定义字段。`, 'success');
    }

    function saveCustomProfile() {
        const host = window.location.hostname;
        State.runtime.customProfiles[host] = State.runtime.currentProfile;
        GM_setValue('customProfiles', State.runtime.customProfiles);
        Logger.add(`✅ 已为 ${host} 保存规则。`, 'success');
    }

    function loadCustomProfile() {
        const host = window.location.hostname;
        if (State.runtime.customProfiles[host]) {
            State.runtime.currentProfile = JSON.parse(JSON.stringify(State.runtime.customProfiles[host]));
            Object.keys(State.runtime.currentProfile).forEach(type => {
                if (type !== 'customFields') updateCustomUIMapping(type, State.runtime.currentProfile[type]);
            });
            State.setHTML(UI.elements.customFieldsContainer, '');
            if (State.runtime.currentProfile.customFields) {
                State.runtime.currentProfile.customFields.forEach((field, index) => createCustomFieldRow(field, index));
            }
            Logger.add(`已加载 ${host} 的自定义规则。`, 'success');
        } else {
            State.runtime.currentProfile = {};
        }
    }

    function exportProfile() {
        if (Object.keys(State.runtime.currentProfile).length === 0) {
            Logger.add('❌ 当前没有可导出的配置。', 'error');
            return;
        }
        const data = { url: window.location.href, mappings: State.runtime.currentProfile };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `profile-${window.location.hostname}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        Logger.add('✅ 配置已导出。', 'success');
    }

    function importProfile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = readerEvent => {
                try {
                    const data = JSON.parse(readerEvent.target.result);
                    if (data && data.mappings && typeof data.mappings === 'object') {
                        State.runtime.currentProfile = data.mappings;
                        saveCustomProfile();
                        loadCustomProfile();
                        Logger.add('✅ 配置已成功导入并保存！', 'success');
                    } else {
                        throw new Error("无效的配置文件格式。");
                    }
                } catch (err) {
                    Logger.add(`❌ 导入失败: ${err.message}`, 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    // --- 7.2 手动收信逻辑 ---
    async function fetchAndDisplayEmails() {
        State.setHTML(UI.elements.mailboxList, '<li>正在加载邮件...</li>');
        const query = 'newer_than:10m in:anywhere';
        const messages = await MailHelper.fetchEmails(query);
        let seenIds = GM_getValue('seenEmailIds', []);

        State.setHTML(UI.elements.mailboxList, '');
        if (messages.length === 0) {
            State.setHTML(UI.elements.mailboxList, '<li>未找到最近的邮件。</li>');
            return;
        }

        messages.forEach(msg => {
            const li = document.createElement('li');
            const isNew = !seenIds.includes(msg.id);
            li.className = isNew ? 'new-email' : 'seen-email';

            const date = new Date(msg.date).toLocaleString();
            const html = `
                <span class="mail-sender">${msg.from}</span>
                <span class="mail-subject">${msg.subject}</span>
                <span class="mail-date">${date}</span>
                <button class="use-email-btn" data-message-id="${msg.id}">使用此邮件</button>
            `;
            State.setHTML(li, html);
            li.querySelector('.use-email-btn').addEventListener('click', async (e) => {
                const btn = e.target;
                const messageId = btn.dataset.messageId;
                btn.textContent = '处理中...';
                btn.disabled = true;

                if (!seenIds.includes(messageId)) {
                    seenIds.push(messageId);
                    if (seenIds.length > 50) seenIds = seenIds.slice(-50);
                    GM_setValue('seenEmailIds', seenIds);
                    btn.closest('li').className = 'seen-email';
                }

                await processSelectedEmail(messageId);
                btn.textContent = '使用此邮件';
                btn.disabled = false;
            });
            UI.elements.mailboxList.appendChild(li);
        });
    }

    async function processSelectedEmail(messageId) {
        Logger.add('正在从选定邮件中提取验证码...', 'pending');
        const content = await MailHelper.getEmailContent(messageId);
        if (!content) {
            Logger.add('❌ 无法获取邮件内容。', 'error');
            return;
        }
        const code = MailHelper.extractVerificationCode(content);
        if (code) {
            Logger.add(`✅ 成功提取验证码: ${code}`, 'success');
            const verificationElements = findEmailVerificationElements();
            if (verificationElements && verificationElements.codeInput) {
                await Engine.simulateHumanTyping(verificationElements.codeInput, code);
                Logger.add('✅ 验证码已自动填入！', 'success');
            } else {
                Logger.add('⚠️ 未找到输入框，已将验证码复制到剪贴板。', 'error');
                try {
                    await navigator.clipboard.writeText(code);
                    UI.showToastNotification(`验证码 ${code} 已复制，请手动粘贴。`);
                } catch (err) {
                    console.error('复制到剪贴板失败:', err);
                    UI.showToastNotification(`提取到验证码: ${code} (自动复制失败)`);
                }
            }
            if (State.runtime.verificationCodeResolver) {
                State.runtime.verificationCodeResolver(code);
                State.runtime.verificationCodeResolver = null;
            }
        } else {
            Logger.add('❌ 未能在邮件中找到验证码。', 'error');
        }
    }

    // --- 7.3 增强功能模块 (等待引擎 & 反馈监控) ---
    async function intelligentWaitEngine(timeout = 25000) {
        UI.updateProgress(null, `[WAIT] 启动智能等待引擎，检测加载遮罩/CF验证...`, 'log-monitor');
        const overlaySelectors = [
            'div[class*="cloudflare"]', 'iframe[src*="challenges.cloudflare.com"]', 'div#cf-challenge-running',
            'div#turnstile-widget', 'div.cf-turnstile', 'div.cf-chl-widget', 'div[aria-label*="Cloudflare"]',
            'div[class*="loading"]', 'div[class*="spinner"]',
        ];
        const startTime = Date.now();
        let isWaitingForCF = false;

        while (Date.now() - startTime < timeout) {
            const overlay = overlaySelectors.map(s => document.querySelector(s)).find(el => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden' && +style.opacity > 0;
            });

            if (!overlay) {
                UI.updateProgress(null, `[WAIT] ✅ 未检测到活动遮罩，继续执行。`, 'log-match');
                return true;
            }

            const isCF = overlay.matches('div[class*="cloudflare"], iframe[src*="challenges.cloudflare.com"], div.cf-turnstile, div.cf-chl-widget');
            if (isCF && !isWaitingForCF) {
                UI.updateProgress(null, `[WAIT] ⏸️ 检测到Cloudflare人机验证，进入智能等待模式...请手动完成验证。`, 'log-pause');
                isWaitingForCF = true;
            }

            await new Promise(res => setTimeout(res, 1000));
        }
        UI.updateProgress(null, `[WAIT] ⚠️ 等待遮罩超时 (${timeout/1000}s)，将尝试继续...`, 'log-warning');
        return false;
    }

    function monitorForPostClickFeedback(clickedButton) {
        UI.updateProgress(99, `[MONITOR] 启动增强版反馈监控 (15s)...`, 'log-monitor');
        const initialUrl = window.location.href;
        const errorKeywords = ['错误', 'error', '失败', 'taken', '已存在', '格式不正确', '不正确', '频繁', '无效', '不合法', '提示'];
        const successKeywords = ['成功', 'success', 'welcome', '欢迎', '已发送', '验证邮件', 'dashboard', 'user'];
        const modalSelectors = '[role="dialog"], .modal, .dialog, .popup, .toast, .sweet-alert, .el-dialog, .ant-modal';
        let taskResult = 'unknown';

        const stopMonitoring = (finalStatus) => {
            if (State.runtime.postClickObserver) {
                State.runtime.postClickObserver.disconnect();
                State.runtime.postClickObserver = null;
            }
            if (taskResult !== 'unknown') return;

            taskResult = finalStatus;
            if (taskResult === 'success') {
                UI.updateProgress(100, `[MONITOR] ✅ 监测到成功迹象，任务完成！`, 'log-match');
                if (window.location.href.includes('login')) {
                    handleLogin();
                }
            } else if (taskResult === 'timeout') {
                UI.updateProgress(100, `[MONITOR] 未监测到明确反馈，任务结束。`, 'log-match');
            }
        };

        const checkForFeedback = () => {
            if (taskResult !== 'unknown') return;
            if (window.location.href !== initialUrl && successKeywords.some(k => window.location.href.includes(k))) {
                UI.updateProgress(100, `[MONITOR] 监测到成功跳转: ${window.location.href}`, 'log-match');
                stopMonitoring('success');
                return;
            }
            let feedbackText = '';
            document.querySelectorAll(modalSelectors).forEach(modal => {
                const style = window.getComputedStyle(modal);
                if (style.display !== 'none' && style.visibility !== 'hidden') {
                    feedbackText += modal.textContent + ' ';
                }
            });
            const combinedText = feedbackText || document.body.innerText;

            const timerMatch = combinedText.match(/(?:请等待|please wait for)\s*(\d+)\s*(?:秒|s)/i);
            if (timerMatch && timerMatch[1]) {
                const waitSeconds = parseInt(timerMatch[1], 10);
                UI.updateProgress(100, `[MONITOR] ⏸️ 检测到等待计时器...将在 ${waitSeconds} 秒后重试。`, 'log-pause');
                setTimeout(() => {
                    UI.updateProgress(null, `[ACTION] 计时结束，重试点击...`, 'log-action');
                    clickedButton.click();
                    monitorForPostClickFeedback(clickedButton);
                }, (waitSeconds + 1) * 1000);
                stopMonitoring('pause');
                return;
            }

            if (errorKeywords.some(k => combinedText.toLowerCase().includes(k))) {
                UI.updateProgress(100, `[MONITOR] 监测到错误反馈: "${combinedText.substring(0, 100).trim()}"`, 'log-error');
                stopMonitoring('error');
            } else if (successKeywords.some(k => combinedText.toLowerCase().includes(k))) {
                UI.updateProgress(100, `[MONITOR] 监测到成功反馈: "${combinedText.substring(0, 100).trim()}"`, 'log-match');
                stopMonitoring('success');
            }
        };

        if (State.runtime.postClickObserver) State.runtime.postClickObserver.disconnect();
        State.runtime.postClickObserver = new MutationObserver(() => {
            if (taskResult === 'unknown') checkForFeedback();
        });
        State.runtime.postClickObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
        setTimeout(checkForFeedback, 500);
        setTimeout(() => stopMonitoring('timeout'), 15000);
    }

    function findEmailVerificationElements() {
        const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="number"]'));
        const buttons = Array.from(document.querySelectorAll('button, a, span, input[type="button"]'));
        const sendButtonKeywords = ['发送', '获取', 'send', 'get', '获取验证码'];
        const codeInput = inputs.find(el => Engine.isOfType(el, 'verificationCode'));
        const sendButton = buttons.find(el => sendButtonKeywords.some(k => (el.textContent || el.value || "").toLowerCase().includes(k)));
        if (codeInput && sendButton) return { codeInput, sendButton };
        return null;
    }

    async function handleLogin() {
        UI.updateProgress(null, `[ACTION] 检测到登录页面，开始自动登录...`, 'log-action');
        await new Promise(res => setTimeout(res, 1000));
        await Engine.fillForms(true, State.config.email, State.config.password);
        await Engine.findAndClickButton(['登录', 'Login', 'Sign In']);
    }

    // --- 7.4 主逻辑 ---
    async function runPageLogic() {
        Logger.clear();
        State.runtime.taskStartTime = Date.now();
        if (State.config.showDetailedProcess) UI.showProgressModal();

        try {
            UI.updateProgress(10, "启动智能等待引擎...", "log-monitor");
            await intelligentWaitEngine();

            UI.updateProgress(20, "分析页面类型...", "log-analyze");
            const isLikelyRegisterPage = document.querySelectorAll('input[type="password"]').length > 1 || window.location.href.includes('register');

            if (State.config.autoFillEnabled) {
                await Engine.fillForms(true, State.config.email, State.config.password);
            }

            if (State.config.autoRegisterEnabled) {
                const verificationElements = findEmailVerificationElements();
                if (verificationElements) {
                    if (!State.config.appsScriptUrl) {
                        UI.updateProgress(100, "❌ 检测到邮箱验证，但未配置邮件读取链接！请在“邮件设置”中配置。", 'log-error');
                        return;
                    }
                    UI.updateProgress(70, `[MAIL] 发现验证码流程，点击发送按钮...`, 'log-action');
                    verificationElements.sendButton.click();

                    const verificationCodePromise = new Promise((resolve, reject) => {
                        State.runtime.verificationCodeResolver = resolve;
                        setTimeout(() => {
                            if (State.runtime.verificationCodeResolver) {
                                State.runtime.verificationCodeResolver = null;
                                reject(new Error("手动收信超时 (5分钟)"));
                            }
                        }, 300000);
                    });

                    let code = null;
                    try {
                        UI.updateProgress(75, `[MAIL] ⏸️ 任务暂停，等待用户操作... 请点击“手动收信”按钮，找到验证码邮件后点击“使用此邮件”。`, 'log-pause');
                        code = await verificationCodePromise;
                    } catch (e) {
                        UI.updateProgress(100, `[MAIL] ❌ ${e.message}。任务中止。`, 'log-error');
                        return;
                    }

                    if (code) {
                        UI.updateProgress(90, `[ACTION] 验证码已处理。等待5秒，以便您手动粘贴或检查...`, 'log-pause');
                        await new Promise(res => setTimeout(res, 5000));
                        UI。updateProgress(92， `[ACTION] 等待结束，尝试继续流程...`, 'log-action');
                    } else {
                        UI.updateProgress(100, `[MAIL] ❌ 未能获取到验证码，任务中止。`, 'log-error');
                        return;
                    }
                }

                const keywords = isLikelyRegisterPage ? ['注册', 'Register', 'Sign Up'， '创建'] : ['登录', 'Login', 'Sign In'];
                await Engine.findAndClickButton(keywords);
            } else {
                UI。updateProgress(100， "自动注册已关闭，任务结束。"， "log-match");
            }

        } catch (error) {
            UI。updateProgress(100， `❌ 发生意外错误: ${error。message}`， "log-error");
            Logger。add(`❌ 发生意外错误: ${error。message}`， 'error');
        }
    }

    // --- 模块 8: 初始化与启动 (Initialization) ---
    /**
     * 脚本主入口函数
     */
    function main() {
        State.init();
        UI.create();
        bindUIEvents();
        UI.initializeState();
        loadCustomProfile();
    }

    // 使用 MutationObserver 确保在 body 元素加载后再执行脚本
    const bodyObserver = new MutationObserver((mutations, obs) => {
        if (document.body) {
            main();
            obs.disconnect();
        }
    });
    bodyObserver.observe(document.documentElement, { childList: true });

})();```
