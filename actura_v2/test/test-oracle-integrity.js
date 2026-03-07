import { evaluateOracleIntegrity } from '../src/security/oracle-integrity.js';
import { generateTrendingData } from '../src/data/price-feed.js';
let passed = 0;
let failed = 0;
function assert(condition, name) {
    if (condition) {
        console.log(`  ✅ ${name}`);
        passed++;
    }
    else {
        console.log(`  ❌ ${name}`);
        failed++;
    }
}
console.log('\n🧪 ORACLE INTEGRITY TESTS\n');
const normal = generateTrendingData('up', 100);
const ok = evaluateOracleIntegrity({
    prices: normal.prices,
    highs: normal.highs,
    lows: normal.lows,
    timestamps: normal.timestamps,
});
assert(ok.passed === true, 'Healthy market data passes oracle integrity');
assert(['healthy', 'watch'].includes(ok.status), 'Healthy data returns non-blocked status');
const broken = {
    prices: [...normal.prices.slice(0, -1), normal.prices[normal.prices.length - 1] * 1.25],
    highs: [...normal.highs.slice(0, -1), normal.prices[normal.prices.length - 1] * 1.28],
    lows: [...normal.lows.slice(0, -1), normal.prices[normal.prices.length - 1] * 0.96],
    timestamps: normal.timestamps,
};
const fail = evaluateOracleIntegrity(broken);
assert(fail.passed === false, 'Manipulated last price is blocked');
assert(fail.blockers.length > 0, 'Oracle guard reports blockers');
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
//# sourceMappingURL=test-oracle-integrity.js.map