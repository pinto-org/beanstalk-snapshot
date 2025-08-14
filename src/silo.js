const EVM = require("./data/EVM");
const { batchEventsQuery } = require("./util/BatchEvents");
const { getCachedOrCalculate } = require("./util/Cache");

const getArbWallets = async () => {
  const {
    beanstalk: { contract: beanstalk },
    unripe: { bean, lp },
  } = await EVM.getArbitrum();

  /// --------- Deposited ----------
  // Wallets that might have unripe on arb
  const havingDeposits = await getCachedOrCalculate(
    "silo-arb-wallets-having-deposited",
    async () => {
      // Get owner/receiver of contracts with migrated deposits
      const contractsMigratedDeposits = await getCachedOrCalculate(
        "silo-deposits-migrated-contracts",
        async () => {
          const l1DepositsMigrated = await batchEventsQuery(
            beanstalk,
            beanstalk.filters.L1DepositsMigrated()
          );

          return l1DepositsMigrated.map((event) => ({
            ethOwner: event.args.owner,
            arbReceiver: event.args.receiver,
          }));
        }
      );
      console.log(
        `Found ${contractsMigratedDeposits.length} L1DepositsMigrated events.`
      );

      const addMigratedDeposit = await batchEventsQuery(
        beanstalk,
        beanstalk.filters.AddMigratedDeposit()
      );
      console.log(
        `Found ${addMigratedDeposit.length} AddMigratedDeposit events.`
      );

      const addDeposit = await batchEventsQuery(
        beanstalk,
        beanstalk.filters.AddDeposit()
      );
      console.log(`Found ${addDeposit.length} AddDeposit events.`);

      const removeDeposit = await batchEventsQuery(
        beanstalk,
        beanstalk.filters.RemoveDeposit()
      );
      console.log(`Found ${removeDeposit.length} RemoveDeposit events.`);

      const removeDeposits = await batchEventsQuery(
        beanstalk,
        beanstalk.filters.RemoveDeposits()
      );
      console.log(`Found ${removeDeposits.length} RemoveDeposits events.`);

      const transferSingle = await batchEventsQuery(
        beanstalk,
        beanstalk.filters.TransferSingle()
      );
      console.log(`Found ${transferSingle.length} TransferSingle events.`);

      const transferBatch = await batchEventsQuery(
        beanstalk,
        beanstalk.filters.TransferBatch()
      );
      console.log(`Found ${transferBatch.length} TransferBatch events.`);

      return [
        ...new Set([
          ...addMigratedDeposit.map((e) => e.args.account),
          ...addDeposit.map((e) => e.args.account),
          ...removeDeposit.map((e) => e.args.account),
          ...removeDeposits.map((e) => e.args.account),
          ...transferSingle.flatMap((e) => [
            e.args.sender ?? e.args.from ?? e.args._from,
            e.args.recipient ?? e.args.to ?? e.args._to,
          ]),
          ...transferBatch.flatMap((e) => [e.args.from, e.args.to]),
          // Arb wallet is the receiver of the L1 migrated deposits
          ...contractsMigratedDeposits.map((deposit) => deposit.arbReceiver),
        ]),
      ];
    }
  );

  /// --------- Circulating ----------
  // Wallets that might hold circulating unripe assets on arb
  const havingCirculating = await getCachedOrCalculate(
    "silo-arb-wallets-having-circulating",
    async () => {
      const urbeanTransfer = await batchEventsQuery(
        bean,
        bean.filters.Transfer()
      );
      console.log(
        `Found ${urbeanTransfer.length} Unripe Bean Transfer events.`
      );

      const urlpTransfer = await batchEventsQuery(lp, lp.filters.Transfer());
      console.log(`Found ${urlpTransfer.length} Unripe LP Transfer events.`);

      return [
        ...new Set([
          ...urbeanTransfer.flatMap((e) => [e.args.from, e.args.to]),
          ...urlpTransfer.flatMap((e) => [e.args.from, e.args.to]),
        ]),
      ];
    }
  );

  /// --------- Internal ----------
  // Wallets that might hold assets in internal balances on arb
  const havingInternalBalances = await getCachedOrCalculate(
    "silo-arb-wallets-having-internal",
    async () => {
      // Get owner/receiver of contracts with migrated internal balances
      const contractsMigratedInternalBalances = await getCachedOrCalculate(
        "silo-internal-balance-migrated-contracts",
        async () => {
          const l1InternalBalancesMigrated = await batchEventsQuery(
            beanstalk,
            beanstalk.filters.L1InternalBalancesMigrated()
          );

          return l1InternalBalancesMigrated.map((event) => ({
            ethOwner: event.args.owner,
            arbReceiver: event.args.receiver,
          }));
        }
      );
      console.log(
        `Found ${contractsMigratedInternalBalances.length} L1InternalBalancesMigrated events.`
      );

      const internalBalanceMigrated = await batchEventsQuery(
        beanstalk,
        beanstalk.filters.InternalBalanceMigrated()
      );
      console.log(
        `Found ${internalBalanceMigrated.length} InternalBalanceMigrated events.`
      );

      const internalBalanceChanged = await batchEventsQuery(
        beanstalk,
        beanstalk.filters.InternalBalanceChanged()
      );
      console.log(
        `Found ${internalBalanceChanged.length} InternalBalanceChanged events.`
      );

      return [
        ...new Set([
          ...internalBalanceMigrated.map((e) => e.args.account),
          ...internalBalanceChanged.map((e) => e.args.user ?? e.args.account),
          // Arb wallet is the receiver of the L1 migrated deposits
          ...contractsMigratedInternalBalances.map(
            (deposit) => deposit.arbReceiver
          ),
        ]),
      ];
    }
  );

  const retval = {};
  for (const wallet of havingDeposits) {
    retval[wallet] = {
      deposits: true,
      circulating: retval[wallet]?.circulating ?? false,
      internal: retval[wallet]?.internal ?? false,
    };
  }

  for (const wallet of havingCirculating) {
    retval[wallet] = {
      deposits: retval[wallet]?.deposits ?? false,
      circulating: true,
      internal: retval[wallet]?.internal ?? false,
    };
  }

  for (const wallet of havingInternalBalances) {
    retval[wallet] = {
      deposits: retval[wallet]?.deposits ?? false,
      circulating: retval[wallet]?.circulating ?? false,
      internal: true,
    };
  }

  return retval;
};

// Assets can be held in the silo, circulating, or internal balances.
// getTokenDepositsForAccount(account, tokens) -> returns info of all deposits for the account
// getInternalBalance(account, token)
// getExternalBalance(account, token)

(async () => {
  /// ---------- Arb ----------
  // Build 3 separate lists of eth/arb wallets to inspect for deposits vs internal vs circulating. This is necessary
  // because the contract migrations could occur separately to different receivers.
  const arbWallets = await getCachedOrCalculate(
    "silo-arb-wallets",
    async () => await getArbWallets()
  );
  console.log(`Proceeding with ${Object.keys(arbWallets).length} Arb wallets.`);

  /// ---------- Eth ----------

  /// ---------- Combined ----------
})();

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
