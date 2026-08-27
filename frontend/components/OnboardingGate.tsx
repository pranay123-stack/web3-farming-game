'use client'

import { useState } from 'react'
import { useWallet } from '@/hooks/useWallet'
import { useGameState } from '@/providers/GameStateProvider'
import { useGameActions } from '@/hooks/useGameActions'
import { WalletConnect } from './WalletConnect'
import { formatToken, formatEth } from '@/lib/format'
import { TARGET_CHAIN } from '@/lib/chains'

/**
 * Everything standing between a new visitor and the core loop.
 *
 * Each state has exactly one thing to do next, and says why. A first-time
 * player should never have to guess what "approve" means or where their first
 * seed comes from.
 */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { isConnected, isWrongNetwork, hasWallet, isDetecting, status, nativeBalance, switchNetwork } = useWallet()
  const { profile, lands, playerState, hasDeployment, catalogState } = useGameState()
  const { claimStarterPack } = useGameActions()
  const [claiming, setClaiming] = useState(false)
  const [switching, setSwitching] = useState(false)

  // --- the app itself is misconfigured -------------------------------------
  if (!hasDeployment) {
    return (
      <Gate
        icon="🛠"
        title="No deployment configured"
        body={`No contract addresses are recorded for ${TARGET_CHAIN.name}. Deploy the contracts and run "npm run export:abi", then rebuild the frontend.`}
      />
    )
  }

  // --- still detecting -----------------------------------------------------
  if (isDetecting || hasWallet === null) {
    return <Gate icon="🌾" title="Looking for your wallet" body="One moment…" />
  }

  // --- no wallet -----------------------------------------------------------
  if (!hasWallet && status !== 'connecting') {
    return (
      <Gate
        icon="🦊"
        title="You need an Ethereum wallet"
        body="This game keeps your farm, crops and money as tokens you own. That needs a browser wallet - MetaMask is the usual choice, and it is free."
        action={
          <a
            href="https://metamask.io/download/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
          >
            Get MetaMask ↗
          </a>
        }
      />
    )
  }

  // --- not connected -------------------------------------------------------
  if (!isConnected) {
    return (
      <Gate
        icon="🌾"
        title="Connect to start farming"
        body={`Your farm lives on ${TARGET_CHAIN.name}, a free test network. Connecting costs nothing and signs nothing.`}
        action={<WalletConnect />}
      />
    )
  }

  // --- wrong chain ---------------------------------------------------------
  if (isWrongNetwork) {
    return (
      <Gate
        icon="🔀"
        title={`Switch to ${TARGET_CHAIN.name}`}
        body={`The game's contracts are deployed on ${TARGET_CHAIN.name}. Your wallet is pointed somewhere else, so nothing you do here would reach them.`}
        action={
          <button
            className="btn-gold"
            disabled={switching}
            onClick={async () => {
              setSwitching(true)
              await switchNetwork()
              setSwitching(false)
            }}
          >
            {switching ? 'Switching…' : `Switch to ${TARGET_CHAIN.shortName}`}
          </button>
        }
      />
    )
  }

  // --- still loading -------------------------------------------------------
  if (playerState === 'loading' && !profile) {
    return (
      <Gate icon="⏳" title="Reading your farm" body="Fetching your land and balance from the chain…" />
    )
  }

  if (catalogState === 'error') {
    return (
      <Gate
        icon="⚠️"
        title="Cannot reach the chain"
        body="The game content could not be read. This is usually a temporary RPC problem."
        action={
          <button className="btn-secondary" onClick={() => window.location.reload()}>
            Retry
          </button>
        }
      />
    )
  }

  // --- needs the starter pack ----------------------------------------------
  const needsStarterPack = profile !== null && !profile.hasClaimedStarterPack && lands.length === 0
  const hasNoGas = nativeBalance !== null && nativeBalance === 0n

  if (needsStarterPack) {
    return (
      <Gate
        icon="🎁"
        title="Claim your starter pack"
        body="One transaction gives you your first plot of land and some Farm Gold to buy seeds with. It is free, once per wallet."
        action={
          <div className="flex flex-col items-center gap-2">
            {hasNoGas && (
              <p className="max-w-[34ch] text-xs leading-relaxed text-gold-400">
                Your wallet has no {TARGET_CHAIN.nativeCurrency.symbol} for gas. Grab some
                from a {TARGET_CHAIN.name} faucet first — it takes a minute and costs nothing.
              </p>
            )}
            <button
              className="btn-primary"
              disabled={claiming}
              onClick={async () => {
                setClaiming(true)
                await claimStarterPack()
                setClaiming(false)
              }}
            >
              {claiming ? 'Claiming…' : 'Claim starter pack'}
            </button>
            {hasNoGas && (
              <a
                href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-sky-500 hover:underline"
              >
                Open a Sepolia faucet ↗
              </a>
            )}
            <p className="text-[11px] text-text-muted tabular">
              Gas balance: {formatEth(nativeBalance, 4)} {TARGET_CHAIN.nativeCurrency.symbol}
            </p>
          </div>
        }
      />
    )
  }

  // --- claimed, but owns nothing (sold their land) -------------------------
  if (profile?.hasClaimedStarterPack && lands.length === 0) {
    return (
      <Gate
        icon="🏞️"
        title="You have no land"
        body="You have already claimed your starter pack, so you will need to buy a plot to farm again. Plots are on sale in the shop and on the marketplace."
        action={<BuyLandButton />}
      />
    )
  }

  return <>{children}</>
}

function BuyLandButton() {
  const { mintLand } = useGameActions()
  const { catalog } = useGameState()
  const [busy, setBusy] = useState(false)

  return (
    <button
      className="btn-primary"
      disabled={busy || !catalog}
      onClick={async () => {
        setBusy(true)
        await mintLand()
        setBusy(false)
      }}
    >
      {busy ? 'Buying…'
        : catalog ? `Buy a plot · ${formatEth(catalog.landMintPrice)} ETH`
        : 'Buy a plot'}
    </button>
  )
}

function Gate({ icon, title, body, action }: {
  icon: string
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="panel max-w-md p-8 text-center">
        <span className="text-4xl" aria-hidden>{icon}</span>
        <h2 className="mt-4 font-display text-xl font-semibold">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">{body}</p>
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </div>
  )
}

export default OnboardingGate
