// 仪表盘页 —— QQ Bot 状态概览
import { useEffect, useState } from 'react'
import { api } from '../../lib/api/client'
import type { StatusResponse, GroupInfo, BotLoginInfo } from '../../lib/shared/types'
import { Card, Loading, ErrorBox, PageHeader } from '../../components/UI'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  MessageCircleIcon,
  MessagesSquareIcon,
  RefreshCwIcon,
  ShieldIcon,
  UsersIcon,
  SendIcon,
  SettingsIcon,
  ScrollTextIcon,
} from '../../components/Icons'
import { Link } from 'react-router-dom'

interface DashboardData {
  status: StatusResponse & { group_count?: number }
  messageCount: number
  chatCount: number
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [status, messages, chats] = await Promise.all([
        api.getStatus(),
        api.getMessages({ limit: 1 }),
        api.getChats(),
      ])
      setData({
        status,
        messageCount: messages.total ?? 0,
        chatCount: chats.total ?? 0,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  if (loading) return <Loading text="正在获取 Bot 状态..." />
  if (error) return <ErrorBox message={error} onRetry={fetchData} />

  const { status, messageCount, chatCount } = data!
  const connected = status.connected
  const login: BotLoginInfo = status.login || {}
  const groups: GroupInfo[] = status.groups || []

  const stats = [
    { label: 'QQ', value: login.user_id ?? '—', icon: ShieldIcon },
    { label: '昵称', value: login.nickname ?? '—', icon: MessageCircleIcon },
    { label: '群数', value: status.group_count ?? 0, icon: UsersIcon },
    { label: '消息', value: messageCount, sub: `${chatCount} 会话`, icon: MessagesSquareIcon },
  ]

  const quickLinks = [
    { to: '/send', label: '发消息', icon: SendIcon },
    { to: '/settings', label: '设置', icon: SettingsIcon },
    { to: '/logs', label: '日志', icon: ScrollTextIcon },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="仪表盘"
        subtitle="QQ Bot 运行状态与快捷入口"
        action={
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCwIcon className="h-4 w-4" /> 刷新
          </Button>
        }
      />

      {/* 状态横幅 */}
      <div className={cn(
        'overflow-hidden rounded-lg border bg-card',
        connected ? 'border-l-4 border-l-emerald-500' : 'border-l-4 border-l-destructive'
      )}>
        <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
              connected ? 'bg-emerald-100 text-emerald-700' : 'bg-destructive/10 text-destructive'
            )}>
              <MessageCircleIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{login.nickname || 'QQ Bot'}</span>
                <Badge variant={connected ? 'default' : 'destructive'}>
                  {connected ? '在线' : '离线'}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {connected
                  ? `QQ: ${login.user_id ?? '—'} · 已同步 ${status.group_count ?? 0} 个群`
                  : '未连接 NapCat，状态数据将在连接后自动显示'}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            {quickLinks.map((link) => {
              const Icon = link.icon
              return (
                <Button key={link.to} variant="outline" size="sm" asChild>
                  <Link to={link.to} className="gap-1.5">
                    <Icon className="h-4 w-4" /> {link.label}
                  </Link>
                </Button>
              )
            })}
          </div>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon
          return (
            <Card key={s.label} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.label}</div>
                  <div className="mt-1.5 text-xl font-semibold tabular-nums text-foreground">{String(s.value)}</div>
                  {s.sub && <div className="mt-0.5 text-xs text-muted-foreground">{s.sub}</div>}
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                  <Icon className="h-4 w-4" />
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {/* 群列表 */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">群列表</h2>
          <span className="text-xs text-muted-foreground">前 {Math.min(groups.length, 5)} / {status.group_count ?? 0} 个</span>
        </div>

        {groups.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <div className={cn(
              'mx-auto flex h-10 w-10 items-center justify-center rounded-full',
              connected ? 'bg-secondary text-muted-foreground' : 'bg-destructive/10 text-destructive'
            )}>
              <UsersIcon className="h-5 w-5" />
            </div>
            <div className="mt-3 text-sm font-medium text-foreground">
              {connected ? '暂无群数据' : '等待 Bot 连接'}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {connected
                ? '当前账号没有可展示的群，刷新后会重新同步。'
                : 'NapCat 连接成功后，这里会显示最新群列表。'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {groups.slice(0, 5).map((g) => (
              <li
                key={g.group_id}
                className="flex items-center justify-between gap-4 px-5 py-3 transition hover:bg-muted/30"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                    <UsersIcon className="h-4 w-4" />
                  </div>
                  <span className="truncate text-sm font-medium text-foreground">{g.group_name || '未命名群'}</span>
                </div>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{g.group_id}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
