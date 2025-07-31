const EVM = require("./data/EVM");
const { batchEventsQuery } = require("./util/BatchEvents");
const { getCachedOrCalculate } = require("./util/Cache");

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

(async () => {
  const arbWallets = await getCachedOrCalculate(
    "field-arb-wallets",
    getArbWallets
  );
  console.log(`Proceeding with ${arbWallets.length} Arb wallets.`);
})();

const pods = {
  "0xAccount": {
    "0xBeanstalk Place in Line (plot index - harvestable index)":
      "0xNumber of Pods",
    "0x1234": "0x123456",
  },
};
