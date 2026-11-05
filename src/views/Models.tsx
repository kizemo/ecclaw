import { useEffect, useState, type JSX } from 'react'
import { api, type ModelProvider } from '../api'

const EMPTY: ModelProvider = {
  id: '',
  label: '',
  kind: 'openai-compatible',
  baseUrl: '',
  hasApiKey: false,
  models: []
}

/**
 * 自定义大模型接入 —— ecclaw 相对 dabi 的核心增量。
 * dabi 只能用内置 provider 白名单；这里允许任意 OpenAI 兼容 / Anthropic 兼容端点，
 * 以及 Ollama / LM Studio / vLLM 这类本地推理端点。
 */
export default function Models(): JSX.Element {
  const [list, setList] = useState<ModelProvider[]>([])
  const [draft, setDraft] = useState<ModelProvider>(EMPTY)
  const [apiKey, setApiKey] = useState('')
  const [modelsText, setModelsText] = useState('')
  const [message, setMessage] = useState('')
  const [testing, setTesting] = useState(false)

  const reload = async (): Promise<void> => {
    setList(await api.providers.list())
  }

  useEffect(() => {
    void reload()
  }, [])

  const pick = (provider: ModelProvider): void => {
    setDraft(provider)
    setApiKey('')
    setModelsText(provider.models.join('\n'))
    setMessage('')
  }

  const save = async (): Promise<void> => {
    try {
      const models = modelsText
        .split(/[\n,]/)
        .map((m) => m.trim())
        .filter(Boolean)
      const next = await api.providers.save({ ...draft, models, apiKey: apiKey || undefined })
      setList(next)
      setMessage('已写入 openclaw.json 的 models.providers')
      setDraft(EMPTY)
      setApiKey('')
      setModelsText('')
    } catch (err) {
      setMessage(`保存失败：${(err as Error).message}`)
    }
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    setMessage('测试中…')
    try {
      const models = modelsText
        .split(/[\n,]/)
        .map((m) => m.trim())
        .filter(Boolean)
      const result = await api.providers.test({ ...draft, models, apiKey: apiKey || undefined })
      setMessage(
        result.ok
          ? `连接正常${result.latencyMs ? `（${result.latencyMs}ms）` : ''}${
              result.models?.length ? `，模型：${result.models.slice(0, 8).join('、')}` : ''
            }`
          : `连接失败：${result.message}`
      )
    } finally {
      setTesting(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    setList(await api.providers.remove(id))
  }

  const setDefault = async (providerId: string, modelId: string): Promise<void> => {
    try {
      setList(await api.providers.setDefaultModel(providerId, modelId))
      setMessage(`内核默认模型已设为 ${providerId}/${modelId}`)
    } catch (err) {
      setMessage(`设置默认失败：${(err as Error).message}`)
    }
  }

  return (
    <section className="view">
      <h1>大模型接入</h1>
      <p className="hint">
        支持任意 OpenAI 兼容 / Anthropic 兼容端点与本地推理。配置写入 openclaw.json 的{' '}
        <code>models.providers</code>，密钥请以 Base64/明文谨慎保存。
      </p>

      <div className="split">
        <ul className="list">
          {list.length === 0 ? <li className="empty">尚未配置任何 Provider</li> : null}
          {list.map((provider) => (
            <li key={provider.id}>
              <button className="link" onClick={() => pick(provider)}>
                {provider.label || provider.id}
              </button>
              <span className="tag">{provider.kind === 'anthropic-compatible' ? 'Anthropic' : 'OpenAI'}</span>
              {provider.hasApiKey ? <span className="tag ok">已配密钥</span> : null}
              {provider.local ? <span className="tag">本地</span> : null}
              <p className="mono">{provider.baseUrl}</p>
              <p className="hint">{provider.models.join('、') || '未指定模型清单'}</p>
              {provider.models.length > 0 ? (
                <div className="row">
                  {provider.models.map((m) => (
                    <button
                      key={m}
                      className="ghost"
                      disabled={provider.defaultModel === m}
                      onClick={() => void setDefault(provider.id, m)}
                    >
                      {provider.defaultModel === m ? `默认：${m}` : `设为默认：${m}`}
                    </button>
                  ))}
                </div>
              ) : null}
              <button className="ghost danger" onClick={() => void remove(provider.id)}>
                删除
              </button>
            </li>
          ))}
        </ul>

        <div className="editor">
          <div className="grid2">
            <label>
              Provider ID
              <input
                value={draft.id}
                placeholder="my-gateway"
                onChange={(e) => setDraft({ ...draft, id: e.target.value })}
              />
            </label>
            <label>
              显示名
              <input
                value={draft.label}
                placeholder="我的推理网关"
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </label>
          </div>
          <label>
            接口类型
            <select
              value={draft.kind}
              onChange={(e) =>
                setDraft({ ...draft, kind: e.target.value as ModelProvider['kind'] })
              }
            >
              <option value="openai-compatible">OpenAI 兼容（/v1/chat/completions）</option>
              <option value="anthropic-compatible">Anthropic 兼容（/v1/messages）</option>
            </select>
          </label>
          <label>
            Base URL
            <input
              value={draft.baseUrl}
              placeholder="https://api.example.com/v1 或 http://127.0.0.1:11434/v1"
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            />
          </label>
          <div className="grid2">
            <label>
              API Key（留空表示不改动已保存密钥）
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </label>
            <label>
              默认模型（保存后设为内核默认）
              <input
                value={draft.defaultModel ?? ''}
                placeholder="gpt-4o-mini"
                onChange={(e) => setDraft({ ...draft, defaultModel: e.target.value })}
              />
            </label>
          </div>
          <label>
            模型清单（每行一个）
            <textarea rows={4} value={modelsText} onChange={(e) => setModelsText(e.target.value)} />
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={Boolean(draft.local)}
              onChange={(e) => setDraft({ ...draft, local: e.target.checked })}
            />
            本地推理端点（Ollama / LM Studio / vLLM）
          </label>
          <div className="row">
            <button className="primary" onClick={() => void save()}>
              保存
            </button>
            <button disabled={testing} onClick={() => void test()}>
              {testing ? '测试中…' : '测试连接'}
            </button>
          </div>
          {message ? <p className="status">{message}</p> : null}
        </div>
      </div>
    </section>
  )
}
