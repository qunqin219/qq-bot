// axios 封装 —— 统一的 API 客户端
// baseURL 为 /api，开发环境下由 vite proxy 转发到后端 8001 端口
import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import type {
  MeResponse,
  LoginResponse,
  StatusResponse,
  GroupInfo,
  ConfigResponse,
  MessagesResponse,
  ChatsResponse,
  ConversationsResponse,
  MemoriesResponse,
  LogsResponse,
  ApiResult,
  SandboxSendInput,
  SandboxSendResponse,
  SandboxStateResponse,
} from '../shared/types';

const client = axios.create({
  baseURL: '/api',
  timeout: 15000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// ── 统一错误处理 ──────────────────────────────
client.interceptors.response.use(
  (response) => response.data,
  (error) => {
    // 未登录（401）：自动跳转到登录页
    if (error.response?.status === 401) {
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    const detail =
      error?.response?.data?.detail ||
      error?.response?.data?.message ||
      error?.message ||
      '请求失败';
    return Promise.reject(new Error(detail));
  }
);

// ── 类型安全请求辅助 ──────────────────────────
// 响应拦截器返回 response.data，因此所有请求方法直接返回 data
function get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  return client.get(url, config) as unknown as Promise<T>;
}
function post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return client.post(url, data, config) as unknown as Promise<T>;
}
function put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return client.put(url, data, config) as unknown as Promise<T>;
}
function del<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  return client.delete(url, config) as unknown as Promise<T>;
}

// ── API 方法封装 ──────────────────────────────
export const api = {
  // 认证
  getMe: (): Promise<MeResponse> => get('/me'),
  login: (username: string, password: string): Promise<LoginResponse> =>
    post('/login', { username, password }),
  logout: (): Promise<ApiResult> => post('/logout'),

  // 状态
  getStatus: (): Promise<StatusResponse> => get('/status'),
  getGroups: (): Promise<{ groups: GroupInfo[] }> => get('/groups'),

  // 配置
  getConfig: (): Promise<ConfigResponse> => get('/config'),
  updateConfig: (data: Record<string, unknown>): Promise<ConfigResponse> =>
    put('/config', data),

  // 发送消息
  sendGroup: (group_id: number | string, message: string): Promise<ApiResult> =>
    post('/send-group', { group_id, message }),
  sendPrivate: (user_id: number | string, message: string): Promise<ApiResult> =>
    post('/send-private', { user_id, message }),

  // 消息 & 聊天
  getMessages: (params: Record<string, unknown> = {}): Promise<MessagesResponse> =>
    get('/messages', { params }),
  getChats: (): Promise<ChatsResponse> => get('/chats'),

  // 日志
  getLogs: (params: Record<string, unknown> = {}): Promise<LogsResponse> =>
    get('/logs', { params }),

  // QQ 沙盒（不连接 NapCat）
  getSandbox: (): Promise<SandboxStateResponse> => get('/sandbox'),
  sendSandboxMessage: (data: SandboxSendInput): Promise<SandboxSendResponse> =>
    post('/sandbox/messages', data),
  resetSandbox: (): Promise<{ ok: true; state: SandboxStateResponse }> =>
    post('/sandbox/reset'),

  // AI 上下文会话
  getConversations: (): Promise<ConversationsResponse> => get('/conversations'),
  clearConversation: (key: string): Promise<ApiResult> =>
    del(`/conversations/${encodeURIComponent(key)}`),
  clearAllConversations: (): Promise<ApiResult> => del('/conversations'),

  // 个性化记忆
  getMemories: (params: Record<string, unknown> = {}): Promise<MemoriesResponse> =>
    get('/memories', { params }),
  createMemory: (key: string, content: string): Promise<ApiResult> =>
    post('/memories', { key, content }),
  updateMemory: (id: number, key: string, content: string): Promise<ApiResult> =>
    put(`/memories/${id}`, { key, content }),
  deleteMemory: (id: number, key: string): Promise<ApiResult> =>
    del(`/memories/${id}`, { params: { key } }),
  clearMemories: (key?: string): Promise<ApiResult> =>
    del('/memories', { params: key ? { key } : {} }),
};

export default client;
