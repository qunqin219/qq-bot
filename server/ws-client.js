// OneBot 11 WebSocket 客户端 —— 连接 NapCat，收发消息

const WebSocket = require('ws');
const { randomUUID } = require('crypto');

class OneBotWSClient {
  /**
   * 连接 NapCat 的 OneBot 11 WebSocket Server。
   * - 断线 5 秒自动重连
   * - 收到事件后回调 bot-core.handleEvent
   * - 提供 callApi / sendGroupMsg / sendPrivateMsg 等方法
   */
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.connected = false;          // 连接状态标志（供 API 查询）
    this.callbacks = new Map();      // echo -> {resolve, reject}
    this._running = false;
    this._reconnectTimer = null;
  }

  /**
   * 启动连接（断线自动重连）。
   */
  connect() {
    this._running = true;
    this._doConnect();
  }

  /**
   * 内部连接循环（async，自动重连）。
   */
  async _doConnect() {
    while (this._running) {
      try {
        this.ws = new WebSocket(this.wsUrl);

        // 等待连接打开
        await new Promise((resolve, reject) => {
          this.ws.on('open', resolve);
          this.ws.on('error', reject);
        });

        this.connected = true;
        console.log(`[WS] 已连接 NapCat WebSocket: ${this.wsUrl}`);

        // 处理接收到的消息
        this.ws.on('message', (raw) => {
          let data;
          try {
            data = JSON.parse(raw.toString());
          } catch (e) {
            console.warn('[WS] 无法解析 WS 消息:', raw.toString().slice(0, 200));
            return;
          }
          this._handleData(data);
        });

        // 等待连接关闭
        await new Promise((resolve) => {
          this.ws.on('close', resolve);
          this.ws.on('error', resolve);
        });

        this.connected = false;
        this._cleanupCallbacks('disconnected');
        console.log('[WS] 连接断开，5秒后重连...');
      } catch (e) {
        this.connected = false;
        this._cleanupCallbacks('disconnected');
        console.error('[WS] 连接失败:', e.message);
      }
      if (this._running) {
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  /**
   * 清理所有挂起的回调（连接断开时调用）。
   */
  _cleanupCallbacks(msg) {
    for (const [echo, cb] of this.callbacks.entries()) {
      cb.resolve({ status: 'failed', msg });
    }
    this.callbacks.clear();
  }

  /**
   * 处理收到的数据：事件上报 / API 响应。
   */
  async _handleData(data) {
    if (data.post_type) {
      // 事件上报
      const botCore = require('./bot-core');
      try {
        await botCore.handleEvent(data, this);
      } catch (e) {
        console.error('[WS] 处理事件异常:', e);
      }
    } else if (data.echo && this.callbacks.has(data.echo)) {
      // API 响应
      const cb = this.callbacks.get(data.echo);
      this.callbacks.delete(data.echo);
      cb.resolve(data);
    }
  }

  /**
   * 调用 OneBot API，10 秒超时。
   */
  callApi(action, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        resolve({ status: 'failed', msg: 'not connected' });
        return;
      }
      const echo = randomUUID();
      this.callbacks.set(echo, { resolve, reject });
      const msg = JSON.stringify({ action, params, echo });
      try {
        this.ws.send(msg);
      } catch (e) {
        this.callbacks.delete(echo);
        resolve({ status: 'failed', msg: `send error: ${e.message}` });
        return;
      }
      // 10 秒超时
      setTimeout(() => {
        if (this.callbacks.has(echo)) {
          this.callbacks.delete(echo);
          resolve({ status: 'failed', msg: 'timeout' });
        }
      }, 10000);
    });
  }

  // ── 便捷封装 ──────────────────────────────────────────
  sendGroupMsg(groupId, message) {
    return this.callApi('send_group_msg', { group_id: groupId, message });
  }

  sendPrivateMsg(userId, message) {
    return this.callApi('send_private_msg', { user_id: userId, message });
  }

  getLoginInfo() {
    return this.callApi('get_login_info');
  }

  getGroupList() {
    return this.callApi('get_group_list');
  }

  getFriendList() {
    return this.callApi('get_friend_list');
  }

  getGroupMemberList(groupId) {
    return this.callApi('get_group_member_list', { group_id: groupId });
  }

  getGroupMemberInfo(groupId, userId, noCache = false) {
    return this.callApi('get_group_member_info', {
      group_id: groupId,
      user_id: userId,
      no_cache: noCache,
    });
  }

  setGroupBan(groupId, userId, duration) {
    return this.callApi('set_group_ban', {
      group_id: groupId,
      user_id: userId,
      duration,
    });
  }

  setGroupWholeBan(groupId, enable) {
    return this.callApi('set_group_whole_ban', {
      group_id: groupId,
      enable,
    });
  }

  setGroupKick(groupId, userId, rejectAddRequest = false) {
    return this.callApi('set_group_kick', {
      group_id: groupId,
      user_id: userId,
      reject_add_request: rejectAddRequest,
    });
  }

  getMsg(messageId) {
    return this.callApi('get_msg', { message_id: messageId });
  }

  getStrangerInfo(userId) {
    return this.callApi('get_stranger_info', { user_id: userId });
  }

  /**
   * 停止客户端。
   */
  stop() {
    this._running = false;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        // ignore
      }
    }
  }
}

module.exports = { OneBotWSClient };
