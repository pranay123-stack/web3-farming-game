// Contract addresses - Deployed to Sepolia testnet
export const CONTRACT_ADDRESSES = {
  // Main game contract (GameManager)
  GAME_CONTRACT: '0xaA85d4c08296c6C80f0AEbd0044A0aD5C1C7c5c5',
  // FARM token (ERC20) - FarmToken (FGOLD)
  FARM_TOKEN: '0x45bCa7f82B0D15Bd927c6cc92B9478E25a2fDdc1',
  // Crop NFT (ERC721) - FarmNFT (FITEM)
  CROP_NFT: '0xdF980a7074fdEe748e803ecA46d896e55486004f',
  // Land NFT (ERC721) - FarmLand (FLAND)
  ITEM_NFT: '0x9e9f9407832dD5bcCe8e52f42d4b4D8f123cF642',
  // Marketplace
  MARKETPLACE: '0x72FE19AF0A651a1dffaFf569BC0f2c9be031B8F2',
} as const

// Network configuration
export const NETWORK_CONFIG = {
  chainId: 11155111, // Sepolia testnet
  chainName: 'Sepolia',
  rpcUrl: 'https://rpc.sepolia.org', // Free public RPC
  blockExplorer: 'https://sepolia.etherscan.io',
  nativeCurrency: {
    name: 'SepoliaETH',
    symbol: 'ETH',
    decimals: 18,
  },
}

// Game Contract ABI
export const GAME_CONTRACT_ABI = [
  // Events
  'event CropPlanted(address indexed player, uint256 indexed plotId, uint256 seedType, uint256 plantedAt)',
  'event CropHarvested(address indexed player, uint256 indexed plotId, uint256 cropId, uint256 yield)',
  'event ItemCrafted(address indexed player, uint256 indexed recipeId, uint256 itemId)',
  'event PlayerJoined(address indexed player, uint256 startX, uint256 startY)',

  // Read functions
  'function getPlot(uint256 plotId) view returns (address owner, uint256 seedType, uint256 plantedAt, uint256 waterLevel, bool isReady)',
  'function getPlayerPosition(address player) view returns (uint256 x, uint256 y)',
  'function getPlayerStats(address player) view returns (uint256 level, uint256 experience, uint256 totalHarvests)',
  'function getCropGrowthTime(uint256 seedType) view returns (uint256)',
  'function getRecipe(uint256 recipeId) view returns (uint256[] memory inputItems, uint256[] memory inputAmounts, uint256 outputItem)',

  // Write functions
  'function plantCrop(uint256 plotId, uint256 seedType) external',
  'function waterCrop(uint256 plotId) external',
  'function harvestCrop(uint256 plotId) external',
  'function craftItem(uint256 recipeId) external',
  'function movePlayer(uint256 newX, uint256 newY) external',
  'function joinGame() external',
]

// FARM Token ABI (ERC20)
export const FARM_TOKEN_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
]

// Crop NFT ABI (ERC721)
export const CROP_NFT_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getApproved(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function approve(address to, uint256 tokenId) external',
  'function setApprovalForAll(address operator, bool approved) external',
  'function transferFrom(address from, address to, uint256 tokenId) external',
  'function safeTransferFrom(address from, address to, uint256 tokenId) external',
  'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data) external',
  'function getCropData(uint256 tokenId) view returns (uint256 cropType, uint256 quality, uint256 harvestedAt)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)',
]

// Item NFT ABI (ERC1155)
export const ITEM_NFT_ABI = [
  'function uri(uint256 id) view returns (string)',
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
  'function isApprovedForAll(address account, address operator) view returns (bool)',
  'function setApprovalForAll(address operator, bool approved) external',
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data) external',
  'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data) external',
  'function getItemData(uint256 itemId) view returns (string name, string description, uint256 rarity)',
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
  'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)',
]

// Seed types
export const SEED_TYPES = {
  WHEAT: 1,
  CORN: 2,
  TOMATO: 3,
  CARROT: 4,
  POTATO: 5,
  PUMPKIN: 6,
  MAGIC_BEAN: 7,
  GOLDEN_APPLE: 8,
} as const

export const SEED_INFO: Record<number, { name: string; growthTime: number; emoji: string; rarity: string }> = {
  [SEED_TYPES.WHEAT]: { name: 'Wheat', growthTime: 60, emoji: '🌾', rarity: 'common' },
  [SEED_TYPES.CORN]: { name: 'Corn', growthTime: 120, emoji: '🌽', rarity: 'common' },
  [SEED_TYPES.TOMATO]: { name: 'Tomato', growthTime: 180, emoji: '🍅', rarity: 'uncommon' },
  [SEED_TYPES.CARROT]: { name: 'Carrot', growthTime: 90, emoji: '🥕', rarity: 'common' },
  [SEED_TYPES.POTATO]: { name: 'Potato', growthTime: 150, emoji: '🥔', rarity: 'common' },
  [SEED_TYPES.PUMPKIN]: { name: 'Pumpkin', growthTime: 300, emoji: '🎃', rarity: 'rare' },
  [SEED_TYPES.MAGIC_BEAN]: { name: 'Magic Bean', growthTime: 600, emoji: '✨', rarity: 'epic' },
  [SEED_TYPES.GOLDEN_APPLE]: { name: 'Golden Apple', growthTime: 1200, emoji: '🍎', rarity: 'legendary' },
}

// Crafting recipes
export const RECIPES = {
  BASIC_FERTILIZER: 1,
  WATER_CAN: 2,
  SCARECROW: 3,
  SEED_BAG: 4,
} as const

export const RECIPE_INFO: Record<number, { name: string; description: string; emoji: string }> = {
  [RECIPES.BASIC_FERTILIZER]: { name: 'Basic Fertilizer', description: 'Speeds up crop growth by 20%', emoji: '🧪' },
  [RECIPES.WATER_CAN]: { name: 'Watering Can', description: 'Water your crops more efficiently', emoji: '🪣' },
  [RECIPES.SCARECROW]: { name: 'Scarecrow', description: 'Protects crops from pests', emoji: '🧸' },
  [RECIPES.SEED_BAG]: { name: 'Seed Bag', description: 'Store more seeds', emoji: '👝' },
}
