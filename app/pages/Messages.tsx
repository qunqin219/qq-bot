// 最近消息页 —— 查看缓存的 OneBot 消息
import { useEffect, useState } from 'react'
import { api } from '../../lib/api/client'
import { Card, EmptyState, Loading, ErrorBox, PageHeader } from '../../components/UI'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select } from '@/components/ui/select'
import { RefreshCwIcon, UserIcon, UsersIcon, MessagesSquareIcon } from '../../components/Icons'
import { cn } from '@/lib/utils'
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
  const [filterType, setFilterType] = useState('all')
  const [filterChat, setFilterChat] = useState('all')

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = { limit: 100 }
      const [msgs, chatList] = await Promise.all([
        api.getMessages(params),
        api.getChats(),
      ])
      setChats(chatList.chats || [])
      const all = msgs.messages || []
      if (filterType === 'group') {
        setMessages(all.filter((m) => m.group_id))
      } else if (filterType === 'private') {
        setMessages(all.filter((m) => !m.group_id))
      } else {
        setMessages(all)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType])

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

      <Card className="mb-5 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Select
              value={filterChat}
              onValueChange={setFilterChat}
              placeholder="全部会话"
              options={[
                { value: 'all', label: '全部会话' },
                ...chats.map((c) => ({
                  value: String(c.id),
                  label: `${c.type === 'group' ? '群' : '私聊'} ${c.name} (${c.id})`,
                })),
              ]}
              className="w-full sm:w-[260px]"
            />
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {visible.length} / {messages.length} 条
            </span>
          </div>
        </div>
      </Card>

      {visible.length === 0 ? (
        <EmptyState
          icon={MessagesSquareIcon}
          title="暂无消息记录"
          description="收到群聊或私聊消息后，这里会显示最近缓存内容。"
        />
      ) : (
        <div className="space-y-3">
          {visible.map((m, i) => {
            const isGroup = !!m.group_id
            return (
              <Card key={`${m.message_id ?? i}-${i}`} className="p-3">
                <div className="flex gap-3">
                  <div
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                      isGroup
                        ? 'bg-emerald-500 text-emerald-50'
                        : 'bg-primary text-primary-foreground'
                    )}
                  >
                    {isGroup ? <UsersIcon className="h-5 w-5" /> : <UserIcon className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">
                          {m.nickname || m.user_id}
                        </span>
                        <Badge variant={isGroup ? 'default' : 'secondary'}>
                          {isGroup ? '群' : '私聊'}
                        </Badge>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {m.time ? new Date(m.time).toLocaleString('zh-CN') : ''}
                      </span>
                    </div>
                    <div className="mt-1 break-words text-sm text-foreground">
                      {m.raw_message || '(空消息)'}
                    </div>
                    <div className="mt-2 font-mono text-xs text-muted-foreground">
                      ID {m.message_id} · user {m.user_id}
                      {isGroup && ` · group ${m.group_id}`}
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
