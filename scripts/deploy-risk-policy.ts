/**
 * Deploy ActuraRiskPolicy.sol to Base Sepolia
 * Usage: npx tsx scripts/deploy-risk-policy.ts
 */
import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const RPC = process.env.RPC_URL || 'https://sepolia.base.org';
const PK = process.env.PRIVATE_KEY;
if (!PK) { console.error('PRIVATE_KEY not set'); process.exit(1); }

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PK, provider);

// Read compiled artifacts
const abiPath = resolve(import.meta.dirname!, '../build/contracts_ActuraRiskPolicy_sol_ActuraRiskPolicy.abi');
const binPath = resolve(import.meta.dirname!, '../build/contracts_ActuraRiskPolicy_sol_ActuraRiskPolicy.bin');
const abi = JSON.parse(readFileSync(abiPath, 'utf-8'));
const bytecode = '0x' + readFileSync(binPath, 'utf-8').trim();

// Constructor params matching Actura's config
const AGENT_WALLET = wallet.address; // Same wallet is the agent
const INITIAL_CAPITAL = ethers.parseUnits('10000', 6); // $10,000 in 6-decimal USD
const MAX_POSITION_PCT = 1000n;       // 10% in basis points
const MAX_EXPOSURE_PCT = 3000n;       // 30%
const MAX_OPEN_POSITIONS = 5n;
const MAX_DAILY_LOSS_PCT = 200n;      // 2%
const MAX_DRAWDOWN_PCT = 800n;        // 8%
const MIN_TRADE_COOLDOWN = 60n;       // 60 seconds

// WETH on Base Sepolia
const WETH_BASE_SEPOLIA = '0x4200000000000000000000000000000000000006';

async function main() {
  console.log('Deploying ActuraRiskPolicy to Base Sepolia...');
  console.log(`  Deployer: ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`  Balance:  ${ethers.formatEther(balance)} ETH`);

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(
    AGENT_WALLET,
    INITIAL_CAPITAL,
    MAX_POSITION_PCT,
    MAX_EXPOSURE_PCT,
    MAX_OPEN_POSITIONS,
    MAX_DAILY_LOSS_PCT,
    MAX_DRAWDOWN_PCT,
    MIN_TRADE_COOLDOWN,
    [WETH_BASE_SEPOLIA],
  );

  console.log(`  Tx hash:  ${contract.deploymentTransaction()?.hash}`);
  console.log('  Waiting for confirmation...');
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`\n✅ ActuraRiskPolicy deployed at: ${address}`);
  console.log(`   Block explorer: https://sepolia.basescan.org/address/${address}`);

  // Verify by calling getRiskState
  const riskPolicy = new ethers.Contract(address, abi, provider);
  const state = await riskPolicy.getRiskState();
  console.log('\n  On-chain risk state:');
  console.log(`    Capital:    $${ethers.formatUnits(state[0], 6)}`);
  console.log(`    Peak:       $${ethers.formatUnits(state[1], 6)}`);
  console.log(`    DailyPnl:   ${state[2].toString()}`);
  console.log(`    Positions:  ${state[3].toString()}`);
  console.log(`    Exposure:   ${state[4].toString()}`);
  console.log(`    CB Active:  ${state[5]}`);
  console.log(`    Drawdown:   ${state[6].toString()} bps`);
}

main().catch((err) => { console.error(err); process.exit(1); });
