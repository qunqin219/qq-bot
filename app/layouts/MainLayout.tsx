// 主布局：左侧侧边栏导航 + 右侧内容区
import type { ReactNode, ComponentType, SVGProps } from 'react'
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { api } from '../../lib/api/client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  LayoutDashboardIcon,
  UsersIcon,
  MessagesSquareIcon,
  BrainIcon,
  PinIcon,
  ScrollTextIcon,
  SendIcon,
  SettingsIcon,
  LogOutIcon,
  MessageCircleIcon,
} from '../../components/Icons'

// 导航项配置
interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  end?: boolean;
}

const navItems: NavItem[] = [
  { to: '/', label: '仪表盘', icon: LayoutDashboardIcon, end: true },
  { to: '/admins', label: '管理员', icon: UsersIcon },
  { to: '/groups', label: '群管理', icon: UsersIcon },
  { to: '/messages', label: '最近消息', icon: MessagesSquareIcon },
  { to: '/conversations', label: '上下文', icon: BrainIcon },
  { to: '/memories', label: '个性记忆', icon: PinIcon },
  { to: '/logs', label: '运行日志', icon: ScrollTextIcon },
  { to: '/send', label: '发送消息', icon: SendIcon },
  { to: '/settings', label: '设置', icon: SettingsIcon },
]

export default function MainLayout({ children }: { children?: ReactNode }) {
  const [loggingOut, setLoggingOut] = useState(false)

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
    <div className="flex h-[100dvh] min-h-0 overflow-hidden bg-slate-50 text-slate-900">
      {/* ── 侧边栏 ── */}
      <aside className="flex h-full w-64 flex-shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
        {/* Logo / 标题 */}
        <div className="flex items-center gap-3 border-b border-slate-200 px-6 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white">
            <MessageCircleIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-900">Bot 管理面板</h1>
            <p className="text-xs text-slate-500">QQ 控制台</p>
          </div>
        </div>

        {/* 导航菜单 */}
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  )
                }
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        {/* 底部：退出登录 + 信息 */}
        <div className="border-t border-slate-200 px-3 py-4">
          <Button
            variant="ghost"
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full justify-start gap-3 text-slate-600 hover:bg-red-50 hover:text-red-600"
          >
            <LogOutIcon className="h-5 w-5" />
            <span>{loggingOut ? '退出中...' : '退出登录'}</span>
          </Button>
          <div className="mt-3 px-3 text-xs text-slate-400">
            <p>Express + React</p>
            <p className="mt-1">© 2026 QQ Bot Panel</p>
          </div>
        </div>
      </aside>

      {/* ── 内容区 ── */}
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-8">
        {children ?? <Outlet />}
      </main>
    </div>
  )
}
