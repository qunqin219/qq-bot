// 上下文管理页 —— 查看和清理按会话隔离的 AI 历史
import { useEffect, useState } from 'react'
import { api } from '../api/client.js'
import { Card, Loading, ErrorBox, PageHeader, useToast } from '../components/UI.jsx'

function formatTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function getKeyLabel(key) {
  if (key.startsWith('private:')) return `私聊 ${key.replace('private:', '')}`
  if (key.startsWith('group:')) return `群聊 ${key.replace('group:', '')}`
  return key
}

export default function Conversations() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [clearingKey, setClearingKey] = useState(null)
  const [clearingAll, setClearingAll] = useState(false)
  const { success, error: toastError, ToastEl } = useToast()

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getConversations()
      setItems(data.conversations || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleClearOne = async (key) => {
    if (!window.confirm(`确定清空「${key}」的上下文吗？`)) return
    setClearingKey(key)
    try {
      await api.clearConversation(key)
      success('会话上下文已清空')
      await fetchData()
    } catch (e) {
      toastError(e.message)
    } finally {
      setClearingKey(null)
    }
  }

  const handleClearAll = async () => {
    if (!items.length) return
    if (!window.confirm('确定清空全部 AI 上下文历史吗？此操作不可恢复。')) return
    if (!window.confirm('请再次确认：真的要清空全部会话上下文？')) return
    setClearingAll(true)
    try {
      await api.clearAllConversations()
      success('全部上下文已清空')
      await fetchData()
    } catch (e) {
      toastError(e.message)
    } finally {
      setClearingAll(false)
    }
  }

  if (loading) return <Loading text="加载上下文..." />
  if (error) return <ErrorBox message={error} onRetry={fetchData} />

  return (
    <div>
      <PageHeader
        title="上下文"
        subtitle="管理按私聊和群聊隔离保存的 AI 对话历史"
        action={
          <button
            onClick={handleClearAll}
            disabled={clearingAll || items.length === 0}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {clearingAll ? '清空中...' : '清空全部'}
          </button>
        }
      />
      {ToastEl}

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">会话列表</h3>
            <p className="mt-1 text-xs text-slate-500">
              私聊和每个群聊的上下文独立保存，互不串线。
            </p>
          </div>
          <button
            onClick={fetchData}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
          >
            刷新
          </button>
        </div>

        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-700 py-12 text-center text-sm text-slate-500">
            暂无上下文历史
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-700">
            <table className="min-w-full divide-y divide-slate-700">
              <thead className="bg-slate-900/70">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    会话
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    Key
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    消息数量 / 轮数
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    更新时间
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700 bg-slate-800/30">
                {items.map((item) => (
                  <tr key={item.key} className="hover:bg-slate-800/60">
                    <td className="px-4 py-3 text-sm font-medium text-slate-100">
                      {getKeyLabel(item.key)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">
                      {item.key}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {(item.turns || 0) * 2} 条 / {item.turns || 0} 轮
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-400">
                      {formatTime(item.updated_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleClearOne(item.key)}
                        disabled={clearingKey === item.key}
                        className="rounded bg-red-600/20 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {clearingKey === item.key ? '清空中...' : '清空'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
