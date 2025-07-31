const fs = require("fs");
const path = require("path");

// Number of sprouts/humidity etc is irrelevant since it can be derived from the bpf/id/amount.
// I'm thinking i would like to reset the bpf to zero and decrement all the Fert IDs by that same amount.
// (its irrelevant to pinto how much beans have already paid back).
// I will still report the beanstalk values so you can choose/or so we could display the initial positions on the UI
const fertilizer = {
  beanBpf: "0x123456",
  adjustedBpf: "0x0",
  accounts: {
    "0xAccount": {
      beanFert: {
        "0xBeanstalk Fert ID": "0xFert Amount",
        "0x12345": "0x236",
      },
      adjustedFert: {
        "0xAdjusted Fert ID": "0xFert Amount",
        "0x123": "0x236",
      },
    },
  },
};

const outputDir = path.join(__dirname, "../", "output");
const outputFile = path.join(outputDir, "fert.json");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const jsonContent = JSON.stringify(fertilizer, null, 2);

fs.writeFileSync(outputFile, jsonContent);
