import { useEffect, useRef, useState, type JSX } from 'react'
import { api, type ChatMessage, type GatewayStatus } from '../api'

export default function Chat({ gateway }: { gateway: GatewayStatus | null }): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void api.chat.history().then(setMessages)
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async (): Promise<void> => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setSending(true)
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text, ts: Date.now(), sessionId: 'default' }
    ])
    try {
      const reply = await api.chat.send(text)
      setMessages((prev) => [...prev, reply])
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `调用失败：${(err as Error).message}`,
          ts: Date.now(),
          sessionId: 'default'
        }
      ])
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="view chat">
      <div className="view-head">
        <h1>对话</h1>
        <span className="tag">{gateway?.running ? `内核 ${gateway.baseUrl}` : '内核未启动'}</span>
      </div>
      <div className="messages">
        {messages.length === 0 ? (
          <p className="empty">还没有对话。先在「大模型」页配置一个 Provider，再启动内核。</p>
        ) : null}
        {messages.map((msg, index) => (
          <div key={index} className={msg.role === 'user' ? 'msg user' : 'msg bot'}>
            {msg.content}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="composer">
        <textarea
          rows={3}
          value={input}
          placeholder="输入消息，Ctrl+Enter 发送"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button className="primary" disabled={sending || !input.trim()} onClick={() => void send()}>
          {sending ? '发送中…' : '发送'}
        </button>
      </div>
    </section>
  )
}
