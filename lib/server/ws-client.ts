// OneBot 11 WebSocket 客户端 —— 连接 NapCat，收发消息

import type { RawData } from 'ws';

const WebSocket = require('ws');
const { randomUUID } = require('crypto');

type OneBotParams = Record<string, unknown>;

export type OneBotApiResponse = {
  status?: string;
  msg?: string;
  data?: any;
  echo?: string;
  [key: string]: any;
};

type PendingCallback = {
  resolve: (value: OneBotApiResponse) => void;
  reject: (reason?: unknown) => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class OneBotWSClient {
  wsUrl: string;
  ws: InstanceType<typeof WebSocket> | null;
  connected: boolean;
  callbacks: Map<string, PendingCallback>;
  _running: boolean;
  _reconnectTimer: NodeJS.Timeout | null;

  /**
   * 连接 NapCat 的 OneBot 11 WebSocket Server。
   * - 断线 5 秒自动重连
   * - 收到事件后回调 bot-core.handleEvent
   * - 提供 callApi / sendGroupMsg / sendPrivateMsg 等方法
   */
  constructor(wsUrl: string) {
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
  connect(): void {
    this._running = true;
    this._doConnect();
  }

  /**
   * 内部连接循环（async，自动重连）。
   */
  async _doConnect(): Promise<void> {
    while (this._running) {
      try {
        this.ws = new WebSocket(this.wsUrl);

        // 等待连接打开
        await new Promise<void>((resolve, reject) => {
          this.ws?.on('open', resolve);
          this.ws?.on('error', reject);
        });

        this.connected = true;
        console.log(`[WS] 已连接 NapCat WebSocket: ${this.wsUrl}`);

        // 处理接收到的消息
        this.ws.on('message', (raw: RawData) => {
          let data;
          try {
            data = JSON.parse(raw.toString());
          } catch {
            console.warn('[WS] 无法解析 WS 消息:', raw.toString().slice(0, 200));
            return;
          }
          this._handleData(data);
        });

        // 等待连接关闭
        await new Promise<void>((resolve) => {
          this.ws?.on('close', () => resolve());
          this.ws?.on('error', () => resolve());
        });

        this.connected = false;
        this._cleanupCallbacks('disconnected');
        console.log('[WS] 连接断开，5秒后重连...');
      } catch (e: unknown) {
        this.connected = false;
        this._cleanupCallbacks('disconnected');
        console.error('[WS] 连接失败:', errorMessage(e));
      }
      if (this._running) {
        await new Promise<void>((r) => setTimeout(r, 5000));
      }
    }
  }

  /**
   * 清理所有挂起的回调（连接断开时调用）。
   */
  _cleanupCallbacks(msg: string): void {
    for (const cb of this.callbacks.values()) {
      cb.resolve({ status: 'failed', msg });
    }
    this.callbacks.clear();
  }

  /**
   * 处理收到的数据：事件上报 / API 响应。
   */
  async _handleData(data: OneBotApiResponse): Promise<void> {
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
      cb?.resolve(data);
    }
  }

  /**
   * 调用 OneBot API，10 秒超时。
   */
  callApi(action: string, params: OneBotParams = {}): Promise<OneBotApiResponse> {
    return new Promise<OneBotApiResponse>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        resolve({ status: 'failed', msg: 'not connected' });
        return;
      }
      const echo = randomUUID();
      this.callbacks.set(echo, { resolve, reject });
      const msg = JSON.stringify({ action, params, echo });
      try {
        this.ws.send(msg);
      } catch (e: unknown) {
        this.callbacks.delete(echo);
        resolve({ status: 'failed', msg: `send error: ${errorMessage(e)}` });
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
  sendGroupMsg(groupId: number | string, message: string): Promise<OneBotApiResponse> {
    return this.callApi('send_group_msg', { group_id: groupId, message });
  }

  sendPrivateMsg(userId: number | string, message: string): Promise<OneBotApiResponse> {
    return this.callApi('send_private_msg', { user_id: userId, message });
  }

  getLoginInfo(): Promise<OneBotApiResponse> {
    return this.callApi('get_login_info');
  }

  getGroupList(): Promise<OneBotApiResponse> {
    return this.callApi('get_group_list');
  }

  getFriendList(): Promise<OneBotApiResponse> {
    return this.callApi('get_friend_list');
  }

  getGroupMemberList(groupId: number | string): Promise<OneBotApiResponse> {
    return this.callApi('get_group_member_list', { group_id: groupId });
  }

  getGroupMemberInfo(groupId: number | string, userId: number | string, noCache = false): Promise<OneBotApiResponse> {
    return this.callApi('get_group_member_info', {
      group_id: groupId,
      user_id: userId,
      no_cache: noCache,
    });
  }

  setGroupBan(groupId: number | string, userId: number | string, duration: number): Promise<OneBotApiResponse> {
    return this.callApi('set_group_ban', {
      group_id: groupId,
      user_id: userId,
      duration,
    });
  }

  setGroupWholeBan(groupId: number | string, enable: boolean): Promise<OneBotApiResponse> {
    return this.callApi('set_group_whole_ban', {
      group_id: groupId,
      enable,
    });
  }

  setGroupKick(groupId: number | string, userId: number | string, rejectAddRequest = false): Promise<OneBotApiResponse> {
    return this.callApi('set_group_kick', {
      group_id: groupId,
      user_id: userId,
      reject_add_request: rejectAddRequest,
    });
  }

  getMsg(messageId: number | string): Promise<OneBotApiResponse> {
    return this.callApi('get_msg', { message_id: messageId });
  }

  getStrangerInfo(userId: number | string): Promise<OneBotApiResponse> {
    return this.callApi('get_stranger_info', { user_id: userId });
  }

  /**
   * 停止客户端。
   */
  stop(): void {
    this._running = false;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }
  }
}

module.exports = { OneBotWSClient };
