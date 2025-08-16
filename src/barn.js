const { getCachedOrCalculate, getReseedResult } = require("./util/Cache");
const { batchEventsQuery } = require("./util/BatchEvents");
const EVM = require("./data/EVM");
const { ADDR, SNAPSHOT_BLOCK_ARB } = require("./util/Constants");
const Concurrent = require("./util/Concurrent");
const { unmigratedContracts } = require("./util/ContractHolders");
const { writeOutput } = require("./util/Output");

// Wallets that might have fert by id on arb
const getArbWallets = async () => {
  const {
    beanstalk: { contract: beanstalk },
    fert: { contract: fert },
  } = await EVM.getArbitrum();

  const contractsMigratedFert = await getCachedOrCalculate(
    "barn-fert-migrated-contracts",
    async () => {
      const l1FertilizerMigrated = await batchEventsQuery(
        beanstalk,
        beanstalk.filters.L1FertilizerMigrated()
      );

      return l1FertilizerMigrated.map((event) => ({
        ethOwner: event.args.owner,
        arbReceiver: event.args.receiver,
        ids: event.args.fertIds.map(BigInt),
      }));
    }
  );
  console.log(
    `Found ${contractsMigratedFert.length} L1FertilizerMigrated events.`
  );

  const fertilizerMigrated = await batchEventsQuery(
    beanstalk,
    beanstalk.filters.FertilizerMigrated()
  );
  console.log(`Found ${fertilizerMigrated.length} FertilizerMigrated events.`);

  const transferSingle = await batchEventsQuery(
    fert,
    fert.filters.TransferSingle()
  );
  console.log(`Found ${transferSingle.length} TransferSingle events.`);

  const transferBatch = await batchEventsQuery(
    fert,
    fert.filters.TransferBatch()
  );
  console.log(`Found ${transferBatch.length} TransferBatch events.`);

  // Aggregate all potential fert ids by account
  const retval = {};
  for (const contractEvent of contractsMigratedFert) {
    const { arbReceiver, ids } = contractEvent;
    retval[arbReceiver] = new Set(ids.map(BigInt));
  }

  for (const event of fertilizerMigrated) {
    const { account, fid } = event.args;
    (retval[account] ??= new Set()).add(BigInt(fid));
  }

  for (const event of transferSingle) {
    const { from, to, id } = event.args;
    (retval[from] ??= new Set()).add(BigInt(id));
    (retval[to] ??= new Set()).add(BigInt(id));
  }

  for (const event of transferBatch) {
    const { from, to, ids } = event.args;
    for (const id of ids) {
      (retval[from] ??= new Set()).add(BigInt(id));
      (retval[to] ??= new Set()).add(BigInt(id));
    }
  }

  // Convert sets to arrays for stringification
  for (const wallet in retval) {
    retval[wallet] = Array.from(retval[wallet]);
  }
  delete retval[ADDR.NULL];

  return retval;
};

const getArbFert = async (wallets) => {
  const {
    fert: { contract: fert },
  } = await EVM.getArbitrum();

  const retval = {};

  const TAG = Concurrent.tag("getArbFert");
  for (const wallet in wallets) {
    for (const fertId of wallets[wallet]) {
      await Concurrent.run(TAG, 50, async () => {
        const amount = BigInt(
          await fert.balanceOf(wallet, fertId, {
            blockTag: SNAPSHOT_BLOCK_ARB,
          })
        );
        if (amount > 0n) {
          (retval[wallet] ??= { beanFert: {} }).beanFert[fertId] = amount;
        }
      });
    }
  }
  await Concurrent.allResolved(TAG);

  return retval;
};

// Unmigrated fert that remains on eth
const getEthFert = async () => {
  const migratedFromContracts = await getCachedOrCalculate(
    "barn-fert-migrated-contracts",
    async () => {
      throw new Error(
        "This should have been cached by this point in the execution."
      );
    }
  );
  const ethOwners = new Set(
    migratedFromContracts.map((l1Fert) => l1Fert.ethOwner)
  );
  const unmigratedOwners = unmigratedContracts(ethOwners);

  const reseedFert = getReseedResult("fert", "json");

  const retval = {};
  for (const wallet of unmigratedOwners) {
    const walletLower = wallet.toLowerCase();
    for (const fertId in reseedFert.accounts[walletLower]) {
      (retval[wallet] ??= { beanFert: {} }).beanFert[fertId] = BigInt(
        reseedFert.accounts[walletLower][fertId].amount
      );
    }
  }

  return retval;
};

const validateTotalFert = async (combinedFert) => {
  const {
    beanstalk: { contract: beanstalk },
  } = await EVM.getArbitrum();

  // Unmigrated fert is still included in this total
  const activeFert = BigInt(
    await beanstalk.getActiveFertilizer({ blockTag: SNAPSHOT_BLOCK_ARB })
  );

  let assignedFertTotal = 0n;
  for (const wallet in combinedFert) {
    for (const fertId in combinedFert[wallet].beanFert) {
      assignedFertTotal += BigInt(combinedFert[wallet].beanFert[fertId]);
    }
  }

  if (assignedFertTotal !== activeFert) {
    console.warn(
      `! Found ${assignedFertTotal} Fert, but there are actually ${activeFert}`
    );
    console.warn(`! Deficit: ${activeFert - assignedFertTotal}`);
  } else {
    console.log(
      `Fert count matched the expected value of ${Number(activeFert)}`
    );
  }
};

// BPF adjustments
const applyMetadata = async (combinedFert) => {
  const {
    beanstalk: { contract: beanstalk },
  } = await EVM.getArbitrum();

  const beanBpf = BigInt(
    await beanstalk.beansPerFertilizer({ blockTag: SNAPSHOT_BLOCK_ARB })
  );

  const retval = {
    beanBpf,
    adjustedBpf: 0n,
    accounts: combinedFert,
  };

  for (const wallet in retval.accounts) {
    for (const fertId in retval.accounts[wallet].beanFert) {
      const adjustedId = BigInt(fertId) - beanBpf;
      (retval.accounts[wallet].adjustedFert ??= {})[adjustedId] =
        retval.accounts[wallet].beanFert[fertId];
    }
  }

  return retval;
};

// Validate sprouts against both actual/adjusted values
const validateTotalSprouts = async (finalResult) => {
  const {
    beanstalk: { contract: beanstalk },
  } = await EVM.getArbitrum();

  const unfertilizedBeans = BigInt(
    await beanstalk.totalUnfertilizedBeans({ blockTag: SNAPSHOT_BLOCK_ARB })
  );

  let assignedUnfertilized = 0n;
  let assignedUnfertilizedAdjusted = 0n;
  for (const wallet in finalResult.accounts) {
    for (const fertId in finalResult.accounts[wallet].beanFert) {
      const remainingPerFert = BigInt(fertId) - finalResult.beanBpf;
      assignedUnfertilized +=
        BigInt(finalResult.accounts[wallet].beanFert[fertId]) *
        remainingPerFert;
    }
    for (const fertId in finalResult.accounts[wallet].adjustedFert) {
      const remainingPerFert = BigInt(fertId) - finalResult.adjustedBpf;
      assignedUnfertilizedAdjusted +=
        BigInt(finalResult.accounts[wallet].adjustedFert[fertId]) *
        remainingPerFert;
    }
  }

  if (assignedUnfertilized !== unfertilizedBeans) {
    console.warn(
      `! Found ${assignedUnfertilized} Unfertilized Beans, but there are actually ${unfertilizedBeans}`
    );
    console.warn(`! Deficit: ${unfertilizedBeans - assignedUnfertilized}`);
  } else {
    console.log(
      `Unfertilized beans count matched the expected value of ${Number(unfertilizedBeans)}`
    );
  }

  if (assignedUnfertilizedAdjusted !== unfertilizedBeans) {
    console.warn(
      `! Found ${assignedUnfertilizedAdjusted} Unfertilized Beans (adjusted), but there are actually ${unfertilizedBeans}`
    );
    console.warn(
      `! Deficit: ${unfertilizedBeans - assignedUnfertilizedAdjusted}`
    );
  } else {
    console.log(
      `Adjusted unfertilized beans count matched the expected value of ${Number(unfertilizedBeans)}`
    );
  }
};

(async () => {
  /// ---------- Arb ----------
  const arbWallets = await getCachedOrCalculate(
    "barn-arb-wallets",
    async () => await getArbWallets()
  );
  console.log(`Proceeding with ${Object.keys(arbWallets).length} Arb wallets.`);

  const arbFert = await getCachedOrCalculate(
    "barn-arb-fert",
    async () => await getArbFert(arbWallets)
  );
  console.log(`Proceeding with ${Object.keys(arbFert).length} Arb fert.`);

  /// ---------- Eth ----------

  const ethFert = await getCachedOrCalculate(
    "barn-unmigrated-eth-fert",
    async () => await getEthFert()
  );
  console.log(
    `Proceeding with ${Object.keys(ethFert).length} Unmigrated Eth fert.`
  );

  /// ---------- Combined ----------

  const combinedFert = arbFert;
  for (const wallet in ethFert) {
    combinedFert[wallet] ??= { beanFert: {} };
    for (const fertId in ethFert[wallet].beanFert) {
      combinedFert[wallet].beanFert[fertId] =
        (combinedFert[wallet].beanFert[fertId] ?? 0n) +
        BigInt(ethFert[wallet].beanFert[fertId]);
    }
  }

  await validateTotalFert(combinedFert);
  const finalResult = await applyMetadata(combinedFert);
  await validateTotalSprouts(finalResult);

  writeOutput("barn", finalResult);
})();
