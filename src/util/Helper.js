const throwIfStringOverlap = (arr1, arr2) => {
  const s1 = new Set(arr1.map((addr) => addr.toLowerCase()));
  const s2 = new Set(arr2.map((addr) => addr.toLowerCase()));
  const overlap = [...s1].filter((addr) => s2.has(addr));
  if (overlap.length > 0) {
    throw new Error(`Overlap detected in provided string arrays:`, overlap);
  }
};

module.exports = {
  throwIfStringOverlap,
};
