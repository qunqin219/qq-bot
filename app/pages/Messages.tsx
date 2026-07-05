// 最近消息页 —— 查看缓存的 OneBot 消息
import { useEffect, useState } from 'react'
import { api } from '../../lib/api/client'
import { Card, EmptyState, Loading, ErrorBox, PageHeader, PanelHeader } from '../../components/UI'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RefreshCwIcon } from '../../components/Icons'
import { MessagesSquareIcon } from '../../components/Icons'
import type { ChatSummary } from '../../lib/shared/types'

interface MessageItem {
  message_id: number | string
  user_id: number | string
  group_id?: number | string | null
  nickname?: string
  time?: string | number
  raw_message?: string
  [key: string]: unknown
}
export default function Messages() {
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterType, setFilterType] = useState('all') // all | group | private
  const [filterChat, setFilterChat] = useState('all') // all 或 chat id

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = { limit: 100 }
      if (filterType === 'group') {
        // 群消息
        const [msgs, chatList] = await Promise.all([
          api.getMessages(params),
          api.getChats(),
        ])
        setChats(chatList.chats || [])
        setMessages((msgs.messages || []).filter((m) => m.group_id))
      } else if (filterType === 'private') {
        const [msgs, chatList] = await Promise.all([
          api.getMessages(params),
          api.getChats(),
        ])
        setChats(chatList.chats || [])
        setMessages((msgs.messages || []).filter((m) => !m.group_id))
      } else {
        const [msgs, chatList] = await Promise.all([
          api.getMessages(params),
          api.getChats(),
        ])
        setChats(chatList.chats || [])
        setMessages(msgs.messages || [])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [filterType])

  // 按 chat 筛选（本地过滤）
  const visible =
    filterChat === 'all'
      ? messages
      : messages.filter((m) => {
          const id = m.group_id ? m.group_id : m.user_id
          return String(id) === String(filterChat)
        })

  if (loading) return <Loading text="加载消息..." />
  if (error) return <ErrorBox message={error} onRetry={fetchData} />

  return (
    <div>
      <PageHeader
        title="最近消息"
        subtitle={`共 ${visible.length} 条消息`}
        action={
          <Button onClick={fetchData} disabled={loading}>
            <RefreshCwIcon className="h-4 w-4" /> 刷新
          </Button>
        }
      />

      {/* 筛选器 */}
      <Card className="mb-5 gap-0 p-0">
        <PanelHeader
          title="消息筛选"
          description="按消息类型和会话快速收窄最近缓存。"
          meta={`${visible.length} / ${messages.length} 条`}
        />
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
          <Tabs
            value={filterType}
            onValueChange={(value) => {
              setFilterType(value)
              setFilterChat('all')
            }}
          >
            <TabsList>
              <TabsTrigger value="all">全部</TabsTrigger>
              <TabsTrigger value="group">群消息</TabsTrigger>
              <TabsTrigger value="private">私聊</TabsTrigger>
            </TabsList>
          </Tabs>

          <Select value={filterChat} onValueChange={setFilterChat}>
            <SelectTrigger className="w-full sm:w-[260px]">
              <SelectValue placeholder="全部会话" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部会话</SelectItem>
              {chats.map((c) => (
                <SelectItem key={`${c.type}-${c.id}`} value={String(c.id)}>
                  {c.type === 'group' ? '群' : '私聊'} {c.name} ({c.id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* 消息列表 */}
      <Card className="gap-0 p-0">
        <PanelHeader
          title="消息列表"
          description="展示后端缓存的 OneBot 消息，最新缓存由服务端写入。"
          meta={`${visible.length} 条`}
        />
        {visible.length === 0 ? (
          <EmptyState
            icon={MessagesSquareIcon}
            title="暂无消息记录"
            description="收到群聊或私聊消息后，这里会显示最近缓存内容。"
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {visible.map((m, i) => {
              const isGroup = !!m.group_id
              return (
                <li key={`${m.message_id ?? i}-${i}`} className="px-5 py-3.5 transition hover:bg-slate-50">
                  <div className="flex items-start gap-3">
                    {/* 头像占位 */}
                    <div
                      className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white ${
                        isGroup
                          ? 'bg-emerald-600'
                          : 'bg-slate-900'
                      }`}
                    >
                      {isGroup ? '群' : String(m.nickname || m.user_id || '?').slice(-2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-semibold text-slate-950">
                            {m.nickname || m.user_id}
                          </span>
                          <Badge
                            variant={isGroup ? 'default' : 'secondary'}
                            className={`h-5 rounded-full px-2 text-[10px] ${isGroup ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-100'}`}
                          >
                            {isGroup ? '群' : '私聊'}
                          </Badge>
                        </div>
                        <span className="flex-shrink-0 text-xs text-slate-400">
                          {m.time ? new Date(m.time).toLocaleString('zh-CN') : ''}
                        </span>
                      </div>
                      <div className="mt-1 break-words text-sm text-slate-700">
                        {m.raw_message || '(空消息)'}
                      </div>
                      <div className="mt-2 font-mono text-xs text-slate-400">
                        user_id: {m.user_id}
                        {isGroup && ` · group_id: ${m.group_id}`}
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
