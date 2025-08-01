const fs = require("fs");
const path = require("path");
const EVM = require("./data/EVM");
const { batchEventsQuery } = require("./util/BatchEvents");
const { getCachedOrCalculate, getReseedResult } = require("./util/Cache");
const Concurrent = require("./util/Concurrent");
const { SNAPSHOT_BLOCK_ARB } = require("./util/Constants");
const { unmigratedContracts } = require("./util/ContractHolders");

// Wallets with Field assets on arb
const getArbWallets = async () => {
  const {
    beanstalk: { contract: beanstalk },
  } = await EVM.getArbitrum();

  // Get owner/receiver of contracts which migrated plots to arb
  const migratedFromContracts = await getCachedOrCalculate(
    "field-migrated-contracts",
    async () => {
      const l1PlotsMigrated = await batchEventsQuery(
        beanstalk,
        beanstalk.filters.L1PlotsMigrated()
      );

      // Save both owner/receiver. Owner is relevant in a future step.
      return l1PlotsMigrated.map((event) => ({
        ethOwner: event.args.owner,
        arbReceiver: event.args.receiver,
      }));
    }
  );
  console.log(`Found ${migratedFromContracts.length} L1PlotsMigrated events.`);

  const autoMigratedPlots = await batchEventsQuery(
    beanstalk,
    beanstalk.filters.MigratedPlot()
  );
  console.log(`Found ${autoMigratedPlots.length} MigratedPlot events.`);

  const plotTransfers = await batchEventsQuery(
    beanstalk,
    beanstalk.filters.PlotTransfer()
  );
  console.log(`Found ${plotTransfers.length} PlotTransfer events.`);

  const sows = await batchEventsQuery(beanstalk, beanstalk.filters.Sow());
  console.log(`Found ${sows.length} Sow events.`);

  const autoMigratedAccts = autoMigratedPlots.map((plot) => plot.args.account);
  const transferAccts = plotTransfers.flatMap((transfer) => [
    transfer.args.from,
    transfer.args.to,
  ]);
  const sowAccts = sows.map((sow) => sow.args.account);

  return [
    ...new Set([
      ...autoMigratedAccts,
      ...transferAccts,
      ...sowAccts,
      // Arb wallet is the receiver of the L1 migrated plots
      ...migratedFromContracts.map((l1Plots) => l1Plots.arbReceiver),
    ]),
  ];
};

// Wallets which did not have their Field assets migrated to arb
const getEthWallets = async (evm) => {
  const migratedFromContracts = await getCachedOrCalculate(
    "field-migrated-contracts",
    async () => {
      throw new Error(
        "This should have been cached by this point in the execution."
      );
    }
  );
  const ethOwners = new Set(
    migratedFromContracts.map((l1Plots) => l1Plots.ethOwner)
  );

  // Start with list of all contract wallets from eth, then filter out those which have migrated
  return unmigratedContracts(ethOwners);
};

const getArbPods = async (arbWallets) => {
  const {
    beanstalk: { contract: beanstalk, storage: bs },
  } = await EVM.getArbitrum();

  const harvestableIndex = BigInt(
    await beanstalk.harvestableIndex(0n, { blockTag: SNAPSHOT_BLOCK_ARB })
  );
  console.log(`Using Harvestable Index: ${harvestableIndex}`);

  const results = {};

  // Get all pods for the given wallets
  const TAG = Concurrent.tag("getArbPods-wallet");
  for (const account of arbWallets) {
    await Concurrent.run(TAG, 10, async () => {
      const plotIndexes = await bs.s.accts[account].fields[0n].plotIndexes;
      const TAG2 = Concurrent.tag(`getArbPods-plots-${account}`);
      for (const plotIndex of plotIndexes) {
        await Concurrent.run(TAG2, 5, async () => {
          let podCount = await bs.s.accts[account].fields[0n].plots[plotIndex];
          if (podCount > 0n) {
            // Shift recorded plot indices by the harvestable index
            let adjustedIndex = plotIndex - harvestableIndex;
            if (adjustedIndex < 0n) {
              // This plot had partially harvested; so we remove those harvestable pods from the recorded pod count
              console.log(
                `Removing ${-adjustedIndex} pods from a harvestable plot.`
              );
              podCount += adjustedIndex;
              adjustedIndex = 0n;
            }
            if (podCount > 0n) {
              (results[account] ??= {})[adjustedIndex] = podCount;
            }
          } else {
            // This should never occur
            console.warn(`Plot ${plotIndex} has no pods for ${account}.`);
          }
        });
      }
      await Concurrent.allResolved(TAG2);
    });
  }
  await Concurrent.allResolved(TAG);

  return results;
};

const getEthPods = async (ethWallets) => {
  const {
    beanstalk: { contract: beanstalk, storage: bs },
  } = await EVM.getArbitrum();

  const harvestableIndex = BigInt(
    await beanstalk.harvestableIndex(0n, { blockTag: SNAPSHOT_BLOCK_ARB })
  );
  console.log(`Using Harvestable Index: ${harvestableIndex}`);

  const reseedPods = getReseedResult("pods", "json");

  results = {};

  const walletsLower = ethWallets.map((wallet) => wallet.toLowerCase());
  for (const wallet of walletsLower) {
    for (const plot in reseedPods[wallet]) {
      let plotIndex = BigInt(plot);
      let podCount = BigInt(reseedPods[wallet][plot].amount);

      let adjustedIndex = plotIndex - harvestableIndex;
      if (adjustedIndex < 0n) {
        // This plot had partially harvested; so we remove those harvestable pods from the recorded pod count
        console.log(`Removing ${-adjustedIndex} pods from a harvestable plot.`);
        podCount += adjustedIndex;
        adjustedIndex = 0n;
      }

      if (podCount > 0n) {
        (results[wallet] ??= {})[adjustedIndex] = podCount;
      }
    }
  }

  return results;
};

(async () => {
  /// ---------- Arb ----------
  const arbWallets = await getCachedOrCalculate(
    "field-arb-wallets",
    async () => await getArbWallets()
  );
  console.log(`Proceeding with ${arbWallets.length} Arb wallets.`);

  const arbPods = await getCachedOrCalculate(
    "field-arb-pods",
    async () => await getArbPods(arbWallets)
  );

  let totalArbPods = 0n;
  for (const wallet in arbPods) {
    for (const plot in arbPods[wallet]) {
      totalArbPods += BigInt(arbPods[wallet][plot]);
    }
  }

  console.log(
    `Found ${Number(totalArbPods) / Math.pow(10, 6)} Arb Pods across ${Object.keys(arbPods).length} wallets.`
  );

  /// ---------- Eth ----------
  const ethWallets = await getCachedOrCalculate(
    "field-unmigrated-eth-wallets",
    async () => await getEthWallets()
  );
  console.log(`Proceeding with ${ethWallets.length} Unmigrated Eth wallets.`);

  const ethPods = await getCachedOrCalculate(
    "field-unmigrated-eth-pods",
    async () => await getEthPods(ethWallets)
  );

  let totalEthPods = 0n;
  for (const wallet in ethPods) {
    for (const plot in ethPods[wallet]) {
      totalEthPods += BigInt(ethPods[wallet][plot]);
    }
  }

  console.log(
    `Found ${Number(totalEthPods) / Math.pow(10, 6)} Unmigrated Pods across ${Object.keys(ethPods).length} wallets.`
  );

  /// ---------- Combined ----------
  const combinedPods = {
    ...arbPods,
    ...ethPods,
  };

  let totalCombinedPods = 0n;
  for (const wallet in combinedPods) {
    for (const plot in combinedPods[wallet]) {
      totalCombinedPods += BigInt(combinedPods[wallet][plot]);
    }
  }

  console.log(
    `Found ${Number(totalCombinedPods) / Math.pow(10, 6)} Combined Pods across ${Object.keys(combinedPods).length} wallets.`
  );

  // Final output
  const outPath = path.join(process.cwd(), "output", "field.json");
  fs.writeFileSync(outPath, JSON.stringify(combinedPods, null, 2));
})();
