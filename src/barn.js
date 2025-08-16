// FertilizerMigrated(account, fid), L1FertilizerMigrated(owner, receiver , fertIds)
// TransferSingle(from, to, id), TransferBatch(from, to, ids)

const fs = require("fs");
const path = require("path");
const { getCachedOrCalculate, getReseedResult } = require("./util/Cache");
const { batchEventsQuery } = require("./util/BatchEvents");
const EVM = require("./data/EVM");
const { ADDR, SNAPSHOT_BLOCK_ARB } = require("./util/Constants");
const Concurrent = require("./util/Concurrent");
const { unmigratedContracts } = require("./util/ContractHolders");

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
  //
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

  // Final output
  // const outPath = path.join(process.cwd(), "output", "silo.json");
  // fs.writeFileSync(
  //   outPath,
  //   JSON.stringify(combinedUnripe, formatBigintDecimal, 2)
  // );
})();

// Number of sprouts/humidity etc is irrelevant since it can be derived from the bpf/id/amount.
// I'm thinking i would like to reset the bpf to zero and decrement all the Fert IDs by that same amount.
// (its irrelevant to pinto how much beans have already paid back).
// I will still report the beanstalk values so you can choose/or so we could display the initial positions on the UI
const fertilizer = {
  beanBpf: "0x123456",
  adjustedBpf: "0x0",
  accounts: {
    "0xAccount": {
      beanFert: {
        "0xBeanstalk Fert ID": "0xFert Amount",
        "0x12345": "0x236",
      },
      adjustedFert: {
        "0xAdjusted Fert ID": "0xFert Amount",
        "0x123": "0x236",
      },
    },
  },
};

// Put this somewhere else for overall project init?
// const outputDir = path.join(__dirname, "../", "output");
// if (!fs.existsSync(outputDir)) {
//   fs.mkdirSync(outputDir, { recursive: true });
// }
