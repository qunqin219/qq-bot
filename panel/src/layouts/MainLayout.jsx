// 主布局：左侧侧边栏导航 + 右侧内容区
import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'

// 导航项配置
const navItems = [
  { to: '/', label: '仪表盘', icon: '📊', end: true },
  { to: '/admins', label: '管理员', icon: '👥' },
  { to: '/groups', label: '群管理', icon: '🏠' },
  { to: '/messages', label: '最近消息', icon: '💬' },
  { to: '/conversations', label: '上下文', icon: '🧠' },
  { to: '/memories', label: '个性记忆', icon: '📌' },
  { to: '/logs', label: '运行日志', icon: '📜' },
  { to: '/send', label: '发送消息', icon: '✉️' },
  { to: '/settings', label: '设置', icon: '⚙️' },
]

export default function MainLayout({ children }) {
  const [loggingOut, setLoggingOut] = useState(false)
  const navigate = useNavigate()

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await api.logout()
    } catch {
      // 忽略错误，无论如何都跳转到登录页
    } finally {
      window.location.href = '/login'
    }
  }

  return (
    <div className="flex h-screen bg-slate-900 text-slate-200">
      {/* ── 侧边栏 ── */}
      <aside className="flex w-64 flex-shrink-0 flex-col border-r border-slate-800 bg-slate-950">
        {/* Logo / 标题 */}
        <div className="flex items-center gap-3 border-b border-slate-800 px-6 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 text-xl">
            💬
          </div>
          <div>
            <h1 className="text-base font-semibold text-white">Bot 管理面板</h1>
            <p className="text-xs text-slate-500">QQ 控制台</p>
          </div>
        </div>

        {/* 导航菜单 */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-sky-600 text-white shadow-lg shadow-sky-600/20'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                }`
              }
            >
              <span className="text-lg">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* 底部：退出登录 + 信息 */}
        <div className="border-t border-slate-800 px-3 py-4">
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-red-600/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="text-lg">🚪</span>
            <span>{loggingOut ? '退出中...' : '退出登录'}</span>
          </button>
          <div className="mt-3 px-3 text-xs text-slate-600">
            <p>FastAPI + React</p>
            <p className="mt-1">© 2026 QQ Bot Panel</p>
          </div>
        </div>
      </aside>

      {/* ── 内容区 ── */}
      <main className="flex-1 overflow-y-auto p-8">
        {children ?? <Outlet />}
      </main>
    </div>
  )
}
