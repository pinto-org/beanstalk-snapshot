class NumberUtil {
  /**
   * Convert the given value into a number with the desired decimal precision. For example, if converting
   * something with 18 decimals, it may be desired to keep some of that precision rather than truncating, but
   * still performing sufficient division
   * @param {BigInt} v - the value to convert
   * @param {number} precision - the precision of v
   * @param {number} resultPrecision - the desired number of decimal points in the result
   */
  static fromBigInt(v, precision, resultPrecision = precision) {
    if (resultPrecision < 0 || resultPrecision > precision) {
      throw new Error("Invalid result precision");
    }
    return (
      Number(v / BigInt(10 ** (precision - resultPrecision))) /
      Math.pow(10, resultPrecision)
    );
  }

  static toBigInt(v, precision) {
    return BigInt(Math.round(v * 10 ** precision));
  }
}
module.exports = NumberUtil;
