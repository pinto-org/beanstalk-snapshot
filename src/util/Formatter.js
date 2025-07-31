const formatBigintHex = (_, value) => {
  if (typeof value === "bigint") {
    const abs = BigInt_abs(value);
    return `${abs === value ? "" : "-"}0x${abs.toString(16)}`;
  } else {
    return value;
  }
};

const formatBigintDecimal = (_, value) => {
  return typeof value === "bigint" ? value.toString(10) : value;
};

module.exports = {
  formatBigintHex,
  formatBigintDecimal,
};
