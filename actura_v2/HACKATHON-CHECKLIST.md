
# Hackathon Ready Checklist

## Before official addresses are released
- [ ] Fill `PRIVATE_KEY`
- [ ] Generate registration JSON: `npm run generate:registration`
- [ ] Verify local dashboard / demo path works
- [ ] Verify tests and build pass

## When official addresses are released
- [ ] Set `RISK_ROUTER_ADDRESS`
- [ ] Set `CAPITAL_VAULT_ADDRESS`
- [ ] Confirm registry addresses if different from defaults
- [ ] Set `VALIDATOR_ADDRESS` or `VALIDATOR_PRIVATE_KEY`
- [ ] Review Risk Router ABI / intent field names

## One-command bootstrap
- [ ] Copy `.env.hackathon.example` to `.env`
- [ ] Run `npm run bootstrap:erc8004`
- [ ] If sandbox is live, set `CLAIM_SANDBOX=true`

## On-chain path validation
- [ ] Registration tx succeeded
- [ ] Agent wallet verified (optional)
- [ ] Sandbox capital claimed
- [ ] Signed TradeIntent submitted to Risk Router
- [ ] Validation request submitted
- [ ] Validation response recorded
- [ ] Reputation feedback recorded
