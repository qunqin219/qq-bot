// 仪表盘 —— 状态优先的双栏运维总览
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api/client'
import type { StatusResponse, GroupInfo, BotLoginInfo } from '../../lib/shared/types'
import {
  Loading,
  ErrorBox,
  PageHeader,
  StatusDot,
  DataPanel,
  PanelHeader,
  MetricCell,
  EmptyState,
} from '../../components/UI'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  RefreshCwIcon,
  UsersIcon,
  SendIcon,
  SettingsIcon,
  ScrollTextIcon,
  ShieldIcon,
  MessagesSquareIcon,
  PinIcon,
  BrainIcon,
} from '../../components/Icons'

interface DashboardData {
  status: StatusResponse & { group_count?: number }
  messageCount: number
  chatCount: number
}

const commands = [
  { to: '/send', label: '发消息', desc: '推送到群/私聊', icon: SendIcon },
  { to: '/logs', label: '日志', desc: '排查 AI / 工具', icon: ScrollTextIcon },
  { to: '/settings', label: '设置', desc: '运行时参数', icon: SettingsIcon },
  { to: '/admins', label: '管理员', desc: '访问控制', icon: ShieldIcon },
  { to: '/conversations', label: '上下文', desc: '会话历史', icon: BrainIcon },
  { to: '/memories', label: '记忆', desc: '长期记忆', icon: PinIcon },
]

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

  return (
    <div className="space-y-4">
      <PageHeader
        title="仪表盘"
        subtitle="链路状态 · 吞吐指标 · 快捷运维"
        action={
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCwIcon className="h-4 w-4" /> 刷新
          </Button>
        }
      />

      {/* 顶部：连接状态条 */}
      <DataPanel className="overflow-hidden">
        <div
          className={cn(
            'flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
            connected ? 'bg-teal-950 text-teal-50' : 'bg-red-950 text-red-50'
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <StatusDot ok={connected} label={connected ? 'NapCat Online' : 'NapCat Offline'} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {login.nickname || 'QQ Bot'}
                {login.user_id ? (
                  <span className="ml-2 font-mono text-xs font-normal opacity-70">
                    {login.user_id}
                  </span>
                ) : null}
              </div>
              <p className="truncate font-mono text-[11px] opacity-70">
                {connected
                  ? `synced groups ${status.group_count ?? 0} · chats ${chatCount}`
                  : '等待 WebSocket 连接恢复'}
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'w-fit border-current/30 font-mono',
              connected ? 'text-teal-100' : 'text-red-100'
            )}
          >
            {connected ? 'READY' : 'DOWN'}
          </Badge>
        </div>

        <div className="grid grid-cols-2 divide-x divide-border lg:grid-cols-4">
          <MetricCell label="QQ" value={login.user_id ?? '—'} />
          <MetricCell label="昵称" value={login.nickname ?? '—'} />
          <MetricCell label="群数" value={status.group_count ?? 0} hint="已同步" />
          <MetricCell
            label="消息缓存"
            value={messageCount}
            hint={`${chatCount} 会话`}
          />
        </div>
      </DataPanel>

      {/* 双栏：群表 + 命令面板 */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.8fr)]">
        <DataPanel>
          <PanelHeader
            title="Groups"
            meta={`${Math.min(groups.length, 8)} / ${status.group_count ?? 0}`}
            action={
              <Button variant="outline" size="xs" asChild>
                <Link to="/groups">管理白名单</Link>
              </Button>
            }
          />
          {groups.length === 0 ? (
            <EmptyState
              icon={UsersIcon}
              title={connected ? '暂无群数据' : '等待 Bot 连接'}
              description={
                connected
                  ? '当前账号没有可展示的群。'
                  : 'NapCat 连接成功后会同步群列表。'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="font-mono">群名</TableHead>
                    <TableHead className="font-mono">Group ID</TableHead>
                    <TableHead className="font-mono text-right">成员</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.slice(0, 8).map((g) => (
                    <TableRow key={g.group_id}>
                      <TableCell className="max-w-[220px] truncate font-medium">
                        {g.group_name || '未命名群'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {g.group_id}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {g.member_count ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DataPanel>

        <DataPanel>
          <PanelHeader title="Commands" description="常用运维入口" />
          <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-1">
            {commands.map((cmd) => {
              const Icon = cmd.icon
              return (
                <Link
                  key={cmd.to}
                  to={cmd.to}
                  className="flex items-center gap-3 bg-card px-3 py-3 transition hover:bg-teal-50/60"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">{cmd.label}</div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">
                      {cmd.desc}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
          <div className="border-t border-border px-3 py-2">
            <Link
              to="/messages"
              className="inline-flex items-center gap-1.5 font-mono text-[11px] text-primary hover:underline"
            >
              <MessagesSquareIcon className="h-3.5 w-3.5" />
              查看消息缓存 →
            </Link>
          </div>
        </DataPanel>
      </div>
    </div>
  )
}
