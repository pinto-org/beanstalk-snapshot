Run commands:

- `npm run all`
- `npm run silo`
- `npm run field`
- `npm run barn`

Final data is output to `output/`

Subresults from individual steps are cached in `cache/` as runs progress. Cache entries can be discarded/rebuilt as desired, but isn't necessary unless there is an error in some of the data.

`reseed/` folder contains data from Ethereum as of the Reseed snapshot block 20921737. These values are necessary to account for Contracts who hadn't completed the Eth -> Arb migration as of the Pinto deployment. See here for more information on the methodology used to produce those files: https://github.com/BeanstalkFarms/Reseed
