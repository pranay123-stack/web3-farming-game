'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { WalletConnect } from '@/components/WalletConnect'
import { useWallet } from '@/hooks/useWallet'
import { getReadContract, hasDeployment } from '@/lib/contracts'
import { TARGET_CHAIN, TARGET_CHAIN_ID, explorerAddressUrl, getDeployment } from '@/lib/chains'
import { formatToken } from '@/lib/format'

/**
 * Landing page.
 *
 * The statistics are read live from the contracts. The previous version
 * displayed "10,234 Active Farmers" and "$2.5M Total Volume" as static text -
 * invented numbers for a game nobody had played.
 */
export default function Home() {
  const { isConnected } = useWallet()

  return (
    <main className="min-h-[100dvh]">
      <header
        className="sticky top-0 z-40 border-b bg-soil-950/85 backdrop-blur"
        style={{ borderColor: 'var(--soil-700)' }}
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl" aria-hidden>🌾</span>
            <span className="font-display text-base font-semibold text-leaf-400">Farmstead</span>
            <span className="chip ml-1 hidden border-soil-600 text-text-muted sm:inline-flex">
              {TARGET_CHAIN.name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/game" className="btn-primary text-sm">
              {isConnected ? 'Enter farm' : 'Play'}
            </Link>
            <div className="hidden sm:block">
              <WalletConnect compact />
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-4 pb-16 pt-14 text-center sm:pt-20">
        <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">
          Plant it, grow it,
          <span className="text-leaf-400"> actually own it.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-text-secondary">
          A farming game where the land is yours, the crops are yours, and the
          money is real tokens on a public chain. No account, no server holding
          your things — just your wallet.
        </p>

        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/game" className="btn-primary px-6 py-3 text-base">
            Start farming
          </Link>
          <a
            href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary px-6 py-3 text-base"
          >
            Get free test ETH ↗
          </a>
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Runs on {TARGET_CHAIN.name}. Test tokens only — nothing here costs real money.
        </p>
      </section>

      <LiveStats />

      <section className="mx-auto max-w-5xl px-4 py-14">
        <h2 className="text-center font-display text-2xl font-semibold">The loop</h2>
        <p className="mx-auto mt-2 max-w-lg text-center text-sm text-text-secondary">
          Every step is a transaction your wallet signs, settled by a contract
          you can read.
        </p>

        <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <LoopStep n={1} icon="🎁" title="Claim" body="One free plot of land and enough Farm Gold to plant your first seed." />
          <LoopStep n={2} icon="🌱" title="Plant" body="Buy a seed, put it in the ground. Your plot locks while the crop grows." />
          <LoopStep n={3} icon="⏳" title="Wait" body="Growth is measured in real time by the chain's own clock. No skipping it." />
          <LoopStep n={4} icon="🌾" title="Harvest" body="Collect Farm Gold plus the crop itself, minted to you as an NFT." />
          <LoopStep n={5} icon="🔨" title="Craft & trade" body="Turn crops into tools, or sell them to another player for gold." />
          <LoopStep n={6} icon="⭐" title="Upgrade" body="Level up your plots and your farmer to unlock the better crops." />
        </ol>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-16">
        <div className="panel p-6">
          <h2 className="font-display text-xl font-semibold">What actually lives on-chain</h2>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            Ownership and economy are settled by contracts. The game server only
            carries where other players are standing and what they said in chat —
            it cannot touch anything you own.
          </p>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2">
            <OnChainItem term="FGOLD" detail="ERC-20 currency. Minted only by harvests and the starter pack; burned when you spend it." />
            <OnChainItem term="Land" detail="ERC-721 plots with coordinates, fertility and an upgrade level. Capped at 1000." />
            <OnChainItem term="Items & crops" detail="ERC-721 seeds, tools and harvested crops, each with its stats stored on-chain." />
            <OnChainItem term="Marketplace" detail="Escrowed peer-to-peer trades settled in FGOLD, with a fixed protocol fee." />
          </dl>
          <ContractLinks />
        </div>
      </section>

      <footer
        className="border-t py-6 text-center text-xs text-text-muted"
        style={{ borderColor: 'var(--soil-700)' }}
      >
        Open source · MIT · Built on {TARGET_CHAIN.name}
      </footer>
    </main>
  )
}

/**
 * Real numbers from the chain, or nothing.
 *
 * If the read fails the section hides itself rather than showing placeholders.
 */
function LiveStats() {
  const [stats, setStats] = useState<{
    landMinted: number
    landSupply: number
    fgoldSupply: bigint
    activeListings: number
  } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!hasDeployment(TARGET_CHAIN_ID)) {
      setFailed(true)
      return
    }
    let cancelled = false

    ;(async () => {
      try {
        const land = getReadContract('FarmLand', TARGET_CHAIN_ID)
        const token = getReadContract('FarmToken', TARGET_CHAIN_ID)
        const market = getReadContract('Marketplace', TARGET_CHAIN_ID)

        const [minted, supply, fgoldSupply, listings] = await Promise.all([
          land.getCurrentSupply(),
          land.MAX_SUPPLY(),
          token.totalSupply(),
          market.activeListingCount(),
        ])

        if (cancelled) return
        setStats({
          landMinted: Number(minted),
          landSupply: Number(supply),
          fgoldSupply,
          activeListings: Number(listings),
        })
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()

    return () => { cancelled = true }
  }, [])

  if (failed) return null

  return (
    <section
      className="border-y bg-soil-900/50 py-8"
      style={{ borderColor: 'var(--soil-700)' }}
      aria-label="Live game statistics"
    >
      <div className="mx-auto grid max-w-3xl grid-cols-2 gap-6 px-4 sm:grid-cols-4">
        <Stat
          value={stats ? `${stats.landMinted}` : null}
          sub={stats ? `of ${stats.landSupply} plots` : 'plots claimed'}
        />
        <Stat
          value={stats ? formatToken(stats.fgoldSupply, 0) : null}
          sub="FGOLD in circulation"
        />
        <Stat
          value={stats ? `${stats.activeListings}` : null}
          sub="items for sale"
        />
        <Stat value="1000" sub="total land, ever" />
      </div>
      <p className="mt-4 text-center text-[11px] text-text-muted">
        Read live from the contracts on {TARGET_CHAIN.name}.
      </p>
    </section>
  )
}

function Stat({ value, sub }: { value: string | null; sub: string }) {
  return (
    <div className="text-center">
      <div className="font-display text-2xl font-semibold text-leaf-400 tabular">
        {value ?? <span className="text-text-muted">—</span>}
      </div>
      <div className="mt-0.5 text-xs text-text-muted">{sub}</div>
    </div>
  )
}

function LoopStep({ n, icon, title, body }: {
  n: number; icon: string; title: string; body: string
}) {
  return (
    <li className="panel p-4">
      <div className="flex items-center gap-2">
        <span className="text-lg" aria-hidden>{icon}</span>
        <span className="text-xs text-text-muted tabular">Step {n}</span>
      </div>
      <h3 className="mt-2 text-sm font-semibold text-leaf-400">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-text-secondary">{body}</p>
    </li>
  )
}

function OnChainItem({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="rounded-lg bg-soil-900 p-3">
      <dt className="text-sm font-medium text-leaf-400">{term}</dt>
      <dd className="mt-0.5 text-xs leading-relaxed text-text-secondary">{detail}</dd>
    </div>
  )
}

function ContractLinks() {
  const deployment = getDeployment(TARGET_CHAIN_ID)
  if (!deployment) return null

  return (
    <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--soil-700)' }}>
      <p className="heading mb-2">Deployed contracts</p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {Object.entries(deployment.contracts).map(([name, address]) => {
          const url = explorerAddressUrl(address, TARGET_CHAIN_ID)
          return (
            <li key={name} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-text-secondary">{name}</span>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate font-mono text-[11px] text-sky-500 hover:underline"
                >
                  {address.slice(0, 8)}…{address.slice(-6)}
                </a>
              ) : (
                <code className="truncate font-mono text-[11px] text-text-muted">
                  {address.slice(0, 8)}…{address.slice(-6)}
                </code>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
