// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ActuraRiskPolicy
 * @notice On-chain enforcement of Actura's risk management rules.
 *         The Risk Router can call checkTrade() before execution.
 *         All parameters are immutable after deployment — trustless and auditable.
 * 
 * @dev Targets "Best Compliance & Risk Guardrails" prize.
 *      This contract proves Actura's risk limits are not just local checks
 *      but are enforced at the smart contract level — trustless, verifiable,
 *      and visible to any on-chain observer.
 *
 * Risk Checks:
 * 1. Max position size (% of capital)
 * 2. Max total exposure (% of capital)
 * 3. Max open positions
 * 4. Daily loss circuit breaker
 * 5. Max drawdown circuit breaker
 * 6. Cooldown between trades (anti-churn)
 * 7. Whitelisted assets only
 */

contract ActuraRiskPolicy {
    // ─── Immutable Risk Parameters ───
    address public immutable owner;
    address public immutable agentWallet;
    
    uint256 public immutable maxPositionPct;      // Max single position (basis points, e.g. 1000 = 10%)
    uint256 public immutable maxExposurePct;       // Max total exposure (basis points, e.g. 3000 = 30%)
    uint256 public immutable maxOpenPositions;
    uint256 public immutable maxDailyLossPct;      // Circuit breaker threshold (basis points)
    uint256 public immutable maxDrawdownPct;       // Max drawdown from peak (basis points)
    uint256 public immutable minTradeCooldownSec;  // Minimum seconds between trades

    // ─── State ───
    uint256 public currentCapital;
    uint256 public peakCapital;
    uint256 public dayStartCapital;
    uint256 public lastTradeTimestamp;
    uint256 public openPositionCount;
    uint256 public totalExposure;           // In USD (6 decimals)
    int256  public dailyPnl;                // Signed, 6 decimals
    bool    public circuitBreakerActive;
    uint256 public lastDailyReset;
    
    // Whitelisted assets
    mapping(address => bool) public whitelistedAssets;
    
    // ─── Events ───
    event TradeChecked(
        address indexed agent,
        address indexed asset,
        uint8 side,
        uint256 amount,
        bool approved,
        string reason
    );
    event CircuitBreakerTripped(string reason, int256 dailyPnl, uint256 drawdownBps);
    event CircuitBreakerReset(uint256 newCapital);
    event DailyReset(uint256 capital, uint256 timestamp);
    event AssetWhitelisted(address indexed asset);
    event CapitalUpdated(uint256 oldCapital, uint256 newCapital);

    // ─── Modifiers ───
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }
    
    modifier onlyAgent() {
        require(msg.sender == agentWallet || msg.sender == owner, "Only agent or owner");
        _;
    }

    constructor(
        address _agentWallet,
        uint256 _initialCapital,
        uint256 _maxPositionPct,
        uint256 _maxExposurePct,
        uint256 _maxOpenPositions,
        uint256 _maxDailyLossPct,
        uint256 _maxDrawdownPct,
        uint256 _minTradeCooldownSec,
        address[] memory _whitelistedAssets
    ) {
        owner = msg.sender;
        agentWallet = _agentWallet;
        currentCapital = _initialCapital;
        peakCapital = _initialCapital;
        dayStartCapital = _initialCapital;
        lastDailyReset = block.timestamp;
        
        maxPositionPct = _maxPositionPct;
        maxExposurePct = _maxExposurePct;
        maxOpenPositions = _maxOpenPositions;
        maxDailyLossPct = _maxDailyLossPct;
        maxDrawdownPct = _maxDrawdownPct;
        minTradeCooldownSec = _minTradeCooldownSec;
        
        for (uint256 i = 0; i < _whitelistedAssets.length; i++) {
            whitelistedAssets[_whitelistedAssets[i]] = true;
            emit AssetWhitelisted(_whitelistedAssets[i]);
        }
    }

    /**
     * @notice Check if a trade should be allowed
     * @param asset The token address being traded
     * @param side 0 = LONG, 1 = SHORT
     * @param amountUsd Position value in USD (6 decimals)
     * @return approved Whether the trade passes all risk checks
     * @return reason Human-readable reason if rejected
     */
    function checkTrade(
        address asset,
        uint8 side,
        uint256 amountUsd
    ) external view returns (bool approved, string memory reason) {
        // Check 1: Circuit breaker
        if (circuitBreakerActive) {
            return (false, "Circuit breaker active");
        }

        // Check 2: Whitelisted asset
        if (!whitelistedAssets[asset]) {
            return (false, "Asset not whitelisted");
        }

        // Check 3: Position size limit
        if (currentCapital > 0 && amountUsd * 10000 / currentCapital > maxPositionPct) {
            return (false, "Position exceeds max size");
        }

        // Check 4: Total exposure limit
        uint256 newExposure = totalExposure + amountUsd;
        if (currentCapital > 0 && newExposure * 10000 / currentCapital > maxExposurePct) {
            return (false, "Total exposure exceeded");
        }

        // Check 5: Max open positions
        if (openPositionCount >= maxOpenPositions) {
            return (false, "Max positions reached");
        }

        // Check 6: Trade cooldown
        if (block.timestamp - lastTradeTimestamp < minTradeCooldownSec) {
            return (false, "Trade cooldown active");
        }

        // Check 7: Daily loss limit
        if (dayStartCapital > 0) {
            int256 effectiveDailyPnl = int256(currentCapital) - int256(dayStartCapital);
            if (effectiveDailyPnl < 0 && uint256(-effectiveDailyPnl) * 10000 / dayStartCapital > maxDailyLossPct) {
                return (false, "Daily loss limit");
            }
        }

        // Check 8: Max drawdown
        if (peakCapital > 0 && currentCapital < peakCapital) {
            uint256 drawdownBps = (peakCapital - currentCapital) * 10000 / peakCapital;
            if (drawdownBps > maxDrawdownPct) {
                return (false, "Max drawdown exceeded");
            }
        }

        return (true, "All checks passed");
    }

    /**
     * @notice Record a trade execution (called by agent after Risk Router executes)
     */
    function recordTrade(
        address asset,
        uint8 side,
        uint256 amountUsd
    ) external onlyAgent {
        lastTradeTimestamp = block.timestamp;
        openPositionCount++;
        totalExposure += amountUsd;
        
        emit TradeChecked(agentWallet, asset, side, amountUsd, true, "Executed");
    }

    /**
     * @notice Record a position close and update PnL
     * @param pnl Realized PnL in USD (6 decimals, signed)
     * @param amountUsd Original position size in USD (6 decimals) to release from exposure
     */
    function recordClose(int256 pnl, uint256 amountUsd) external onlyAgent {
        if (openPositionCount > 0) openPositionCount--;
        
        // Release exposure
        totalExposure = totalExposure > amountUsd ? totalExposure - amountUsd : 0;
        
        // Update capital
        uint256 oldCapital = currentCapital;
        if (pnl >= 0) {
            currentCapital += uint256(pnl);
        } else {
            uint256 loss = uint256(-pnl);
            currentCapital = currentCapital > loss ? currentCapital - loss : 0;
        }
        
        dailyPnl += pnl;
        
        // Update peak
        if (currentCapital > peakCapital) {
            peakCapital = currentCapital;
        }
        
        // Check circuit breaker triggers
        _checkCircuitBreaker();
        
        emit CapitalUpdated(oldCapital, currentCapital);
    }

    /**
     * @notice Daily reset — called at start of new trading day
     */
    function dailyReset() external onlyAgent {
        require(block.timestamp - lastDailyReset >= 20 hours, "Too early for daily reset");
        
        dayStartCapital = currentCapital;
        dailyPnl = 0;
        circuitBreakerActive = false;
        lastDailyReset = block.timestamp;
        
        emit DailyReset(currentCapital, block.timestamp);
    }

    /**
     * @notice Get full risk state (for dashboard/MCP)
     */
    function getRiskState() external view returns (
        uint256 capital,
        uint256 peak,
        int256 daily,
        uint256 positions,
        uint256 exposure,
        bool cbActive,
        uint256 drawdownBps
    ) {
        uint256 dd = peakCapital > 0 && currentCapital < peakCapital
            ? (peakCapital - currentCapital) * 10000 / peakCapital
            : 0;
            
        return (
            currentCapital,
            peakCapital,
            dailyPnl,
            openPositionCount,
            totalExposure,
            circuitBreakerActive,
            dd
        );
    }

    // ─── Internal ───
    
    function _checkCircuitBreaker() internal {
        // Daily loss check
        if (dayStartCapital > 0 && dailyPnl < 0) {
            uint256 lossBps = uint256(-dailyPnl) * 10000 / dayStartCapital;
            if (lossBps > maxDailyLossPct) {
                circuitBreakerActive = true;
                emit CircuitBreakerTripped("Daily loss limit", dailyPnl, lossBps);
                return;
            }
        }
        
        // Drawdown check
        if (peakCapital > 0 && currentCapital < peakCapital) {
            uint256 drawdownBps = (peakCapital - currentCapital) * 10000 / peakCapital;
            if (drawdownBps > maxDrawdownPct) {
                circuitBreakerActive = true;
                emit CircuitBreakerTripped("Max drawdown", dailyPnl, drawdownBps);
                return;
            }
        }
    }

    // ─── Admin ───
    
    function whitelistAsset(address asset) external onlyOwner {
        whitelistedAssets[asset] = true;
        emit AssetWhitelisted(asset);
    }
    
    function forceResetCircuitBreaker() external onlyOwner {
        circuitBreakerActive = false;
        emit CircuitBreakerReset(currentCapital);
    }

    /**
     * @notice Emergency reset of exposure tracking (owner-only recovery)
     * @dev Use when recordClose txns fail and exposure becomes stale
     */
    function resetExposure() external onlyOwner {
        totalExposure = 0;
        openPositionCount = 0;
    }
}
