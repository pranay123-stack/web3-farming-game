'use client'

import { useState } from 'react'
import Link from 'next/link'
import WalletConnect from '@/components/WalletConnect'
import { useWallet } from '@/hooks/useWallet'

export default function Home() {
  const { address, isConnected, connect } = useWallet()
  const [isHovering, setIsHovering] = useState(false)

  return (
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-game-darker/80 backdrop-blur-md border-b border-game-border">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-game-primary rounded-lg flex items-center justify-center">
              <span className="text-2xl">🌾</span>
            </div>
            <h1 className="font-pixel text-game-primary text-sm md:text-base">
              GameFi Farm
            </h1>
          </div>
          <WalletConnect />
        </div>
      </header>

      {/* Hero Section */}
      <section className="flex-1 flex flex-col items-center justify-center px-4 pt-20">
        <div className="text-center max-w-4xl mx-auto">
          {/* Animated Logo */}
          <div className="mb-8 relative">
            <div className="w-32 h-32 mx-auto bg-game-dark rounded-2xl border-4 border-game-primary glow flex items-center justify-center animate-bounce-slow">
              <span className="text-7xl">🌱</span>
            </div>
            <div className="absolute -top-2 -right-2 w-8 h-8 bg-game-accent rounded-full animate-ping opacity-75" />
          </div>

          {/* Title */}
          <h2 className="font-pixel text-3xl md:text-5xl text-white mb-4 leading-relaxed">
            <span className="text-game-primary">FARM</span> TO{' '}
            <span className="text-game-accent">EARN</span>
          </h2>

          {/* Subtitle */}
          <p className="text-slate-400 text-lg md:text-xl mb-8 max-w-2xl mx-auto">
            Plant seeds, grow crops, and harvest rewards in this blockchain-powered farming adventure.
            Own your farm as NFTs and trade with players worldwide.
          </p>

          {/* Feature Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
            <FeatureCard
              icon="🌾"
              title="Grow Crops"
              description="Plant and nurture unique crops that become tradeable NFTs"
            />
            <FeatureCard
              icon="💎"
              title="Earn Tokens"
              description="Harvest crops to earn FARM tokens and rare items"
            />
            <FeatureCard
              icon="🤝"
              title="Trade & Play"
              description="Join a community of farmers and trade on the marketplace"
            />
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link
              href="/game"
              className="btn-game text-lg px-8 py-4 flex items-center gap-2"
              onMouseEnter={() => setIsHovering(true)}
              onMouseLeave={() => setIsHovering(false)}
            >
              <span className={`transition-transform ${isHovering ? 'scale-125' : ''}`}>
                🎮
              </span>
              Play Now
            </Link>

            {!isConnected && (
              <button
                onClick={connect}
                className="btn-secondary text-lg px-8 py-4 flex items-center gap-2"
              >
                <span>🦊</span>
                Connect Wallet
              </button>
            )}
          </div>

          {/* Connection Status */}
          {isConnected && (
            <div className="mt-6 panel inline-block">
              <p className="text-sm text-slate-400">
                Connected: <span className="text-game-primary font-mono">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                </span>
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-12 border-t border-game-border">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard value="10,234" label="Active Farmers" />
            <StatCard value="1.2M" label="Crops Harvested" />
            <StatCard value="$2.5M" label="Total Volume" />
            <StatCard value="50+" label="Unique NFTs" />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 border-t border-game-border text-center">
        <p className="text-slate-500 text-sm">
          2024 GameFi Farming. Built on Ethereum.
        </p>
      </footer>
    </main>
  )
}

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="panel hover:border-game-primary transition-all group cursor-pointer">
      <div className="text-4xl mb-3 group-hover:scale-110 transition-transform">{icon}</div>
      <h3 className="font-pixel text-game-primary text-sm mb-2">{title}</h3>
      <p className="text-slate-400 text-sm">{description}</p>
    </div>
  )
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="font-pixel text-2xl md:text-3xl text-game-primary mb-1">{value}</div>
      <div className="text-slate-400 text-sm">{label}</div>
    </div>
  )
}
