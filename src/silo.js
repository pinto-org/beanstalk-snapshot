const { Network } = require("alchemy-sdk");
const EVM = require("./data/EVM");
const { batchEventsQuery } = require("./util/BatchEvents");
const {
  getCachedOrCalculate,
  getReseedResult,
  getAndExtendIsContractMapping,
} = require("./util/Cache");
const Concurrent = require("./util/Concurrent");
const { ADDR, SNAPSHOT_BLOCK_ARB } = require("./util/Constants");
const { unmigratedContracts } = require("./util/ContractHolders");
const { throwIfStringOverlap } = require("./util/Helper");
const { fromBigInt, toBigInt } = require("./util/NumberUtil");
const { writeOutput } = require("./util/Output");

const getArbWallets = async () => {
  const {
    beanstalk: { contract: beanstalk },
    unripe: { bean: urbean, lp: urlp },
  } = await EVM.getArbitrum();

  /// --------- Deposited ----------
  // Wallets that might have unripe on arb
  const havingDeposits = await getCachedOrCalculate(
    "silo-arb-wallets-having-deposited",
    async () => {
      // Get owner/receiver of contracts with migrated deposits
      const contractsMigratedDeposits = await getCachedOrCalculate(
        "silo-deposits-migrated-contracts",
        async () => {
          const l1DepositsMigrated = await batchEventsQuery(
            beanstalk,
            beanstalk.filters.L1DepositsMigrated()
          );

          return l1DepositsMigrated.map((event) => ({
            ethOwner: event.args.owner,
            arbReceiver: event.args.receiver,
          }));
        }
      );
      console.log(
        `Found ${contractsMigratedDeposits.length} L1DepositsMigrated events.`
      );

      const addMigratedDeposit = await batchEventsQuery(
        beanstalk,
        beanstalk.filters.AddMigratedDeposit()
      );
      console.log(
        `Found ${addMigratedDeposit.length} AddMigratedDeposit events.`
      );

      const addDeposit = await batchEventsQuery(
        beanstalk,
        beanstalk.filters.AddDeposit()
      );
      console.log(`Found ${addDeposit.length} AddDeposit events.`);

      const removeDeposit = await batchEventsQuery(
        beanstalk,
        beanstalk.filters.RemoveDeposit()
      );
      console.log(`Found ${removeDeposit.length} RemoveDeposit events.`);

      const removeDeposits = await batchEventsQuery(
        beanstalk,
        beanstalk.filters.RemoveDeposits()
      );
      console.log(`Found ${removeDeposits.length} RemoveDeposits events.`);

      const transferSingle = await batchEventsQuery(
        beanstalk,
        beanstalk.filters.TransferSingle()
      );
      console.log(`Found ${transferSingle.length} TransferSingle events.`);

      const transferBatch = await batchEventsQuery(
        beanstalk,
        beanstalk.filters.TransferBatch()
      );
      console.log(`Found ${transferBatch.length} TransferBatch events.`);

      const depositWallets = new Set([
        ...addMigratedDeposit.map((e) => e.args.account),
        ...addDeposit.map((e) => e.args.account),
        ...removeDeposit.map((e) => e.args.account),
        ...removeDeposits.map((e) => e.args.account),
        ...transferSingle.flatMap((e) => [
          e.args.sender ?? e.args.from ?? e.args._from,
          e.args.recipient ?? e.args.to ?? e.args._to,
        ]),
        ...transferBatch.flatMap((e) => [e.args.from, e.args.to]),
        // Arb wallet is the receiver of the L1 migrated deposits
        ...contractsMigratedDeposits.map((deposit) => deposit.arbReceiver),
      ]);
      depositWallets.delete(ADDR.NULL);

      return [...depositWallets];
    }
  );

  /// --------- Circulating ----------
  // Wallets that might hold circulating unripe assets on arb
  const havingCirculating = await getCachedOrCalculate(
    "silo-arb-wallets-having-circulating",
    async () => {
      const urbeanTransfer = await batchEventsQuery(
        urbean,
        urbean.filters.Transfer()
      );
      console.log(
        `Found ${urbeanTransfer.length} Unripe Bean Transfer events.`
      );

      const urlpTransfer = await batchEventsQuery(
        urlp,
        urlp.filters.Transfer()
      );
      console.log(`Found ${urlpTransfer.length} Unripe LP Transfer events.`);

      const circulatingWallets = new Set([
        ...urbeanTransfer.flatMap((e) => [e.args.from, e.args.to]),
        ...urlpTransfer.flatMap((e) => [e.args.from, e.args.to]),
      ]);
      circulatingWallets.delete(ADDR.NULL);
      // Dont count the diamond's circulating assets.
      circulatingWallets.delete(ADDR.ARB.BEANSTALK);

      return [...circulatingWallets];
    }
  );

  /// --------- Internal ----------
  // Wallets that might hold assets in internal balances on arb
  const havingInternalBalances = await getCachedOrCalculate(
    "silo-arb-wallets-having-internal",
    async () => {
      // Get owner/receiver of contracts with migrated internal balances
      const contractsMigratedInternalBalances = await getCachedOrCalculate(
        "silo-internal-balance-migrated-contracts",
        async () => {
          const l1InternalBalancesMigrated = await batchEventsQuery(
            beanstalk,
            beanstalk.filters.L1InternalBalancesMigrated()
          );

          return l1InternalBalancesMigrated.map((event) => ({
            ethOwner: event.args.owner,
            arbReceiver: event.args.receiver,
          }));
        }
      );
      console.log(
        `Found ${contractsMigratedInternalBalances.length} L1InternalBalancesMigrated events.`
      );

      const internalBalanceMigrated = await batchEventsQuery(
        beanstalk,
        beanstalk.filters.InternalBalanceMigrated()
      );
      console.log(
        `Found ${internalBalanceMigrated.length} InternalBalanceMigrated events.`
      );

      const internalBalanceChanged = await batchEventsQuery(
        beanstalk,
        beanstalk.filters.InternalBalanceChanged()
      );
      console.log(
        `Found ${internalBalanceChanged.length} InternalBalanceChanged events.`
      );

      return [
        ...new Set([
          ...internalBalanceMigrated.map((e) => e.args.account),
          ...internalBalanceChanged.map((e) => e.args.user ?? e.args.account),
          // Arb wallet is the receiver of the L1 migrated deposits
          ...contractsMigratedInternalBalances.map(
            (deposit) => deposit.arbReceiver
          ),
        ]),
      ];
    }
  );

  const retval = {};
  for (const wallet of havingDeposits) {
    retval[wallet] = {
      deposits: true,
      circulating: retval[wallet]?.circulating ?? false,
      internal: retval[wallet]?.internal ?? false,
    };
  }

  for (const wallet of havingCirculating) {
    retval[wallet] = {
      deposits: retval[wallet]?.deposits ?? false,
      circulating: true,
      internal: retval[wallet]?.internal ?? false,
    };
  }

  for (const wallet of havingInternalBalances) {
    retval[wallet] = {
      deposits: retval[wallet]?.deposits ?? false,
      circulating: retval[wallet]?.circulating ?? false,
      internal: true,
    };
  }

  return retval;
};

// Assets can be held in the silo, circulating, or internal balances.
const getArbUnripe = async (wallets) => {
  const {
    beanstalk: { contract: beanstalk },
  } = await EVM.getArbitrum();

  const results = {};

  const TAG = Concurrent.tag("getArbUnripe");
  for (const wallet in wallets) {
    await Concurrent.run(TAG, 15, async () => {
      // Check each balance type that a wallet might have
      const { deposits, circulating, internal } = wallets[wallet];
      const [depositAmounts, circulatingAmounts, internalAmounts] =
        await Promise.all([
          deposits
            ? beanstalk.getDepositsForAccount(
                wallet,
                [ADDR.ARB.UNRIPE_BEAN, ADDR.ARB.UNRIPE_LP],
                { blockTag: SNAPSHOT_BLOCK_ARB }
              )
            : Promise.resolve(null),
          circulating
            ? beanstalk.getExternalBalances(
                wallet,
                [ADDR.ARB.UNRIPE_BEAN, ADDR.ARB.UNRIPE_LP],
                { blockTag: SNAPSHOT_BLOCK_ARB }
              )
            : Promise.resolve(null),
          internal
            ? beanstalk.getInternalBalances(
                wallet,
                [ADDR.ARB.UNRIPE_BEAN, ADDR.ARB.UNRIPE_LP],
                { blockTag: SNAPSHOT_BLOCK_ARB }
              )
            : Promise.resolve(null),
        ]);

      // Aggregate results across 3 sources
      let totalUrbean = 0n;
      let totalUrlp = 0n;
      if (depositAmounts) {
        totalUrbean += depositAmounts[0].tokenDeposits.reduce(
          (acc, next) => acc + BigInt(next.amount),
          0n
        );
        totalUrlp += depositAmounts[1].tokenDeposits.reduce(
          (acc, next) => acc + BigInt(next.amount),
          0n
        );
      }
      if (circulatingAmounts) {
        totalUrbean += BigInt(circulatingAmounts[0]);
        totalUrlp += BigInt(circulatingAmounts[1]);
      }
      if (internalAmounts) {
        totalUrbean += BigInt(internalAmounts[0]);
        totalUrlp += BigInt(internalAmounts[1]);
      }

      if (totalUrbean > 0n || totalUrlp > 0n) {
        results[wallet] = {
          tokens: {
            bean: totalUrbean,
            lp: totalUrlp,
          },
        };
      }
    });
  }
  await Concurrent.allResolved(TAG);

  return results;
};

const getEthUnripe = async () => {
  // Separating these is necessary because the migration of each could occur separately to different receivers.
  const deposits = await getCachedOrCalculate(
    "silo-unmigrated-eth-deposits",
    async () => await getEthUnripeDeposits()
  );
  const internalBalances = await getCachedOrCalculate(
    "silo-unmigrated-eth-internal-balances",
    async () => await getEthUnripeInternal()
  );

  // Combine results
  const results = deposits;
  for (const wallet in internalBalances) {
    results[wallet] = {
      tokens: {
        bean:
          (results[wallet]?.tokens.bean ?? 0n) +
          internalBalances[wallet].tokens.bean,
        lp:
          (results[wallet]?.tokens.lp ?? 0n) +
          internalBalances[wallet].tokens.lp,
      },
    };
  }

  return results;
};

// Contracts which did not have their Silo deposits migrated to arb, who therefore might have unripe deposits
const getEthUnripeDeposits = async () => {
  const migratedFromContracts = await getCachedOrCalculate(
    "silo-deposits-migrated-contracts",
    async () => {
      throw new Error(
        "This should have been cached by this point in the execution."
      );
    }
  );
  const ethOwners = new Set(
    migratedFromContracts.map((l1Deposits) => l1Deposits.ethOwner)
  );
  const unmigratedOwners = unmigratedContracts(ethOwners);

  const reseedDeposits = getReseedResult("deposits", "json");

  const results = {};

  const walletsLower = unmigratedOwners.map((wallet) => wallet.toLowerCase());
  for (const wallet of walletsLower) {
    for (const token in reseedDeposits.accounts[wallet]?.totals ?? {}) {
      if (token === ADDR.ETH.UNRIPE_BEAN.toLowerCase()) {
        results[wallet] = {
          tokens: {
            bean: BigInt(reseedDeposits.accounts[wallet].totals[token].amount),
            lp: results[wallet]?.tokens.lp ?? 0n,
          },
        };
      } else if (token === ADDR.ETH.UNRIPE_LP.toLowerCase()) {
        results[wallet] = {
          tokens: {
            bean: results[wallet]?.tokens.bean ?? 0n,
            lp: BigInt(reseedDeposits.accounts[wallet].totals[token].amount),
          },
        };
      }
    }
  }

  return results;
};

// Contracts which did not have their internal balances migrated to arb, who therefore might have unripe assets
const getEthUnripeInternal = async () => {
  const migratedFromContracts = await getCachedOrCalculate(
    "silo-internal-balance-migrated-contracts",
    async () => {
      throw new Error(
        "This should have been cached by this point in the execution."
      );
    }
  );
  const ethOwners = new Set(
    migratedFromContracts.map((l1Balances) => l1Balances.ethOwner)
  );
  const unmigratedOwners = unmigratedContracts(ethOwners);

  const reseedInternalBalances = getReseedResult("internal-balances", "json");

  const results = {};

  for (const wallet of unmigratedOwners) {
    const walletLower = wallet.toLowerCase();
    for (const token in reseedInternalBalances.accounts[walletLower] ?? {}) {
      if (token === ADDR.ETH.UNRIPE_BEAN.toLowerCase()) {
        results[wallet] = {
          tokens: {
            bean: BigInt(
              reseedInternalBalances.accounts[walletLower][token].total
            ),
            lp: results[wallet]?.tokens.lp ?? 0n,
          },
        };
      } else if (token === ADDR.ETH.UNRIPE_LP.toLowerCase()) {
        results[wallet] = {
          tokens: {
            bean: results[wallet]?.tokens.bean ?? 0n,
            lp: BigInt(
              reseedInternalBalances.accounts[walletLower][token].total
            ),
          },
        };
      }
    }
  }

  return results;
};

// Assign bdv of these amounts at snapshot/recapitalization
const assignBdvs = async (combinedUnripe) => {
  const {
    beanstalk: { contract: beanstalk },
  } = await EVM.getArbitrum();

  const [bdvUrbean, bdvUrlp, recapPctUrbean, recapPctUrlp] = (
    await Promise.all([
      beanstalk.bdv(ADDR.ARB.UNRIPE_BEAN, BigInt(10 ** 6), {
        blockTag: SNAPSHOT_BLOCK_ARB,
      }),
      beanstalk.bdv(ADDR.ARB.UNRIPE_LP, BigInt(10 ** 6), {
        blockTag: SNAPSHOT_BLOCK_ARB,
      }),
      beanstalk.getRecapFundedPercent(ADDR.ARB.UNRIPE_BEAN, {
        blockTag: SNAPSHOT_BLOCK_ARB,
      }),
      beanstalk.getRecapFundedPercent(ADDR.ARB.UNRIPE_LP, {
        blockTag: SNAPSHOT_BLOCK_ARB,
      }),
    ])
  ).map((x) => Number(x) / 10 ** 6);

  console.log(`BDV at snapshot: ${bdvUrbean}, ${bdvUrlp}`);
  console.log(
    `Recap funded percent at snapshot: ${recapPctUrbean}, ${recapPctUrlp}`
  );

  const bdvUrbeanAtRecap = bdvUrbean * (1 / recapPctUrbean);
  const bdvUrlpAtRecap = bdvUrlp * (1 / recapPctUrlp);

  for (const wallet in combinedUnripe) {
    const { bean: beanAmount, lp: lpAmount } = combinedUnripe[wallet].tokens;
    combinedUnripe[wallet].bdvAtSnapshot = {
      bean: toBigInt(fromBigInt(BigInt(beanAmount), 6) * bdvUrbean, 6),
      lp: toBigInt(fromBigInt(BigInt(lpAmount), 6) * bdvUrlp, 6),
    };
    combinedUnripe[wallet].bdvAtRecapitalization = {
      bean: toBigInt(fromBigInt(BigInt(beanAmount), 6) * bdvUrbeanAtRecap, 6),
      lp: toBigInt(fromBigInt(BigInt(lpAmount), 6) * bdvUrlpAtRecap, 6),
    };

    combinedUnripe[wallet].bdvAtSnapshot.total =
      combinedUnripe[wallet].bdvAtSnapshot.bean +
      combinedUnripe[wallet].bdvAtSnapshot.lp;
    combinedUnripe[wallet].bdvAtRecapitalization.total =
      combinedUnripe[wallet].bdvAtRecapitalization.bean +
      combinedUnripe[wallet].bdvAtRecapitalization.lp;
  }
};

const resultByWalletType = async (combinedResult, arbWallets) => {
  const arbIsContractMapping = await getAndExtendIsContractMapping(
    Network.ARB_MAINNET,
    arbWallets,
    SNAPSHOT_BLOCK_ARB
  );

  const retval = {
    arbEOAs: {},
    arbContracts: {},
    ethContracts: {},
  };

  for (const wallet in combinedResult) {
    if (arbWallets.has(wallet)) {
      if (arbIsContractMapping[wallet]) {
        retval.arbContracts[wallet] = combinedResult[wallet];
      } else {
        retval.arbEOAs[wallet] = combinedResult[wallet];
      }
    } else {
      retval.ethContracts[wallet] = combinedResult[wallet];
    }
  }

  return retval;
};

// Unmigrated eth unripe assets are sitting in contract circulating, so the combined amount is validated against total supply.
const validateTotalUnripe = async (finalResult) => {
  const {
    unripe: { bean: urbean, lp: urlp },
  } = await EVM.getArbitrum();

  const [urbeanSupply, urlpSupply] = (
    await Promise.all([
      urbean.totalSupply({ blockTag: SNAPSHOT_BLOCK_ARB }),
      urlp.totalSupply({ blockTag: SNAPSHOT_BLOCK_ARB }),
    ])
  ).map(BigInt);

  let assignedUrbeanTotal = 0n;
  let assignedUrlpTotal = 0n;
  const sumSection = (section) => {
    for (const wallet in section) {
      assignedUrbeanTotal += BigInt(section[wallet].tokens.bean);
      assignedUrlpTotal += BigInt(section[wallet].tokens.lp);
    }
  };
  sumSection(finalResult.arbEOAs);
  sumSection(finalResult.arbContracts);
  sumSection(finalResult.ethContracts);

  if (
    assignedUrbeanTotal !== urbeanSupply ||
    assignedUrlpTotal !== urlpSupply
  ) {
    console.warn(`! Unripe token count mismatch`);
    console.warn(`! Unripe Bean`);
    console.warn(assignedUrbeanTotal);
    console.warn(urbeanSupply);
    console.warn(`! Unripe LP`);
    console.warn(assignedUrlpTotal);
    console.warn(urlpSupply);
  } else {
    console.log(
      `Unripe totals are matching the expected values of ${urbeanSupply}, ${urlpSupply}`
    );
  }
};

(async () => {
  /// ---------- Arb ----------
  const arbWallets = await getCachedOrCalculate(
    "silo-arb-wallets",
    async () => await getArbWallets()
  );
  console.log(`Proceeding with ${Object.keys(arbWallets).length} Arb wallets.`);

  const arbUnripe = await getCachedOrCalculate(
    "silo-arb-unripe",
    async () => await getArbUnripe(arbWallets)
  );
  console.log(`Proceeding with ${Object.keys(arbUnripe).length} Arb unripe.`);

  /// ---------- Eth ----------
  const ethUnripe = await getCachedOrCalculate(
    "silo-unmigrated-eth-unripe",
    async () => await getEthUnripe()
  );
  console.log(
    `Proceeding with ${Object.keys(ethUnripe).length} Unmigrated Eth wallets.`
  );

  /// ---------- Combined ----------
  throwIfStringOverlap(Object.keys(arbUnripe), Object.keys(ethUnripe));
  const combinedUnripe = { ...arbUnripe, ...ethUnripe };
  await assignBdvs(combinedUnripe);

  const finalResult = await resultByWalletType(
    combinedUnripe,
    new Set(Object.keys(arbUnripe))
  );

  await validateTotalUnripe(finalResult);

  writeOutput("silo", finalResult);
})();

// Notes:
// A couple things weren't done because the totals are matching the expected values already, therefore
// these are not relevant to verify.
// - didn't verify no overlap between contract-accoutns and urbean-holders/urlp-holders
// - didn't verify whether any unripe bean/lp were incorrectly sitting inside the beanstalk diamond.
//   if this occurred, the correct handling would be to keep a running total and subtract deposits/internal balances
//   from the diamond's circulating balance
