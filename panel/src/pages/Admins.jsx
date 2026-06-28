// 管理员管理页 —— 添加/删除管理员 QQ
import { useEffect, useState } from 'react'
import { api } from '../api/client.js'
import { Card, Loading, ErrorBox, PageHeader, useToast } from '../components/UI.jsx'

export default function Admins() {
  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [newAdmin, setNewAdmin] = useState('')
  const [saving, setSaving] = useState(false)
  const { success, error: toastError, ToastEl } = useToast()

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const cfg = await api.getConfig()
      setAdmins(cfg.admins || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const persist = async (next) => {
    setSaving(true)
    try {
      await api.updateConfig({ admins: next })
      setAdmins(next)
      success('管理员列表已更新')
    } catch (e) {
      toastError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleAdd = (e) => {
    e.preventDefault()
    const id = Number(newAdmin.trim())
    if (!id || isNaN(id)) {
      toastError('请输入有效的 QQ 号（数字）')
      return
    }
    if (admins.includes(id)) {
      toastError('该 QQ 已在管理员列表中')
      return
    }
    persist([...admins, id])
    setNewAdmin('')
  }

  const handleRemove = (id) => {
    persist(admins.filter((a) => a !== id))
  }

  if (loading) return <Loading text="加载管理员列表..." />
  if (error) return <ErrorBox message={error} onRetry={fetchData} />

  return (
    <div>
      <PageHeader
        title="管理员管理"
        subtitle="只有管理员 QQ 发送的消息才会被 Bot 回复"
      />
      {ToastEl}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 添加管理员 */}
        <Card>
          <h3 className="mb-4 text-lg font-semibold text-white">添加管理员</h3>
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                QQ 号
              </label>
              <input
                type="number"
                value={newAdmin}
                onChange={(e) => setNewAdmin(e.target.value)}
                placeholder="例如：1525899506"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-slate-100 placeholder-slate-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? '保存中...' : '➕ 添加管理员'}
            </button>
          </form>
        </Card>

        {/* 管理员列表 */}
        <Card>
          <h3 className="mb-4 text-lg font-semibold text-white">
            当前管理员 ({admins.length})
          </h3>
          {admins.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              暂无管理员
            </p>
          ) : (
            <ul className="space-y-2">
              {admins.map((id) => (
                <li
                  key={id}
                  className="flex items-center justify-between rounded-lg bg-slate-900/50 px-4 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-sm font-bold text-white">
                      {String(id).slice(-2)}
                    </div>
                    <div>
                      <div className="font-mono text-sm text-slate-200">
                        {id}
                      </div>
                      <div className="text-xs text-slate-500">QQ 用户</div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemove(id)}
                    disabled={saving}
                    className="rounded-md bg-red-600/20 px-3 py-1 text-xs font-medium text-red-400 transition hover:bg-red-600 hover:text-white disabled:opacity-50"
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
