'use client'

import { useMemo, useState } from 'react'
import { parseEther } from 'ethers'
import { useGameState } from '@/providers/GameStateProvider'
import { useGameActions } from '@/hooks/useGameActions'
import { useWallet } from '@/hooks/useWallet'
import {
  ITEM_TYPE_LABEL, ItemType, RARITY_COLOR, RARITY_LABEL, itemEmoji, itemName, type Rarity,
} from '@/lib/gameMeta'
import { formatToken, shortAddress } from '@/lib/format'
import { EmptyState, PanelSkeleton } from './FarmPanel'
import type { MarketListing } from '@/lib/state/gameTypes'

type Tab = 'browse' | 'mine' | 'sell'

/**
 * Peer-to-peer trading.
 *
 * Purchases pass the price the player was actually shown as `maxPrice`, so a
 * seller cannot reprice a listing out from under a pending buy.
 */
export function Marketplace() {
  const [tab, setTab] = useState<Tab>('browse')
  const { listings, marketState, refreshMarket } = useGameState()
  const { address } = useWallet()

  const mine = useMemo(
    () => listings.filter((l) => address && l.seller.toLowerCase() === address.toLowerCase()),
    [listings, address]
  )
  const others = useMemo(
    () => listings.filter((l) => !address || l.seller.toLowerCase() !== address.toLowerCase()),
    [listings, address]
  )

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'browse', label: 'Browse', count: others.length },
    { id: 'mine', label: 'My listings', count: mine.length },
    { id: 'sell', label: 'Sell' },
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="heading">Marketplace</h2>
        <button
          onClick={() => void refreshMarket()}
          className="btn-ghost px-2 py-1 text-xs"
          disabled={marketState === 'loading'}
        >
          {marketState === 'loading' ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="flex gap-1 px-3 pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
              tab === t.id
                ? 'bg-leaf-500 text-soil-950'
                : 'bg-soil-800 text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1 opacity-70 tabular">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-3">
        {tab === 'sell' ? (
          <SellForm />
        ) : marketState === 'loading' && listings.length === 0 ? (
          <PanelSkeleton rows={3} />
        ) : marketState === 'error' ? (
          <EmptyState
            icon="⚠️"
            title="Marketplace unavailable"
            body="Could not read listings from the chain. Try refreshing."
          />
        ) : (tab === 'browse' ? others : mine).length === 0 ? (
          <EmptyState
            icon="🏪"
            title={tab === 'browse' ? 'Nothing for sale' : 'You have no listings'}
            body={
              tab === 'browse'
                ? 'No one is selling right now. Check back, or list something yourself.'
                : 'Items you list will appear here until they sell.'
            }
          />
        ) : (
          <div className="space-y-2">
            {(tab === 'browse' ? others : mine).map((listing) => (
              <ListingCard
                key={listing.listingId.toString()}
                listing={listing}
                isMine={tab === 'mine'}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ListingCard({ listing, isMine }: { listing: MarketListing; isMine: boolean }) {
  const { buyItem, cancelListing, updateListingPrice, approveMarketSpend } = useGameActions()
  const { balances, catalog } = useGameState()
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [newPrice, setNewPrice] = useState('')

  const affordable = balances ? balances.fgold >= listing.price : false
  const needsApproval = balances ? balances.marketAllowance < listing.price : true

  const feeBps = catalog?.marketplaceFeeBps ?? 0
  const fee = (listing.price * BigInt(feeBps)) / 10000n
  const proceeds = listing.price - fee

  const label = listing.item
    ? itemName(listing.item.itemType, listing.item.seedTypeId)
    : listing.plot
      ? `Plot (${listing.plot.x}, ${listing.plot.y})`
      : `Token #${listing.tokenId.toString()}`

  const emoji = listing.item
    ? itemEmoji(listing.item.itemType, listing.item.seedTypeId)
    : listing.plot ? '🏞️' : '❓'

  const rarityColor = listing.item
    ? RARITY_COLOR[listing.item.rarity as Rarity]
    : 'var(--soil-600)'

  return (
    <div className="panel-flush p-2.5">
      <div className="flex items-start gap-2.5">
        <div className="slot h-10 w-10 shrink-0 text-lg" style={{ borderColor: rarityColor }} aria-hidden>
          {emoji}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium">{label}</p>
            <span className="shrink-0 text-sm text-gold-400 tabular">
              {formatToken(listing.price)}
            </span>
          </div>

          <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-text-muted">
            {listing.item && (
              <>
                <span style={{ color: rarityColor }}>
                  {RARITY_LABEL[listing.item.rarity as Rarity]}
                </span>
                <span>{ITEM_TYPE_LABEL[listing.item.itemType as ItemType]}</span>
              </>
            )}
            {listing.plot && (
              <span>Level {listing.plot.level} · Fertility {listing.plot.fertility}</span>
            )}
            {!isMine && <span>by {shortAddress(listing.seller)}</span>}
          </div>

          {isMine && (
            <p className="mt-0.5 text-[11px] text-text-secondary tabular">
              You receive {formatToken(proceeds)} after the {(feeBps / 100).toFixed(2)}% fee
            </p>
          )}
        </div>
      </div>

      {isMine ? (
        <div className="mt-2 space-y-2">
          {editing ? (
            <div className="flex gap-1.5">
              <input
                className="input text-xs"
                type="number"
                min="0"
                step="any"
                placeholder="New price"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
              />
              <button
                className="btn-secondary shrink-0 text-xs"
                disabled={busy || !newPrice}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const result = await updateListingPrice(listing.listingId, parseEther(newPrice))
                    if (result.ok) { setEditing(false); setNewPrice('') }
                  } catch {
                    // parseEther rejected the input; the field stays open.
                  }
                  setBusy(false)
                }}
              >
                Save
              </button>
              <button className="btn-ghost shrink-0 text-xs" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <button className="btn-secondary flex-1 text-xs" onClick={() => setEditing(true)}>
                Change price
              </button>
              <button
                className="btn-danger flex-1 text-xs"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  await cancelListing(listing.listingId)
                  setBusy(false)
                }}
              >
                {busy ? 'Cancelling…' : 'Delist'}
              </button>
            </div>
          )}
          {/* Explaining the price-raise delay so it does not look like a bug. */}
          {editing && (
            <p className="text-[11px] leading-snug text-text-muted">
              Raising a price takes effect next block, so it cannot surprise a
              buyer mid-purchase. Lowering it applies immediately.
            </p>
          )}
        </div>
      ) : needsApproval ? (
        <button
          className="btn-gold mt-2 w-full text-xs"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await approveMarketSpend()
            setBusy(false)
          }}
        >
          {busy ? 'Approving…' : 'Approve FGOLD to buy'}
        </button>
      ) : (
        <button
          className="btn-primary mt-2 w-full text-xs"
          disabled={busy || !affordable}
          onClick={async () => {
            setBusy(true)
            // maxPrice is the price shown, so a reprice cannot overcharge.
            await buyItem(listing.listingId, listing.price, listing.price)
            setBusy(false)
          }}
        >
          {busy ? 'Buying…' : !affordable ? 'Not enough FGOLD' : `Buy · ${formatToken(listing.price)}`}
        </button>
      )}
    </div>
  )
}

function SellForm() {
  const { inventory, lands, balances } = useGameState()
  const { listItem, approveNFTForMarket } = useGameActions()
  const [collection, setCollection] = useState<'item' | 'land'>('item')
  const [tokenId, setTokenId] = useState<bigint | null>(null)
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)

  const sellableLands = lands.filter((l) => !l.isLocked)
  const approved = collection === 'land'
    ? balances?.landApprovedForMarket
    : balances?.nftApprovedForMarket

  const priceValid = (() => {
    if (!price) return false
    try { return parseEther(price) > 0n } catch { return false }
  })()

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {(['item', 'land'] as const).map((option) => (
          <button
            key={option}
            onClick={() => { setCollection(option); setTokenId(null) }}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
              collection === option
                ? 'bg-soil-700 text-text-primary'
                : 'bg-soil-800 text-text-secondary hover:text-text-primary'
            }`}
          >
            {option === 'item' ? 'Items' : 'Land'}
          </button>
        ))}
      </div>

      {!approved && (
        <div className="rounded-lg border border-gold-500/40 bg-gold-500/10 p-2.5">
          <p className="text-xs font-medium text-gold-400">Approval needed</p>
          <p className="mt-0.5 text-[11px] leading-snug text-text-secondary">
            The marketplace holds your item in escrow while it is listed, so it
            needs transfer permission for this collection.
          </p>
          <button
            className="btn-gold mt-2 w-full text-xs"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await approveNFTForMarket(collection)
              setBusy(false)
            }}
          >
            {busy ? 'Approving…' : `Approve ${collection === 'land' ? 'land' : 'items'}`}
          </button>
        </div>
      )}

      <div>
        <p className="heading mb-1.5">Choose what to sell</p>
        {collection === 'item' ? (
          inventory.length === 0 ? (
            <p className="text-xs text-text-muted">Your inventory is empty.</p>
          ) : (
            <div className="grid grid-cols-6 gap-1.5">
              {inventory.slice(0, 30).map((item) => (
                <button
                  key={item.tokenId.toString()}
                  onClick={() => setTokenId(tokenId === item.tokenId ? null : item.tokenId)}
                  className={`slot-interactive text-sm ${tokenId === item.tokenId ? 'slot-selected' : ''}`}
                  title={itemName(item.itemType, item.seedTypeId)}
                  aria-pressed={tokenId === item.tokenId}
                >
                  <span aria-hidden>{itemEmoji(item.itemType, item.seedTypeId)}</span>
                </button>
              ))}
            </div>
          )
        ) : sellableLands.length === 0 ? (
          <p className="text-xs text-text-muted">
            You have no unlocked plots. Land with a crop growing on it cannot be sold.
          </p>
        ) : (
          <div className="grid grid-cols-6 gap-1.5">
            {sellableLands.map((plot) => (
              <button
                key={plot.tokenId.toString()}
                onClick={() => setTokenId(tokenId === plot.tokenId ? null : plot.tokenId)}
                className={`slot-interactive text-sm ${tokenId === plot.tokenId ? 'slot-selected' : ''}`}
                title={`Plot #${plot.tokenId.toString()} (${plot.x}, ${plot.y})`}
                aria-pressed={tokenId === plot.tokenId}
              >
                <span aria-hidden>🏞️</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="heading mb-1.5 block" htmlFor="listing-price">
          Price in FGOLD
        </label>
        <input
          id="listing-price"
          className="input"
          type="number"
          min="0"
          step="any"
          placeholder="e.g. 500"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </div>

      <button
        className="btn-primary w-full text-sm"
        disabled={busy || !approved || tokenId === null || !priceValid}
        onClick={async () => {
          if (tokenId === null) return
          setBusy(true)
          try {
            const result = await listItem(collection, tokenId, parseEther(price))
            if (result.ok) { setTokenId(null); setPrice('') }
          } catch {
            // Invalid price input; the form stays as it is.
          }
          setBusy(false)
        }}
      >
        {busy ? 'Listing…' : 'List for sale'}
      </button>
    </div>
  )
}

export default Marketplace
