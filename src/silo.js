// L1DepositsMigrated, L1InternalBalancesMigrated

// Assets can be held in the silo, circulating, or internal balances.

// Separate by bean vs lp since we might want to show on the UI the breakdown of the calculation.
const unripeRecapitalizedBdvs = {
  "0xAccount": {
    tokens: {
      bean: "0x123",
      lp: "0x12",
    },
    bdvAtSnapshot: {
      bean: "0x123",
      lp: "0x12",
    },
    bdvAtRecapitalization: {
      bean: "0x123",
      lp: "0x456",
      total: "0x123456",
    },
  },
};
