function desiredNet({ masterNet, masterBase, slaveBase, multiplier, align }) {
  const mult = Number(multiplier);
  if (align) return Math.round(Number(masterNet) * mult);
  const delta = Number(masterNet) - Number(masterBase);
  return Number(slaveBase) + Math.round(delta * mult);
}

function orderDelta(current, desired) {
  return Math.trunc(Number(desired) - Number(current));
}

module.exports = { desiredNet, orderDelta };
