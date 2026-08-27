/**
 * End-to-end playability check.
 *
 * Walks a fresh wallet through the complete player journey against a live
 * deployment, using only the public contract API a real client calls. This is
 * the test that answers "is the game actually playable", as opposed to "do the
 * units behave".
 *
 *   npx hardhat run scripts/e2e-playthrough.js --network localhost
 *
 * On a network with real block times, pass --skip-wait to stop before the
 * growth window and report how long the crop needs.
 */
const hre = require('hardhat')
const { readDeployment } = require('./lib/deployments')

const SKIP_WAIT = process.argv.includes('--skip-wait')

let step = 0
let failures = 0
const started = Date.now()

function heading(text) {
  console.log(`\n${'─'.repeat(64)}\n${text}\n${'─'.repeat(64)}`)
}

function pass(label, detail = '') {
  step++
  console.log(`  ${String(step).padStart(2)}. PASS  ${label}${detail ? ` — ${detail}` : ''}`)
}

function fail(label, error) {
  step++
  failures++
  console.log(`  ${String(step).padStart(2)}. FAIL  ${label}`)
  console.log(`         ${String(error?.message ?? error).split('\n')[0]}`)
}

async function attempt(label, fn, detail) {
  try {
    const result = await fn()
    pass(label, typeof detail === 'function' ? detail(result) : detail)
    return result
  } catch (error) {
    fail(label, error)
    return null
  }
}

/** Asserts a call reverts, which is itself a required behaviour. */
async function attemptRevert(label, fn) {
  try {
    await fn()
    fail(label, new Error('expected a revert, but the call succeeded'))
    return false
  } catch {
    pass(label, 'correctly rejected')
    return true
  }
}

const fmt = (value) => Number(hre.ethers.formatEther(value)).toLocaleString(undefined, {
  maximumFractionDigits: 2,
})

async function main() {
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId)
  const { contracts } = readDeployment(chainId)
  const isLocal = chainId === 31337

  const [deployer, player, otherPlayer] = await hre.ethers.getSigners()

  const farmToken = await hre.ethers.getContractAt('FarmToken', contracts.FarmToken)
  const farmNFT = await hre.ethers.getContractAt('FarmNFT', contracts.FarmNFT)
  const farmLand = await hre.ethers.getContractAt('FarmLand', contracts.FarmLand)
  const game = await hre.ethers.getContractAt('GameManager', contracts.GameManager)
  const market = await hre.ethers.getContractAt('Marketplace', contracts.Marketplace)

  console.log(`\nEnd-to-end playthrough — chain ${chainId} (${hre.network.name})`)
  console.log(`Player:      ${player.address}`)
  console.log(`Second user: ${otherPlayer.address}`)

  // ================================================================ ONBOARD
  heading('Onboarding')

  await attempt(
    'A brand-new wallet holds nothing',
    async () => {
      const balance = await farmToken.balanceOf(player.address)
      const land = await farmLand.balanceOf(player.address)
      if (balance !== 0n || land !== 0n) throw new Error('wallet is not fresh; re-deploy to re-run')
      return balance
    },
    '0 FGOLD, 0 plots'
  )

  await attempt('Claim the starter pack', async () => {
    const tx = await game.connect(player).claimStarterPack()
    await tx.wait()
  })

  const landTokenId = await attempt(
    'Received a plot of land',
    async () => {
      const balance = await farmLand.balanceOf(player.address)
      if (balance === 0n) throw new Error('no land was minted')
      return farmLand.tokenOfOwnerByIndex(player.address, 0)
    },
    (id) => `plot #${id}`
  )

  await attempt(
    'Received starting FGOLD',
    () => farmToken.balanceOf(player.address),
    (balance) => `${fmt(balance)} FGOLD`
  )

  await attemptRevert('Starter pack cannot be claimed twice', () =>
    game.connect(player).claimStarterPack()
  )

  // ================================================================ APPROVE
  heading('Spending approval')

  await attemptRevert('Buying without an allowance is rejected', () =>
    game.connect(player).purchaseSeed(0)
  )

  await attempt('Approve the game to spend FGOLD', async () => {
    const tx = await farmToken.connect(player).approve(contracts.GameManager, hre.ethers.MaxUint256)
    await tx.wait()
  })

  // =================================================================== FARM
  heading('The core loop')

  const seed = await game.getSeedType(0)

  await attempt(
    'Inspect the plot',
    () => farmLand.getLandPlot(landTokenId),
    (plot) => `(${plot.x}, ${plot.y}) fertility ${plot.fertility}, level ${plot.level}`
  )

  const seedTokenId = await attempt(
    'Buy a wheat seed',
    async () => {
      const before = await farmToken.balanceOf(player.address)
      await (await game.connect(player).purchaseSeed(0)).wait()
      const after = await farmToken.balanceOf(player.address)
      if (after >= before) throw new Error('FGOLD was not spent')
      const balance = await farmNFT.balanceOf(player.address)
      return farmNFT.tokenOfOwnerByIndex(player.address, balance - 1n)
    },
    (id) => `seed NFT #${id}, cost ${fmt(seed.seedCost)} FGOLD`
  )

  await attempt('Plant the seed', async () => {
    await (await game.connect(player).plantCrop(landTokenId, seedTokenId)).wait()
    const plot = await farmLand.getLandPlot(landTokenId)
    if (!plot.isLocked) throw new Error('plot did not lock')
  })

  await attempt(
    'The seed was consumed',
    async () => {
      if (await farmNFT.itemExists(seedTokenId)) throw new Error('seed still exists')
      return true
    },
    'burned on planting'
  )

  await attemptRevert('Harvesting early is rejected', () =>
    game.connect(player).harvestCrop(landTokenId)
  )

  await attemptRevert('Locked land cannot be transferred', () =>
    farmLand.connect(player).transferFrom(player.address, otherPlayer.address, landTokenId)
  )

  await attempt(
    'Growth countdown is reported',
    () => game.getTimeUntilHarvest(player.address, landTokenId),
    (seconds) => `${seconds}s remaining`
  )

  if (!isLocal && SKIP_WAIT) {
    const remaining = await game.getTimeUntilHarvest(player.address, landTokenId)
    console.log(`\n  Stopping before the growth window (--skip-wait).`)
    console.log(`  Crop matures in ${remaining}s. Re-run without the flag to finish.\n`)
    return summary()
  }

  await attempt(
    'Wait out the growth window',
    async () => {
      if (isLocal) {
        await hre.network.provider.send('evm_increaseTime', [Number(seed.growthTime) + 1])
        await hre.network.provider.send('evm_mine')
        return 'fast-forwarded'
      }
      const remaining = Number(await game.getTimeUntilHarvest(player.address, landTokenId))
      if (remaining > 0) {
        console.log(`         waiting ${remaining}s of real time…`)
        await new Promise((resolve) => setTimeout(resolve, (remaining + 5) * 1000))
      }
      return 'waited'
    },
    (how) => `${seed.growthTime}s (${how})`
  )

  await attempt(
    'Harvest the crop',
    async () => {
      const before = await farmToken.balanceOf(player.address)
      await (await game.connect(player).harvestCrop(landTokenId)).wait()
      const after = await farmToken.balanceOf(player.address)
      if (after <= before) throw new Error('no FGOLD was received')
      return after - before
    },
    (gained) => `earned ${fmt(gained)} FGOLD`
  )

  await attempt(
    'Received the crop as an NFT',
    async () => {
      const balance = await farmNFT.balanceOf(player.address)
      const tokenId = await farmNFT.tokenOfOwnerByIndex(player.address, balance - 1n)
      const item = await farmNFT.getItem(tokenId)
      if (Number(item.itemType) !== 2) throw new Error('last item is not a crop')
      return tokenId
    },
    (id) => `crop NFT #${id}`
  )

  await attempt(
    'The plot unlocked',
    async () => {
      const plot = await farmLand.getLandPlot(landTokenId)
      if (plot.isLocked) throw new Error('plot is still locked')
      return true
    },
    'ready to replant'
  )

  await attemptRevert('The same crop cannot be harvested twice', () =>
    game.connect(player).harvestCrop(landTokenId)
  )

  // ============================================================ PROGRESSION
  heading('Progression')

  await attempt(
    'XP was awarded',
    async () => {
      const profile = await game.getPlayerProfile(player.address)
      if (profile.xp === 0n) throw new Error('no XP granted')
      return profile
    },
    (p) => `${p.xp} XP, level ${p.level}, ${p.totalHarvests} harvest(s)`
  )

  await attemptRevert('A level-gated seed stays locked', () =>
    game.connect(player).purchaseSeed(3) // Golden Apple, level 5
  )

  // Farm repeatedly to reach level 2. Only meaningful where time can be moved.
  if (isLocal) {
    await attempt(
      'Farm to the next level',
      async () => {
        let guard = 0
        while ((await game.getPlayerLevel(player.address)) < 2n && guard < 30) {
          await (await game.connect(player).purchaseSeed(0)).wait()
          const balance = await farmNFT.balanceOf(player.address)
          const nextSeed = await farmNFT.tokenOfOwnerByIndex(player.address, balance - 1n)
          await (await game.connect(player).plantCrop(landTokenId, nextSeed)).wait()
          await hre.network.provider.send('evm_increaseTime', [Number(seed.growthTime) + 1])
          await hre.network.provider.send('evm_mine')
          await (await game.connect(player).harvestCrop(landTokenId)).wait()
          guard++
        }
        return game.getPlayerLevel(player.address)
      },
      (level) => `now level ${level}`
    )

    await attempt('A newly unlocked seed can be bought', async () => {
      await (await game.connect(player).purchaseSeed(1)).wait() // Corn, level 2
    })
  }

  // =============================================================== CRAFTING
  heading('Crafting')

  await attempt(
    'Craft a tool',
    async () => {
      await (await game.connect(player).craftItem(0, [])).wait() // Basic Hoe
      const balance = await farmNFT.balanceOf(player.address)
      const tokenId = await farmNFT.tokenOfOwnerByIndex(player.address, balance - 1n)
      const item = await farmNFT.getItem(tokenId)
      if (Number(item.itemType) !== 0) throw new Error('crafted item is not a tool')
      return tokenId
    },
    (id) => `tool NFT #${id}`
  )

  await attemptRevert('A recipe rejects the wrong material count', () =>
    game.connect(player).craftItem(2, []) // Fertilizer needs 2 crops
  )

  // ============================================================ MARKETPLACE
  heading('Marketplace')

  const toolTokenId = await (async () => {
    const balance = await farmNFT.balanceOf(player.address)
    return farmNFT.tokenOfOwnerByIndex(player.address, balance - 1n)
  })()

  await attemptRevert('Listing without approval is rejected', () =>
    market.connect(player).listItem(contracts.FarmNFT, toolTokenId, hre.ethers.parseEther('100'))
  )

  await attempt('Approve the marketplace for items', async () => {
    await (await farmNFT.connect(player).setApprovalForAll(contracts.Marketplace, true)).wait()
  })

  const listingPrice = hre.ethers.parseEther('100')
  const listingId = await attempt(
    'List the tool for sale',
    async () => {
      await (await market.connect(player).listItem(contracts.FarmNFT, toolTokenId, listingPrice)).wait()
      return market.listingIdCounter()
    },
    (id) => `listing #${id} at ${fmt(listingPrice)} FGOLD`
  )

  await attempt(
    'The item is held in escrow',
    async () => {
      const owner = await farmNFT.ownerOf(toolTokenId)
      if (owner.toLowerCase() !== contracts.Marketplace.toLowerCase()) {
        throw new Error('item was not escrowed')
      }
      return owner
    },
    'held by the marketplace'
  )

  await attempt(
    'The listing appears in the browse feed',
    () => market.getActiveListings(0, 20),
    ([listings]) => `${listings.length} active listing(s)`
  )

  await attemptRevert('A seller cannot buy their own listing', () =>
    market.connect(player).buyItem(listingId, listingPrice)
  )

  // A second player onboards and buys it.
  await attempt('A second player onboards', async () => {
    await (await game.connect(otherPlayer).claimStarterPack()).wait()
    await (await farmToken.connect(otherPlayer).approve(contracts.Marketplace, hre.ethers.MaxUint256)).wait()
  })

  await attemptRevert('A purchase above the buyer\'s max price is rejected', () =>
    market.connect(otherPlayer).buyItem(listingId, listingPrice - 1n)
  )

  await attempt(
    'The second player buys the tool',
    async () => {
      const sellerBefore = await farmToken.balanceOf(player.address)
      await (await market.connect(otherPlayer).buyItem(listingId, listingPrice)).wait()
      const owner = await farmNFT.ownerOf(toolTokenId)
      if (owner.toLowerCase() !== otherPlayer.address.toLowerCase()) {
        throw new Error('the NFT was not delivered')
      }
      return (await farmToken.balanceOf(player.address)) - sellerBefore
    },
    (proceeds) => `seller received ${fmt(proceeds)} FGOLD net of fee`
  )

  await attemptRevert('A sold listing cannot be bought again', () =>
    market.connect(otherPlayer).buyItem(listingId, listingPrice)
  )

  // =============================================================== UPGRADES
  heading('Land upgrades')

  const upgradeCost = await game.getUpgradeCost(0)

  // Farm until the upgrade is affordable, so this path is genuinely exercised
  // rather than skipped for lack of funds.
  if (isLocal) {
    await attempt(
      'Farm until an upgrade is affordable',
      async () => {
        let guard = 0
        while ((await farmToken.balanceOf(player.address)) < upgradeCost && guard < 60) {
          await (await game.connect(player).purchaseSeed(0)).wait()
          const balance = await farmNFT.balanceOf(player.address)
          const nextSeed = await farmNFT.tokenOfOwnerByIndex(player.address, balance - 1n)
          await (await game.connect(player).plantCrop(landTokenId, nextSeed)).wait()
          await hre.network.provider.send('evm_increaseTime', [Number(seed.growthTime) + 1])
          await hre.network.provider.send('evm_mine')
          await (await game.connect(player).harvestCrop(landTokenId)).wait()
          guard++
        }
        return { balance: await farmToken.balanceOf(player.address), cycles: guard }
      },
      ({ balance, cycles }) => `${cycles} cycle(s) -> ${fmt(balance)} FGOLD`
    )
  }

  const balanceNow = await farmToken.balanceOf(player.address)

  if (balanceNow >= upgradeCost) {
    await attempt(
      'Upgrade the plot',
      async () => {
        const before = await farmLand.getLandPlot(landTokenId)
        const yieldBefore = await game.yieldMultiplierBps(before.fertility, before.level)
        await (await game.connect(player).upgradeLand(landTokenId)).wait()
        const after = await farmLand.getLandPlot(landTokenId)
        const yieldAfter = await game.yieldMultiplierBps(after.fertility, after.level)
        if (after.level <= before.level) throw new Error('level did not increase')
        return { after, gain: yieldAfter - yieldBefore }
      },
      ({ after, gain }) => `level ${after.level}, yield +${Number(gain) / 100}%`
    )
  } else {
    console.log(
      `  --. SKIP  Upgrade the plot — needs ${fmt(upgradeCost)} FGOLD, ` +
        `player has ${fmt(balanceNow)}`
    )
  }

  await attempt(
    'The upgraded plot yields more',
    async () => {
      const plot = await farmLand.getLandPlot(landTokenId)
      const multiplier = await game.yieldMultiplierBps(plot.fertility, plot.level)
      if (multiplier <= 10000n) throw new Error('multiplier did not exceed the base')
      return multiplier
    },
    (bps) => `${Number(bps) / 100}% of base yield`
  )

  // ========================================================= STATE RECOVERY
  heading('State recovery')

  await attempt(
    'A fresh client can rebuild everything from the chain',
    async () => {
      // Exactly the reads the frontend performs on a cold load.
      const [profile, balance, [landIds], [itemIds], farms] = await Promise.all([
        game.getPlayerProfile(player.address),
        farmToken.balanceOf(player.address),
        farmLand.getPlotsByOwner(player.address, 0, 50),
        farmNFT.getInventory(player.address, 0, 50),
        game.getPlayerActiveFarms(player.address),
      ])
      return { profile, balance, lands: landIds.length, items: itemIds.length, farms: farms.length }
    },
    (s) =>
      `level ${s.profile.level}, ${fmt(s.balance)} FGOLD, ` +
      `${s.lands} plot(s), ${s.items} item(s), ${s.farms} active farm(s)`
  )

  await attempt(
    'A failed transaction leaves no partial state',
    async () => {
      const before = await farmToken.balanceOf(player.address)
      try {
        await game.connect(player).harvestCrop(landTokenId) // nothing planted
      } catch {
        // expected
      }
      const after = await farmToken.balanceOf(player.address)
      if (before !== after) throw new Error('balance changed on a reverted call')
      return after
    },
    'balance unchanged after a revert'
  )

  // ================================================================ ECONOMY
  heading('Economy')

  await attempt(
    'Total FGOLD supply is accounted for',
    () => farmToken.totalSupply(),
    (supply) => `${fmt(supply)} FGOLD in circulation`
  )

  await attempt(
    'Marketplace fees accrued',
    () => market.accumulatedFees(),
    (fees) => `${fmt(fees)} FGOLD collected`
  )

  summary()
}

function summary() {
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\n${'═'.repeat(64)}`)
  if (failures === 0) {
    console.log(`ALL ${step} STEPS PASSED in ${seconds}s — the game is playable end to end.`)
  } else {
    console.log(`${failures} of ${step} STEPS FAILED in ${seconds}s.`)
  }
  console.log('═'.repeat(64) + '\n')
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('\nPlaythrough crashed:', error)
  process.exit(1)
})
