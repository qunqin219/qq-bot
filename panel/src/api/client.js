// axios 封装 —— 统一的 API 客户端
// baseURL 为 /api，开发环境下由 vite proxy 转发到后端 8001 端口
import axios from 'axios'

const client = axios.create({
  baseURL: '/api',
  timeout: 15000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

// ── 统一错误处理 ──────────────────────────────
client.interceptors.response.use(
  (response) => response.data,
  (error) => {
    // 未登录（401）：自动跳转到登录页
    if (error.response?.status === 401) {
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    const detail =
      error?.response?.data?.detail ||
      error?.response?.data?.message ||
      error?.message ||
      '请求失败'
    return Promise.reject(new Error(detail))
  }
)

// ── API 方法封装 ──────────────────────────────
export const api = {
  // 认证
  getMe: () => client.get('/me'),
  login: (username, password) => client.post('/login', { username, password }),
  logout: () => client.post('/logout'),

  // 状态
  getStatus: () => client.get('/status'),
  getGroups: () => client.get('/groups'),

  // 配置
  getConfig: () => client.get('/config'),
  updateConfig: (data) => client.put('/config', data),

  // 发送消息
  sendGroup: (group_id, message) =>
    client.post('/send-group', { group_id, message }),
  sendPrivate: (user_id, message) =>
    client.post('/send-private', { user_id, message }),

  // 消息 & 聊天
  getMessages: (params = {}) => client.get('/messages', { params }),
  getChats: () => client.get('/chats'),

  // AI 上下文会话
  getConversations: () => client.get('/conversations'),
  clearConversation: (key) => client.delete(`/conversations/${encodeURIComponent(key)}`),
  clearAllConversations: () => client.delete('/conversations'),
}

export default client
