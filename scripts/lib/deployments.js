const fs = require("fs");
const path = require("path");

const DEPLOYMENTS_DIR = path.join(__dirname, "..", "..", "deployments");

function deploymentPath(chainId) {
  return path.join(DEPLOYMENTS_DIR, `${chainId}.json`);
}

function writeDeployment(chainId, manifest) {
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  const file = deploymentPath(chainId);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
  return path.relative(process.cwd(), file);
}

function readDeployment(chainId) {
  const file = deploymentPath(chainId);
  if (!fs.existsSync(file)) {
    throw new Error(
      `No deployment manifest for chain ${chainId}. Run: npx hardhat run scripts/deploy.js --network <name>`
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function listDeployments() {
  if (!fs.existsSync(DEPLOYMENTS_DIR)) return [];
  return fs
    .readdirSync(DEPLOYMENTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(DEPLOYMENTS_DIR, f), "utf8")));
}

module.exports = { writeDeployment, readDeployment, listDeployments, DEPLOYMENTS_DIR, deploymentPath };
