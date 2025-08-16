const fs = require("fs");
const path = require("path");
const { formatBigintDecimal } = require("./Formatter");
const { RESEED_BLOCK_ETH } = require("./Constants");
const Concurrent = require("./Concurrent");
const EVM = require("../data/EVM");

const getCachedOrCalculate = async (name, calculateFn) => {
  const cacheDir = path.join(process.cwd(), "cache");
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const cacheFile = path.join(cacheDir, `${name}.json`);

  if (fs.existsSync(cacheFile)) {
    console.log(`Returning cached result for ${name}.`);
    const data = fs.readFileSync(cacheFile, "utf8");
    return JSON.parse(data);
  } else {
    console.log(`No cached result found for ${name}. Calculating...`);
    const result = await calculateFn();
    const stringified = JSON.stringify(result, formatBigintDecimal, 2);
    fs.writeFileSync(cacheFile, stringified, "utf8");
    // Re-parse for type consistency in both hit/miss scenarios
    return JSON.parse(stringified);
  }
};

// Builds a mapping of addresses to whether they are contracts at a given block.
// Allows reuse of same info across various scripts.
const getAndExtendIsContractMapping = async (network, addresses, block) => {
  const cacheDir = path.join(process.cwd(), "cache");
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const cacheFile = path.join(cacheDir, `${network}-isContract${block}.json`);
  let retval = {};
  if (fs.existsSync(cacheFile)) {
    console.log(
      `Found cached isContract mapping for ${network} at block ${block}.`
    );
    const data = fs.readFileSync(cacheFile, "utf8");
    retval = JSON.parse(data);
  }

  const TAG = Concurrent.tag("isContractMapping");
  for (const address of addresses) {
    if (!retval[address]) {
      await Concurrent.run(TAG, 50, async () => {
        retval[address] = await EVM.isContract(network, address, block);
      });
    }
  }
  await Concurrent.allResolved(TAG);

  // Write result to cache
  fs.writeFileSync(
    cacheFile,
    JSON.stringify(retval, formatBigintDecimal, 2),
    "utf8"
  );

  return retval;
};

const getReseedResult = (name, type) => {
  const data = fs.readFileSync(
    path.join(process.cwd(), "reseed", `${name}${RESEED_BLOCK_ETH}.json`),
    "utf8"
  );

  if (type === "json") {
    return JSON.parse(data);
  } else if (type === "csv") {
    return data
      .split("\n")
      .filter((_, idx) => idx > 0)
      .reduce((acc, next) => {
        const [key, value] = next.trim().split(",");
        acc[key] = BigInt(value);
        return acc;
      }, {});
  }
};

module.exports = {
  getCachedOrCalculate,
  getAndExtendIsContractMapping,
  getReseedResult,
};
