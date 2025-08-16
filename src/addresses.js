// Identify all addresses having beanstalk assets
// Further divide into contracts and EOAs
// Further divide to contracts that did not migrate from eth -> arb

// Get from events? Can simplify as any wallet involved in any txns involving assets of each category

// TODO

// For each account, identify as one of the following:
// - EOA on arb
// - Contract on arb
// - Contract on eth which did not migrate to arb

// EOA on arb if not has code on arb
// Contract on arb if has code on arb
// Contract on eth if the assets are still on eth

// But the output files have no concept of a chain. an address could be contract on one chain and eoa on another.

// If in eth wallet list -> is therefore contract on eth
// If in arb list -> then need to check if has code on arb

// Fert:
// barn-unmigrated-eth-fert to identify amounts of unmigrated fert/the owners
// barn-arb-fert to identify which of the arb wallets are contracts

// arbEOAs
// arbContracts
// ethContracts
