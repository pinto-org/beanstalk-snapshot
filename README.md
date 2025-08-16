[discord-badge]: https://img.shields.io/discord/1308123512216748105?label=Pinto%20Discord
[discord-url]: https://pinto.money/discord

# Beanstalk Snapshot

Calculates asset distribution among Beanstalk holders at the Pinto deployment block. Read more about Beanstalk holders [here](https://mirror.xyz/0x8F02813a0AC20affC2C7568e0CB9a7cE5288Ab27/2Ubk-rMAVxv1g3jLBq9ur_01_iq5lR6CN8zvcyHUwLM).

## How to Use

Run commands:

- `npm run all`
- `npm run silo`
- `npm run field`
- `npm run barn`

Final data is output to `output/`

Subresults from individual steps are cached in `cache/` as runs progress. Cache entries can be discarded/rebuilt as desired, but isn't necessary unless there is an error in some of the data.

`reseed/` folder contains data from Ethereum as of the Reseed snapshot block 20921737. These values are necessary to account for Contracts who hadn't completed the Eth -> Arb migration as of the Pinto deployment. See here for more information on the methodology used to produce those files: https://github.com/BeanstalkFarms/Reseed

Within each output file, holder addresses are further split according to:

- `arbEOAs` - non-contract wallets on Arbitrum who held Beanstalk assets at the snapshot block
- `arbContracts` - contract wallets on Arbitrum who held Beanstalk assets at the snapshot block
- `ethContracts` - contract wallets on Ethereum who held Beanstalk assets at the Reseed, and who still hadn't migrated assets to Arbitrum at the snapshot block

## License

[MIT](https://github.com/pinto-org/api/blob/main/LICENSE.txt)
