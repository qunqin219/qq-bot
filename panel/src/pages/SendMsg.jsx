// 发送消息页 —— 向群或私聊发送文本消息
import { useEffect, useState } from 'react'
import { api } from '../api/client.js'
import { Card, PageHeader, useToast } from '../components/UI.jsx'

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
      <PageHeader title="发送消息" subtitle="向群聊或私聊发送文本消息" />
      {ToastEl}

      <div className="mx-auto max-w-2xl">
        <Card>
          <form onSubmit={handleSend} className="space-y-5">
            {/* 类型选择 */}
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                发送类型
              </label>
              <div className="flex rounded-lg border border-slate-700 bg-slate-900 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setType('group')
                    setTargetId('')
                  }}
                  className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition ${
                    type === 'group'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  👥 群消息
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setType('private')
                    setTargetId('')
                  }}
                  className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition ${
                    type === 'private'
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  👤 私聊消息
                </button>
              </div>
            </div>

            {/* 快速选择 */}
            {type === 'group' && groups.length > 0 && (
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  快速选择群
                </label>
                <select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-slate-100 focus:border-sky-500 focus:outline-none"
                >
                  <option value="">— 选择群 —</option>
                  {groups.map((g, i) => (
                    <option key={g.group_id ?? i} value={g.group_id}>
                      {g.group_name} ({g.group_id})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {type === 'private' && chats.filter((c) => c.type === 'private').length > 0 && (
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  快速选择私聊
                </label>
                <select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-slate-100 focus:border-sky-500 focus:outline-none"
                >
                  <option value="">— 选择用户 —</option>
                  {chats
                    .filter((c) => c.type === 'private')
                    .map((c, i) => (
                      <option key={`${c.id}-${i}`} value={c.id}>
                        {c.name} ({c.id})
                      </option>
                    ))}
                </select>
              </div>
            )}

            {/* 手动输入 ID */}
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                {type === 'group' ? '群号 (group_id)' : '用户 QQ (user_id)'}
              </label>
              <input
                type="number"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder={type === 'group' ? '例如：123456789' : '例如：1525899506'}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-slate-100 placeholder-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>

            {/* 消息内容 */}
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                消息内容
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                placeholder="输入要发送的消息..."
                className="w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-slate-100 placeholder-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>

            {/* 发送按钮 */}
            <button
              type="submit"
              disabled={sending}
              className="w-full rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? '发送中...' : '📤 发送消息'}
            </button>
          </form>
        </Card>
      </div>
    </div>
  )
}
