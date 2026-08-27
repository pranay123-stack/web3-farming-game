'use client'

import { useEffect, useRef, useState } from 'react'
import { useMultiplayerState } from '@/hooks/useMultiplayer'
import { shortAddress } from '@/lib/format'
import { LIMITS } from '@/shared/protocol'

/**
 * Multiplayer chat.
 *
 * Real messages over a real socket. The previous version faked replies with a
 * setTimeout, so the "other players" were the client talking to itself.
 *
 * Message content is rendered as text via React's default escaping and never
 * with dangerouslySetInnerHTML; the server sanitises on the way in as well.
 */
export function Chat() {
  const { messages, sendChat, status, isConnected, self, error } = useMultiplayerState()
  const [draft, setDraft] = useState('')
  const [scope, setScope] = useState<'global' | 'nearby'>('global')
  const [sendError, setSendError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedToBottom = useRef(true)

  // Follow new messages only while the player is already at the bottom, so
  // reading back through history is not yanked away.
  useEffect(() => {
    const element = scrollRef.current
    if (!element || !pinnedToBottom.current) return
    element.scrollTop = element.scrollHeight
  }, [messages])

  const handleScroll = () => {
    const element = scrollRef.current
    if (!element) return
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight
    pinnedToBottom.current = distanceFromBottom < 40
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const content = draft.trim()
    if (!content || sending) return

    setSending(true)
    setSendError(null)
    const result = await sendChat(content, scope)
    setSending(false)

    if (result.ok) {
      setDraft('')
    } else {
      setSendError(result.message)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="heading">Chat</h2>
        <div className="flex gap-1">
          {(['global', 'nearby'] as const).map((option) => (
            <button
              key={option}
              onClick={() => setScope(option)}
              className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                scope === option
                  ? 'bg-leaf-500 text-soil-950'
                  : 'bg-soil-800 text-text-secondary hover:text-text-primary'
              }`}
            >
              {option === 'global' ? 'Global' : 'Nearby'}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="scrollbar-thin flex-1 space-y-1.5 overflow-y-auto px-3 pb-2"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {messages.length === 0 ? (
          <p className="py-6 text-center text-xs text-text-muted">
            {isConnected
              ? 'No messages yet. Say hello.'
              : status === 'reconnecting' || status === 'connecting'
                ? 'Connecting to the farm…'
                : 'Chat is offline.'}
          </p>
        ) : (
          messages.map((message) => {
            const isSelf = self && message.senderId === self.id
            const isSystem = message.scope === 'system'

            if (isSystem) {
              return (
                <p key={message.id} className="text-center text-[11px] italic text-text-muted">
                  {message.content}
                </p>
              )
            }

            return (
              <div key={message.id} className="text-xs leading-snug">
                <span
                  className={
                    isSelf ? 'font-medium text-leaf-400'
                    : message.scope === 'nearby' ? 'font-medium text-sky-500'
                    : 'font-medium text-text-secondary'
                  }
                  title={message.senderAddress ?? 'Guest'}
                >
                  {isSelf ? 'You' : message.senderName}
                  {message.scope === 'nearby' && (
                    <span className="ml-1 text-[10px] font-normal text-text-muted">nearby</span>
                  )}
                </span>
                <span className="mx-1 text-text-muted">·</span>
                <span className="break-words text-text-primary">{message.content}</span>
              </div>
            )
          })
        )}
      </div>

      {(error || sendError) && (
        <p className="px-3 pb-1 text-[11px] text-rose-500">{sendError ?? error}</p>
      )}

      <form onSubmit={submit} className="flex gap-1.5 px-3 pb-3">
        <input
          className="input text-xs"
          value={draft}
          maxLength={LIMITS.maxChatLength}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={isConnected ? `Message ${scope}…` : 'Connecting…'}
          disabled={!isConnected || sending}
          aria-label="Chat message"
        />
        <button
          type="submit"
          className="btn-secondary shrink-0 px-3 text-xs"
          disabled={!isConnected || sending || draft.trim().length === 0}
        >
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  )
}

export default Chat
