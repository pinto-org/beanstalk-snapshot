const fs = require("fs");
const path = require("path");
const { formatBigintDecimal } = require("./Formatter");

const writeOutput = (name, data) => {
  const outputDir = path.join(__dirname, "../../", "output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outPath = path.join(outputDir, `${name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(data, formatBigintDecimal, 2));
};

module.exports = {
  writeOutput,
};
