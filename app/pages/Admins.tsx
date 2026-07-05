// 管理员管理页 —— 添加/删除管理员 QQ
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../../lib/api/client'
import { Card, EmptyState, Loading, ErrorBox, PageHeader, PanelHeader, useToast } from '../../components/UI'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PlusIcon, ShieldIcon, Trash2Icon, UsersIcon } from '../../components/Icons'
export default function Admins() {
  const [admins, setAdmins] = useState<Array<number | string>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const persist = async (next: Array<number | string>) => {
    setSaving(true)
    try {
      await api.updateConfig({ admins: next })
      setAdmins(next)
      success('管理员列表已更新')
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleAdd = (e: FormEvent<HTMLFormElement>) => {
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

  const handleRemove = (id: number | string) => {
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

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(320px,420px)_1fr]">
        {/* 添加管理员 */}
        <Card className="gap-0 p-0">
          <PanelHeader
            title="添加管理员"
            description="添加后立即写入配置，新的管理员可触发命令与私聊回复。"
          />
          <form onSubmit={handleAdd} className="space-y-4 px-5 py-4">
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500">QQ 号</Label>
              <Input
                type="number"
                value={newAdmin}
                onChange={(e) => setNewAdmin(e.target.value)}
                placeholder="例如：1525899506"
                className="mt-2 h-9 font-mono"
              />
            </div>
            <Button type="submit" disabled={saving || !newAdmin.trim()} className="w-full">
              {saving ? '保存中...' : <><PlusIcon className="h-4 w-4" /> 添加管理员</>}
            </Button>
          </form>
        </Card>

        {/* 管理员列表 */}
        <Card className="gap-0 p-0">
          <PanelHeader
            title="当前管理员"
            description="列表按 QQ 号保存，删除后会立即停止该账号的管理权限。"
            meta={`${admins.length} 个`}
          />
          {admins.length === 0 ? (
            <EmptyState
              icon={ShieldIcon}
              title="暂无管理员"
              description="添加至少一个管理员后，Bot 才能安全地处理管理命令。"
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {admins.map((id) => (
                <li
                  key={id}
                  className="flex items-center justify-between gap-4 px-5 py-3 transition hover:bg-slate-50"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-sm font-semibold text-white">
                      <UsersIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-mono text-sm font-medium text-slate-950">
                        {id}
                      </div>
                      <div className="text-xs text-slate-400">QQ 用户</div>
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleRemove(id)}
                    disabled={saving}
                  >
                    <Trash2Icon className="h-3.5 w-3.5" /> 删除
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
