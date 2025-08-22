const {
  getCachedOrCalculate,
  getReseedResult,
  getAndExtendIsContractMapping,
} = require("./util/Cache");
const { batchEventsQuery } = require("./util/BatchEvents");
const EVM = require("./data/EVM");
const { ADDR, SNAPSHOT_BLOCK_ARB } = require("./util/Constants");
const Concurrent = require("./util/Concurrent");
const { unmigratedContracts } = require("./util/ContractHolders");
const { writeOutput } = require("./util/Output");
const { throwIfStringOverlap } = require("./util/Helper");
const { Network } = require("alchemy-sdk");

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

// BPF adjustments
const applyMetadata = async (finalResult) => {
  const {
    beanstalk: { contract: beanstalk },
  } = await EVM.getArbitrum();

  const beanBpf = BigInt(
    await beanstalk.beansPerFertilizer({ blockTag: SNAPSHOT_BLOCK_ARB })
  );

  const retval = {
    beanBpf,
    adjustedBpf: 0n,
    accounts: finalResult,
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

const resultByWalletType = async (combinedResult, arbWallets) => {
  const arbIsContractMapping = await getAndExtendIsContractMapping(
    Network.ARB_MAINNET,
    arbWallets,
    SNAPSHOT_BLOCK_ARB
  );

  const retval = {
    beanBpf: combinedResult.beanBpf,
    adjustedBpf: combinedResult.adjustedBpf,
    arbEOAs: {},
    arbContracts: {},
    ethContracts: {},
  };

  for (const wallet in combinedResult.accounts) {
    if (arbWallets.has(wallet)) {
      if (arbIsContractMapping[wallet]) {
        retval.arbContracts[wallet] = combinedResult.accounts[wallet];
      } else {
        retval.arbEOAs[wallet] = combinedResult.accounts[wallet];
      }
    } else {
      retval.ethContracts[wallet] = combinedResult.accounts[wallet];
    }
  }

  return retval;
};

const validateTotalFert = async (finalResult) => {
  const {
    beanstalk: { contract: beanstalk },
  } = await EVM.getArbitrum();

  // Unmigrated fert is still included in this total
  const activeFert = BigInt(
    await beanstalk.getActiveFertilizer({ blockTag: SNAPSHOT_BLOCK_ARB })
  );

  let assignedFertTotal = 0n;
  const sumSection = (section) => {
    for (const wallet in section) {
      for (const fertId in section[wallet].beanFert) {
        assignedFertTotal += BigInt(section[wallet].beanFert[fertId]);
      }
    }
  };
  sumSection(finalResult.arbEOAs);
  sumSection(finalResult.arbContracts);
  sumSection(finalResult.ethContracts);

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
  const sumSection = (section) => {
    for (const wallet in section) {
      for (const fertId in section[wallet].beanFert) {
        const remainingPerFert = BigInt(fertId) - finalResult.beanBpf;
        assignedUnfertilized +=
          BigInt(section[wallet].beanFert[fertId]) * remainingPerFert;
      }
      for (const fertId in section[wallet].adjustedFert) {
        const remainingPerFert = BigInt(fertId) - finalResult.adjustedBpf;
        assignedUnfertilizedAdjusted +=
          BigInt(section[wallet].adjustedFert[fertId]) * remainingPerFert;
      }
    }
  };
  sumSection(finalResult.arbEOAs);
  sumSection(finalResult.arbContracts);
  sumSection(finalResult.ethContracts);

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

// Directly carry over storage values from arbitrum beanstalk
const attachStorageValues = async (finalResult) => {
  const barnStorage = await getCachedOrCalculate("barn-storage", async () => {
    const {
      beanstalk: { storage: bs },
    } = await EVM.getArbitrum();

    const [
      activeFertilizer,
      fertilizedIndex,
      unfertilizedIndex,
      fertilizedPaidIndex,
      fertFirst,
      fertLast,
      bpf,
      recapitalized,
      leftoverBeans,
    ] = await Promise.all([
      bs.s.sys.fert.activeFertilizer,
      bs.s.sys.fert.fertilizedIndex,
      bs.s.sys.fert.unfertilizedIndex,
      bs.s.sys.fert.fertilizedPaidIndex,
      bs.s.sys.fert.fertFirst,
      bs.s.sys.fert.fertLast,
      bs.s.sys.fert.bpf,
      bs.s.sys.fert.recapitalized,
      bs.s.sys.fert.leftoverBeans,
    ]);

    let storage = {
      fertilizer: {},
      nextFid: {},
      activeFertilizer,
      fertilizedIndex,
      unfertilizedIndex,
      fertilizedPaidIndex,
      fertFirst,
      fertLast,
      bpf,
      recapitalized,
      leftoverBeans,
    };
    let currFid = fertFirst;
    while (!!currFid) {
      const [total, next] = await Promise.all([
        bs.s.sys.fert.fertilizer[currFid],
        bs.s.sys.fert.nextFid[currFid],
      ]);
      storage.fertilizer[currFid] = total;
      storage.nextFid[currFid] = next;
      currFid = next;
    }
    return storage;
  });

  finalResult.storage = barnStorage;
};

const crossValidateStorage = async (finalResult) => {
  const fertGrouped = {};
  const sumSection = (section) => {
    for (const wallet in section) {
      for (const fertId in section[wallet].beanFert) {
        fertGrouped[fertId] =
          (fertGrouped[fertId] ?? 0n) +
          BigInt(section[wallet].beanFert[fertId]);
      }
    }
  };
  sumSection(finalResult.arbEOAs);
  sumSection(finalResult.arbContracts);
  sumSection(finalResult.ethContracts);

  // Verify the same fertilizer ids are present in both locations
  const allFids = new Set(Object.keys(fertGrouped));
  const allStorageFids = new Set(Object.keys(finalResult.storage.fertilizer));
  if (allFids.size !== allStorageFids.size) {
    console.warn(
      `! Some fertilizer ids were missing. Storage has ${allStorageFids.size} but we found ${allFids.size}`
    );
  }
  for (const fid of allFids) {
    if (!allStorageFids.has(fid)) {
      console.warn(`! Fert ${fid} was not found in storage`);
    }
  }
  for (const fid of allStorageFids) {
    if (!allFids.has(fid)) {
      console.warn(`! Fert ${fid} was not found`);
    }
  }

  // Verify correct counts of fertilizer
  for (const fid in finalResult.storage.fertilizer) {
    if (fertGrouped[fid] !== BigInt(finalResult.storage.fertilizer[fid])) {
      console.warn(
        `! Fert ${fid} found ${fertGrouped[fid]} but has ${finalResult.storage.fertilizer[fid]} in storage`
      );
    }
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
  throwIfStringOverlap(
    Object.keys(arbFert).map((k) => k.toLowerCase()),
    Object.keys(ethFert).map((k) => k.toLowerCase())
  );
  const combinedFert = { ...arbFert, ...ethFert };
  const combinedResult = await applyMetadata(combinedFert);

  const finalResult = await resultByWalletType(
    combinedResult,
    new Set(Object.keys(arbFert))
  );

  await validateTotalFert(finalResult);
  await validateTotalSprouts(finalResult);

  await attachStorageValues(finalResult);
  await crossValidateStorage(finalResult);

  writeOutput("barn", finalResult);
})();
