'use client'

import { useState, useRef, useEffect } from 'react'

interface ChatMessage {
  id: string
  type: 'player' | 'system'
  username?: string
  content: string
  timestamp: Date
}

interface ChatProps {
  playerAddress: string
}

export default function Chat({ playerAddress }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      type: 'system',
      content: 'Welcome to GameFi Farming! Type /help for commands.',
      timestamp: new Date(),
    },
    {
      id: '2',
      type: 'player',
      username: 'Farmer_Joe',
      content: 'Hey everyone! Just harvested my first golden pumpkin!',
      timestamp: new Date(Date.now() - 60000),
    },
    {
      id: '3',
      type: 'player',
      username: 'CryptoGardener',
      content: 'Nice! I need 5 more wheat for the quest',
      timestamp: new Date(Date.now() - 30000),
    },
    {
      id: '4',
      type: 'system',
      content: 'New event: Double XP weekend starts in 2 hours!',
      timestamp: new Date(Date.now() - 15000),
    },
  ])
  const [inputValue, setInputValue] = useState('')
  const [isMinimized, setIsMinimized] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const formatAddress = (address: string) => {
    if (!address) return 'Anonymous'
    return `${address.slice(0, 4)}...${address.slice(-4)}`
  }

  const handleSend = () => {
    if (!inputValue.trim()) return

    // Handle commands
    if (inputValue.startsWith('/')) {
      handleCommand(inputValue)
      setInputValue('')
      return
    }

    // Add player message
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'player',
      username: formatAddress(playerAddress),
      content: inputValue,
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, newMessage])
    setInputValue('')

    // Simulate other player response (for demo)
    setTimeout(() => {
      const responses = [
        'Good luck with your farming!',
        'Anyone want to trade seeds?',
        'Just reached level 10!',
        'The market prices are crazy today',
      ]
      const randomResponse = responses[Math.floor(Math.random() * responses.length)]
      const botMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'player',
        username: `Farmer_${Math.floor(Math.random() * 1000)}`,
        content: randomResponse,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, botMessage])
    }, 2000 + Math.random() * 3000)
  }

  const handleCommand = (command: string) => {
    const cmd = command.toLowerCase().trim()
    let response = ''

    switch (cmd) {
      case '/help':
        response = 'Commands: /help, /stats, /online, /trade, /emote [name]'
        break
      case '/stats':
        response = 'Your stats: Level 5 | Harvests: 42 | FARM: 1000'
        break
      case '/online':
        response = 'Players online: 127 | In your area: 5'
        break
      case '/trade':
        response = 'Trade system coming soon! Stay tuned.'
        break
      default:
        if (cmd.startsWith('/emote ')) {
          const emote = cmd.replace('/emote ', '')
          response = `* ${formatAddress(playerAddress)} ${emote} *`
        } else {
          response = `Unknown command: ${cmd}. Type /help for available commands.`
        }
    }

    const systemMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'system',
      content: response,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, systemMessage])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (isMinimized) {
    return (
      <div className="h-8 bg-game-dark/90 border-t border-game-border flex items-center justify-between px-3">
        <span className="font-pixel text-game-primary text-xs">Chat</span>
        <button
          onClick={() => setIsMinimized(false)}
          className="text-slate-400 hover:text-white transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-game-dark/50">
      {/* Header */}
      <div className="p-2 border-b border-game-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-pixel text-game-primary text-xs">Chat</span>
          <span className="text-[10px] text-slate-500">Global</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-game-primary rounded-full animate-pulse" />
          <span className="text-[10px] text-slate-400">127 online</span>
          <button
            onClick={() => setIsMinimized(true)}
            className="ml-2 text-slate-400 hover:text-white transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`chat-message ${message.type}`}
          >
            {message.type === 'system' ? (
              <span className="text-game-accent italic text-xs">
                [{formatTime(message.timestamp)}] {message.content}
              </span>
            ) : (
              <span className="text-xs">
                <span className="text-slate-500">[{formatTime(message.timestamp)}]</span>
                {' '}
                <span className="text-game-primary font-bold">{message.username}:</span>
                {' '}
                <span className="text-slate-300">{message.content}</span>
              </span>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-2 border-t border-game-border">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 bg-game-darker border border-game-border rounded px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-game-primary transition"
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            className="btn-secondary px-2 py-1 text-xs disabled:opacity-50"
          >
            Send
          </button>
        </div>

        {/* Quick Emotes */}
        <div className="flex gap-1 mt-2">
          {['👋', '👍', '🎉', '❤️', '😂'].map((emote) => (
            <button
              key={emote}
              onClick={() => setInputValue(prev => prev + emote)}
              className="w-6 h-6 flex items-center justify-center hover:bg-game-border rounded transition text-sm"
            >
              {emote}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
