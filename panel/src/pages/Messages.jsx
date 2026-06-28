// 最近消息页 —— 查看缓存的 OneBot 消息
import { useEffect, useState } from 'react'
import { api } from '../api/client.js'
import { Card, Loading, ErrorBox, PageHeader } from '../components/UI.jsx'

export default function Messages() {
  const [messages, setMessages] = useState([])
  const [chats, setChats] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
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
      setError(e.message)
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
          <button
            onClick={fetchData}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500"
          >
            🔄 刷新
          </button>
        }
      />

      {/* 筛选器 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-slate-700 bg-slate-800/50 p-1">
          {[
            { v: 'all', label: '全部' },
            { v: 'group', label: '群消息' },
            { v: 'private', label: '私聊' },
          ].map((t) => (
            <button
              key={t.v}
              onClick={() => setFilterType(t.v)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                filterType === t.v
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <select
          value={filterChat}
          onChange={(e) => setFilterChat(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
        >
          <option value="all">全部会话</option>
          {chats.map((c) => (
            <option key={`${c.type}-${c.id}`} value={String(c.id)}>
              {c.type === 'group' ? '👥' : '👤'} {c.name} ({c.id})
            </option>
          ))}
        </select>
      </div>

      {/* 消息列表 */}
      <Card className="p-0">
        {visible.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">
            暂无消息记录
          </p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {visible.map((m, i) => {
              const isGroup = !!m.group_id
              return (
                <li key={`${m.message_id ?? i}-${i}`} className="px-5 py-3.5">
                  <div className="flex items-start gap-3">
                    {/* 头像占位 */}
                    <div
                      className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${
                        isGroup
                          ? 'bg-gradient-to-br from-emerald-500 to-teal-600'
                          : 'bg-gradient-to-br from-sky-500 to-indigo-600'
                      }`}
                    >
                      {isGroup ? '群' : String(m.nickname || m.user_id || '?').slice(-2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 truncate">
                          <span className="text-sm font-medium text-slate-200">
                            {m.nickname || m.user_id}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              isGroup
                                ? 'bg-emerald-600/20 text-emerald-400'
                                : 'bg-sky-600/20 text-sky-400'
                            }`}
                          >
                            {isGroup ? '群' : '私聊'}
                          </span>
                        </div>
                        <span className="flex-shrink-0 text-xs text-slate-500">
                          {m.time ? new Date(m.time).toLocaleString('zh-CN') : ''}
                        </span>
                      </div>
                      <div className="mt-1 break-words text-sm text-slate-300">
                        {m.raw_message || '(空消息)'}
                      </div>
                      <div className="mt-1 text-xs text-slate-600">
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
