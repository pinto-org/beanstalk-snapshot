// On ethereum, the block immediately before the Pause https://etherscan.io/tx/0x13604a17915f00e78ca8517ec47c4d42b4ae0badfa798f17b965377fdee1233a
const RESEED_BLOCK_ETH = 20921737;
// Beanstalk deployed on Arbitrum (Sep-24-2024 01:34:37 PM +UTC)
const RESEED_BLOCK_ARB = 256874794;
// On Base, Pinto diamond was deployed at 22622854 (Nov-19-2024 04:50:55 PM +UTC) https://basescan.org/block/22622854
// Deploy tx: https://basescan.org/tx/0xcb1d2907aaf8291d23e4faabf47411213cd4746150e2630c8ddda526efa15830
// This is equivalent to 276160746 on Arbitrum (Nov-19-2024 04:50:55 PM +UTC) https://arbiscan.io/block/276160746
const SNAPSHOT_BLOCK_ARB = 276160746;

const ADDR = {
  ETH: {
    BEANSTALK: "0xc1e088fc1323b20bcbee9bd1b9fc9546db5624c5",
    FERT: "0x402c84de2ce49af88f5e2ef3710ff89bfed36cb6",
    UNRIPE_BEAN: "0x1bea0050e63e05fbb5d8ba2f10cf5800b6224449",
    UNRIPE_LP: "0x1bea3ccd22f4ebd3d37d731ba31eeca95713716d",
  },
  ARB: {
    BEANSTALK: "0xd1a0060ba708bc4bcd3da6c37efa8dedf015fb70",
    FERT: "0xfefefeca5375630d6950f40e564a27f6074845b5",
    UNRIPE_BEAN: "0x1bea054dddbca12889e07b3e076f511bf1d27543",
    UNRIPE_LP: "0x1bea059c3ea15f6c10be1c53d70c75fd1266d788",
  },
};

module.exports = {
  RESEED_BLOCK_ETH,
  RESEED_BLOCK_ARB,
  SNAPSHOT_BLOCK_ARB,
  ADDR,
};
