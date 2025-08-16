const { Alchemy, Contract, Network } = require("alchemy-sdk");
const {
  ADDR,
  RESEED_BLOCK_ETH,
  SNAPSHOT_BLOCK_ARB,
} = require("../util/Constants");
const ContractStorage = require("@beanstalk/contract-storage");
require("dotenv").config();

const beanstalkEthAbi = require("./abi/BeanstalkEth.json");
const beanstalkArbAbi = require("./abi/BeanstalkArb.json");
const fertAbi = require("./abi/Fertilizer.json");
const erc20Abi = require("./abi/ERC20.json");

const beanstalkEthStorage = require("./storage/BeanstalkEth.json");
const beanstalkArbStorage = require("./storage/BeanstalkArb.json");
const fertStorage = require("./storage/Fertilizer.json");

class EVM {
  static _providers = {};

  static async getProvider(network) {
    if (EVM._providers[network]) {
      return EVM._providers[network];
    }
    const alchemy = new Alchemy({
      apiKey: process.env.ALCHEMY_API_KEY,
      network,
    });
    const provider = await alchemy.config.getProvider();
    EVM._providers[network] = provider;
    return provider;
  }

  static async getEthereum() {
    const provider = await EVM.getProvider(Network.ETH_MAINNET);
    return {
      beanstalk: {
        contract: new Contract(ADDR.ETH.BEANSTALK, beanstalkEthAbi, provider),
        storage: new ContractStorage(
          provider,
          ADDR.ETH.BEANSTALK,
          beanstalkEthStorage,
          RESEED_BLOCK_ETH
        ),
      },
      fert: {
        contract: new Contract(ADDR.ETH.FERT, fertAbi, provider),
        storage: new ContractStorage(
          provider,
          ADDR.ETH.FERT,
          fertStorage,
          RESEED_BLOCK_ETH
        ),
      },
      unripe: {
        bean: new Contract(ADDR.ETH.UNRIPE_BEAN, erc20Abi, provider),
        lp: new Contract(ADDR.ETH.UNRIPE_LP, erc20Abi, provider),
      },
    };
  }

  static async getArbitrum() {
    const provider = await EVM.getProvider(Network.ARB_MAINNET);
    return {
      beanstalk: {
        contract: new Contract(ADDR.ARB.BEANSTALK, beanstalkArbAbi, provider),
        storage: new ContractStorage(
          provider,
          ADDR.ARB.BEANSTALK,
          beanstalkArbStorage,
          SNAPSHOT_BLOCK_ARB
        ),
      },
      fert: {
        contract: new Contract(ADDR.ARB.FERT, fertAbi, provider),
        storage: new ContractStorage(
          provider,
          ADDR.ARB.FERT,
          fertStorage,
          SNAPSHOT_BLOCK_ARB
        ),
      },
      unripe: {
        bean: new Contract(ADDR.ARB.UNRIPE_BEAN, erc20Abi, provider),
        lp: new Contract(ADDR.ARB.UNRIPE_LP, erc20Abi, provider),
      },
    };
  }

  // An address is considered to be a contract if it has associated code
  static async isContract(network, address, block) {
    const provider = await this.getProvider(network);
    try {
      return (await provider.getCode(address, block)) !== "0x";
    } catch (e) {
      return false;
    }
  }
}
module.exports = EVM;
