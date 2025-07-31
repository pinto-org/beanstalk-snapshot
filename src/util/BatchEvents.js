const Concurrent = require("./Concurrent");
const { SNAPSHOT_BLOCK_ARB, RESEED_BLOCK_ARB } = require("./Constants");

async function batchEventsQuery(contract, eventFilter, batchSize = 10000) {
  const TAG = Concurrent.tag("batchEventsQuery");
  let results = [];
  for (
    let fromBlock = RESEED_BLOCK_ARB;
    fromBlock <= SNAPSHOT_BLOCK_ARB;
    fromBlock += batchSize
  ) {
    await Concurrent.run(TAG, 20, async () => {
      const toBlock = Math.min(fromBlock + batchSize - 1, SNAPSHOT_BLOCK_ARB);
      const events = await contract.queryFilter(
        eventFilter,
        fromBlock,
        toBlock
      );
      results = results.concat(events);
    });
  }
  await Concurrent.allResolved(TAG);
  return results;
}

module.exports = {
  batchEventsQuery,
};
