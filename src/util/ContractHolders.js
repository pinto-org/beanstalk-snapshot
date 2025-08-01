const { getReseedResult } = require("./Cache");

const unmigratedContracts = (toExclude) => {
  const ethContracts = getReseedResult("contract-accounts", "json");
  return ethContracts.filter((contract) => !toExclude.has(contract));
};

module.exports = {
  unmigratedContracts,
};
