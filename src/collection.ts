/** A Map with the helpers discord.js bots use on caches. */
export class Collection<K, V> extends Map<K, V> {
  find(fn: (value: V, key: K, collection: this) => unknown): V | undefined {
    for (const [key, value] of this) if (fn(value, key, this)) return value;
    return undefined;
  }
  findKey(fn: (value: V, key: K, collection: this) => unknown): K | undefined {
    for (const [key, value] of this) if (fn(value, key, this)) return key;
    return undefined;
  }
  filter(
    fn: (value: V, key: K, collection: this) => unknown,
  ): Collection<K, V> {
    const out = new Collection<K, V>();
    for (const [key, value] of this)
      if (fn(value, key, this)) out.set(key, value);
    return out;
  }
  map<T>(fn: (value: V, key: K, collection: this) => T): T[] {
    const out: T[] = [];
    for (const [key, value] of this) out.push(fn(value, key, this));
    return out;
  }
  some(fn: (value: V, key: K, collection: this) => unknown) {
    for (const [key, value] of this) if (fn(value, key, this)) return true;
    return false;
  }
  every(fn: (value: V, key: K, collection: this) => unknown) {
    for (const [key, value] of this) if (!fn(value, key, this)) return false;
    return true;
  }
  reduce<T>(fn: (accumulator: T, value: V, key: K) => T, initial: T): T {
    let accumulator = initial;
    for (const [key, value] of this) accumulator = fn(accumulator, value, key);
    return accumulator;
  }
  first(): V | undefined;
  first(amount: number): V[];
  first(amount?: number): V | V[] | undefined {
    const values = [...this.values()];
    return amount === undefined ? values[0] : values.slice(0, amount);
  }
  last(): V | undefined;
  last(amount: number): V[];
  last(amount?: number): V | V[] | undefined {
    const values = [...this.values()];
    return amount === undefined ? values.at(-1) : values.slice(-amount);
  }
  firstKey(): K | undefined {
    return this.keys().next().value;
  }
  at(index: number) {
    return [...this.values()].at(index);
  }
  hasAll(...keys: K[]) {
    return keys.every((key) => this.has(key));
  }
  hasAny(...keys: K[]) {
    return keys.some((key) => this.has(key));
  }
  clone() {
    return new Collection<K, V>(this);
  }
  sort(compare: (a: V, b: V) => number = () => 0) {
    const entries = [...this.entries()].sort(([, a], [, b]) => compare(a, b));
    this.clear();
    for (const [key, value] of entries) this.set(key, value);
    return this;
  }
  toJSON() {
    return [...this.values()];
  }
}
