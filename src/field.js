const EVM = require("./data/EVM");
const { batchEventsQuery } = require("./util/BatchEvents");
const { getCachedOrCalculate } = require("./util/Cache");
const Concurrent = require("./util/Concurrent");
const { SNAPSHOT_BLOCK_ARB } = require("./util/Constants");

const getArbWallets = async () => {
  const {
    beanstalk: { contract: beanstalk },
  } = await EVM.getArbitrum();

  const migratedPlots = await batchEventsQuery(
    beanstalk,
    beanstalk.filters.MigratedPlot()
  );
  console.log(`Found ${migratedPlots.length} MigratedPlot events.`);
  const plotTransfers = await batchEventsQuery(
    beanstalk,
    beanstalk.filters.PlotTransfer()
  );
  console.log(`Found ${plotTransfers.length} PlotTransfer events.`);
  const sows = await batchEventsQuery(beanstalk, beanstalk.filters.Sow());
  console.log(`Found ${sows.length} Sow events.`);

  const migratedPlotters = migratedPlots.map((plot) => plot.args.account);
  const transferrers = plotTransfers.flatMap((transfer) => [
    transfer.args.from,
    transfer.args.to,
  ]);
  const sowers = sows.map((sow) => sow.args.account);

  return [...new Set([...migratedPlotters, ...transferrers, ...sowers])];
};

const getEthWallets = async (evm) => {
  // Wallets which did not have their field assets migrated to arb
  // Start with list of all contract wallets from eth, then filter out those which have migrated
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
    results[account] = {};
    await Concurrent.run(TAG, 5, async () => {
      const plotIndexes = await bs.s.accts[account].fields[0n].plotIndexes;
      const TAG2 = Concurrent.tag(`getArbPods-plots-${account}`);
      for (const plotIndex of plotIndexes) {
        await Concurrent.run(TAG2, 10, async () => {
          let podCount = await bs.s.accts[account].fields[0n].plots[plotIndex];
          if (podCount > 0n) {
            // Shift recorded plot indices by the harvestable index
            let adjustedIndex = plotIndex - harvestableIndex;
            if (adjustedIndex < 0n) {
              // This plot had partially harvested; so we remove those harvestable pods from the recorded pod count
              podCount += adjustedIndex;
              adjustedIndex = 0n;
              console.log(
                `Removing ${-adjustedIndex} pods from a harvestable plot.`
              );
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

(async () => {
  const arbWallets = await getCachedOrCalculate("field-arb-wallets", () =>
    getArbWallets()
  );
  console.log(`Proceeding with ${arbWallets.length} Arb wallets.`);

  const arbPods = await getCachedOrCalculate("field-arb-pods", () =>
    getArbPods(arbWallets)
  );

  let totalPods = 0n;
  for (const wallet in arbPods) {
    for (const plot in arbPods[wallet]) {
      totalPods += BigInt(arbPods[wallet][plot]);
    }
  }

  console.log(
    `Found ${Number(totalPods) / Math.pow(10, 6)} Pods across ${Object.keys(arbPods).length} wallets.`
  );
})();

const pods = {
  "0xAccount": {
    "0xBeanstalk Place in Line (plot index - harvestable index)":
      "0xNumber of Pods",
    "0x1234": "0x123456",
  },
};
