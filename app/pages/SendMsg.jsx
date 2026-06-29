// 发送消息页 —— 向群或私聊发送文本消息
import { useEffect, useState } from 'react'
import { api } from '../../lib/api/client.js'
import { Card, EmptyState, PageHeader, PanelHeader, useToast } from '../../components/UI.jsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MessageCircleIcon, RefreshCwIcon, SendIcon, UsersIcon } from '../../components/Icons.jsx'
export default function SendMsg() {
  const [type, setType] = useState('group') // group | private
  const [targetId, setTargetId] = useState('')
  const [message, setMessage] = useState('')
  const [groups, setGroups] = useState([])
  const [chats, setChats] = useState([])
  const [sending, setSending] = useState(false)
  const { success, error, ToastEl } = useToast()

  const fetchData = async () => {
    try {
      const [g, c] = await Promise.all([api.getGroups(), api.getChats()])
      setGroups(g.groups || [])
      setChats(c.chats || [])
    } catch {
      // 忽略，用户可手动输入
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const privateChats = chats.filter((c) => c.type === 'private')

  const handleSend = async (e) => {
    e.preventDefault()
    const id = Number(targetId.trim())
    if (!id || isNaN(id)) {
      error('请输入有效的 ID（数字）')
      return
    }
    if (!message.trim()) {
      error('消息内容不能为空')
      return
    }
    setSending(true)
    try {
      if (type === 'group') {
        await api.sendGroup(id, message)
      } else {
        await api.sendPrivate(id, message)
      }
      success('发送成功！')
      setMessage('')
    } catch (e) {
      error(e.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="发送消息"
        subtitle="向群聊或私聊发送文本消息"
        action={
          <Button variant="outline" onClick={fetchData}>
            <RefreshCwIcon className="h-4 w-4" /> 刷新目标
          </Button>
        }
      />
      {ToastEl}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="gap-0 p-0">
          <PanelHeader
            title="消息编辑"
            description={type === 'group' ? '当前发送到群聊。' : '当前发送到私聊用户。'}
            meta={type === 'group' ? '群消息' : '私聊消息'}
          />
          <form onSubmit={handleSend} className="space-y-5 px-5 py-4">
            {/* 类型选择 */}
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">发送类型</Label>
              <Tabs value={type} onValueChange={(v) => { setType(v); setTargetId('') }} className="mt-2">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="group">群消息</TabsTrigger>
                  <TabsTrigger value="private">私聊消息</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* 快速选择 */}
            {type === 'group' && groups.length > 0 && (
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">快速选择群</Label>
                <Select value={targetId} onValueChange={setTargetId}>
                  <SelectTrigger className="mt-2 w-full">
                    <SelectValue placeholder="— 选择群 —" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g, i) => (
                      <SelectItem key={g.group_id ?? i} value={String(g.group_id)}>
                        {g.group_name} ({g.group_id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {type === 'private' && privateChats.length > 0 && (
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">快速选择私聊</Label>
                <Select value={targetId} onValueChange={setTargetId}>
                  <SelectTrigger className="mt-2 w-full">
                    <SelectValue placeholder="— 选择用户 —" />
                  </SelectTrigger>
                  <SelectContent>
                    {privateChats
                      .map((c, i) => (
                        <SelectItem key={`${c.id}-${i}`} value={String(c.id)}>
                          {c.name} ({c.id})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* 手动输入 ID */}
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{type === 'group' ? '群号 (group_id)' : '用户 QQ (user_id)'}</Label>
              <Input
                type="number"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder={type === 'group' ? '例如：123456789' : '例如：1525899506'}
                className="mt-2 h-9 font-mono"
              />
            </div>

            {/* 消息内容 */}
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">消息内容</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                placeholder="输入要发送的消息..."
                className="mt-2"
              />
            </div>

            {/* 发送按钮 */}
            <Button type="submit" disabled={sending} className="w-full">
              {sending ? '发送中...' : <><SendIcon className="h-4 w-4" /> 发送消息</>}
            </Button>
          </form>
        </Card>

        <Card className="gap-0 p-0">
          <PanelHeader
            title="可选目标"
            description="最近同步的群聊和私聊目标。"
            meta={`${groups.length} 群 · ${privateChats.length} 私聊`}
          />
          {groups.length === 0 && privateChats.length === 0 ? (
            <EmptyState
              icon={MessageCircleIcon}
              title="暂无可选目标"
              description="可以先手动输入群号或用户 QQ。"
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {groups.slice(0, 5).map((group, index) => (
                <button
                  key={`group-${group.group_id ?? index}`}
                  type="button"
                  onClick={() => {
                    setType('group')
                    setTargetId(String(group.group_id))
                  }}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-slate-50"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                    <UsersIcon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-950">{group.group_name || '未命名群'}</span>
                    <span className="block truncate font-mono text-xs text-slate-400">{group.group_id}</span>
                  </span>
                </button>
              ))}
              {privateChats.slice(0, 5).map((chat, index) => (
                <button
                  key={`private-${chat.id ?? index}`}
                  type="button"
                  onClick={() => {
                    setType('private')
                    setTargetId(String(chat.id))
                  }}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-slate-50"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                    <MessageCircleIcon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-950">{chat.name || chat.id}</span>
                    <span className="block truncate font-mono text-xs text-slate-400">{chat.id}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
