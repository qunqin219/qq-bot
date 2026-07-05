// 主布局：顶部导航栏 + 下方内容区
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
  ShieldIcon,
} from '../../components/Icons'

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  end?: boolean;
}

const navItems: NavItem[] = [
  { to: '/', label: '仪表盘', icon: LayoutDashboardIcon, end: true },
  { to: '/admins', label: '管理员', icon: ShieldIcon },
  { to: '/groups', label: '群管理', icon: UsersIcon },
  { to: '/messages', label: '消息', icon: MessagesSquareIcon },
  { to: '/conversations', label: '上下文', icon: BrainIcon },
  { to: '/memories', label: '记忆', icon: PinIcon },
  { to: '/send', label: '发消息', icon: SendIcon },
  { to: '/logs', label: '日志', icon: ScrollTextIcon },
  { to: '/settings', label: '设置', icon: SettingsIcon },
]

export default function MainLayout({ children }: { children?: ReactNode }) {
  const [loggingOut, setLoggingOut] = useState(false)

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await api.logout()
    } catch {
      // ignore
    } finally {
      window.location.href = '/login'
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          {/* Logo */}
          <NavLink to="/" className="flex items-center gap-2 pr-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <MessageCircleIcon className="h-4 w-4" />
            </div>
            <span className="hidden text-base font-semibold sm:inline">QQ Bot</span>
          </NavLink>

          {/* 导航链接 */}
          <nav className="hidden flex-1 items-center gap-1 md:flex">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </NavLink>
              )
            })}
          </nav>

          {/* 移动端导航：只显示图标 */}
          <nav className="flex flex-1 items-center gap-1 overflow-x-auto md:hidden">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-secondary'
                    )
                  }
                  title={item.label}
                >
                  <Icon className="h-4 w-4" />
                </NavLink>
              )
            })}
          </nav>

          {/* 退出 */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            disabled={loggingOut}
            className="gap-2 text-muted-foreground hover:text-destructive"
          >
            <LogOutIcon className="h-4 w-4" />
            <span className="hidden sm:inline">{loggingOut ? '退出中...' : '退出'}</span>
          </Button>
        </div>
      </header>

      {/* 内容区 */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {children ?? <Outlet />}
      </main>
    </div>
  )
}
