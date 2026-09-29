type DataObject = Record<string, unknown>;

function isObject(value: unknown): value is DataObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function sameSyncValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameSyncValue(value, right[index]));
  }
  if (!isObject(left) || !isObject(right)) return false;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => sameSyncValue(left[key], right[key]));
}

// Replay only changes made locally since base onto the latest cloud snapshot.
// Records with stable IDs merge independently, including additions and deletions.
export function mergeSyncValue(base: unknown, local: unknown, remote: unknown): unknown {
  if (sameSyncValue(base, local)) return remote;
  if (sameSyncValue(base, remote) || sameSyncValue(local, remote)) return local;
  if (isObject(local) && isObject(remote) && (base === undefined || isObject(base))) {
    const before = isObject(base) ? base : {};
    const keys = new Set([...Object.keys(before), ...Object.keys(local), ...Object.keys(remote)]);
    return Object.fromEntries([...keys].flatMap((key) => {
      const value = mergeSyncValue(before[key], local[key], remote[key]);
      return value === undefined ? [] : [[key, value]];
    }));
  }
  if (Array.isArray(local) && Array.isArray(remote) && (base === undefined || Array.isArray(base))) {
    const before: unknown[] = Array.isArray(base) ? base : [];
    const arrays = [before, local, remote];
    const identity = ['id', 'yearMonth'].find((key) => arrays.every((items) =>
      items.every((item) => isObject(item) && typeof item[key] === 'string' && item[key] !== '')
      && new Set(items.map((item) => (item as DataObject)[key])).size === items.length));
    if (identity) {
      const maps = arrays.map((items) => new Map(items.map((item) => [(item as DataObject)[identity], item])));
      const [baseMap, localMap, remoteMap] = maps;
      const baseOrder = [...baseMap.keys()].filter((id) => localMap.has(id));
      const localOrder = [...localMap.keys()].filter((id) => baseMap.has(id));
      const reordered = !sameSyncValue(baseOrder, localOrder);
      const order = new Set(reordered
        ? [...localMap.keys(), ...remoteMap.keys()]
        : [...remoteMap.keys(), ...localMap.keys()]);
      return [...order].flatMap((id) => {
        const value = mergeSyncValue(baseMap.get(id), localMap.get(id), remoteMap.get(id));
        return value === undefined ? [] : [value];
      });
    }
  }
  // An actual conflict in a scalar or an unkeyed list keeps the local edit.
  return local;
}
