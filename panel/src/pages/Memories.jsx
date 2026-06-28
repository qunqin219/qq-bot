// 个性化记忆页 —— 查看和管理按会话隔离的 AI 记忆
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client.js'
import { Card, Loading, ErrorBox, PageHeader, useToast } from '../components/UI.jsx'

function formatTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

function getKeyLabel(key) {
  if (key?.startsWith('private:')) return `私聊 ${key.replace('private:', '')}`
  if (key?.startsWith('group:')) return `群聊 ${key.replace('group:', '')}`
  return key || '-'
}

export default function Memories() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filterKey, setFilterKey] = useState('')
  const [newKey, setNewKey] = useState('')
  const [newContent, setNewContent] = useState('')
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const { success, error: toastError, ToastEl } = useToast()

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getMemories()
      setItems(data.memories || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const keys = useMemo(
    () => [...new Set(items.map((m) => m.conversationKey).filter(Boolean))],
    [items]
  )

  const shown = filterKey ? items.filter((m) => m.conversationKey === filterKey) : items

  const handleCreate = async (e) => {
    e.preventDefault()
    const key = newKey.trim()
    const content = newContent.trim()
    if (!key || !content) {
      toastError('会话 key 和记忆内容不能为空')
      return
    }
    setSaving(true)
    try {
      await api.createMemory(key, content)
      setNewContent('')
      success('记忆已添加')
      await fetchData()
    } catch (e) {
      toastError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async () => {
    if (!editing) return
    const content = editing.content.trim()
    if (!content) {
      toastError('记忆内容不能为空')
      return
    }
    setSaving(true)
    try {
      await api.updateMemory(editing.id, editing.conversationKey, content)
      setEditing(null)
      success('记忆已更新')
      await fetchData()
    } catch (e) {
      toastError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (memory) => {
    if (!window.confirm(`确定删除这条记忆吗？\n\n${memory.content}`)) return
    try {
      await api.deleteMemory(memory.id, memory.conversationKey)
      success('记忆已删除')
      await fetchData()
    } catch (e) {
      toastError(e.message)
    }
  }

  const handleClearKey = async () => {
    if (!filterKey) return
    if (!window.confirm(`确定清空「${filterKey}」下的全部记忆吗？`)) return
    try {
      await api.clearMemories(filterKey)
      success('该会话记忆已清空')
      await fetchData()
    } catch (e) {
      toastError(e.message)
    }
  }

  if (loading) return <Loading text="加载记忆..." />
  if (error) return <ErrorBox message={error} onRetry={fetchData} />

  return (
    <div>
      <PageHeader
        title="个性化记忆"
        subtitle="按私聊和群聊会话 key 隔离保存，模型可通过 create/edit/delete memory 工具主动维护"
        action={
          <button
            onClick={fetchData}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
          >
            刷新
          </button>
        }
      />
      {ToastEl}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-white">记忆列表</h3>
              <p className="mt-1 text-xs text-slate-500">
                当前共 {items.length} 条。私聊使用 private:QQ，群聊使用 group:群号
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={filterKey}
                onChange={(e) => setFilterKey(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
              >
                <option value="">全部会话</option>
                {keys.map((key) => (
                  <option key={key} value={key}>{getKeyLabel(key)}</option>
                ))}
              </select>
              <button
                onClick={handleClearKey}
                disabled={!filterKey}
                className="rounded-lg bg-red-600/20 px-3 py-2 text-xs font-medium text-red-300 transition hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                清空此会话
              </button>
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-700 py-12 text-center text-sm text-slate-500">
              暂无记忆
            </div>
          ) : (
            <div className="space-y-3">
              {shown.map((memory) => (
                <div key={memory.id} className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                    <div className="font-mono">#{memory.id} · {memory.conversationKey}</div>
                    <div>{formatTime(memory.updated_at || memory.created_at)}</div>
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-6 text-slate-100">
                    {memory.content}
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      onClick={() => setEditing(memory)}
                      className="rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-600"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDelete(memory)}
                      className="rounded bg-red-600/20 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-600 hover:text-white"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h3 className="mb-4 text-lg font-semibold text-white">手动添加</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">会话 key</label>
              <input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="group:963688355 或 private:3605900361"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100 placeholder-slate-600 focus:border-sky-500 focus:outline-none"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {keys.slice(0, 6).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setNewKey(key)}
                    className="rounded bg-slate-700/70 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600"
                  >
                    {getKeyLabel(key)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">记忆内容</label>
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                rows={6}
                placeholder="例如：用户喜欢直接简短的回答，不喜欢客服腔"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? '保存中...' : '添加记忆'}
            </button>
          </form>
        </Card>
      </div>

      {editing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <h3 className="mb-4 text-lg font-semibold text-white">编辑记忆 #{editing.id}</h3>
            <p className="mb-3 font-mono text-xs text-slate-500">{editing.conversationKey}</p>
            <textarea
              value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              rows={8}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setEditing(null)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                取消
              </button>
              <button
                onClick={handleUpdate}
                disabled={saving}
                className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
