// Transactional synthetic test double. Not a Firestore emulator or a live readiness assertion.
export class MemoryFirestore {
  constructor() { this.records = new Map(); this.tail = Promise.resolve(); }
  collection(path) { return new Query(this, path); }
  async getAll(...refs) { return Promise.all(refs.map((ref) => ref.get())); }
  async runTransaction(run) {
    const prior = this.tail;
    let release; this.tail = new Promise((resolve) => { release = resolve; });
    await prior;
    const writes = [];
    const tx = {
      get: async (ref) => { if (writes.length) throw new Error("transaction read after write"); return ref.get(); },
      getAll: async (...refs) => { if (writes.length) throw new Error("transaction read after write"); return this.getAll(...refs); },
      create: (ref, data) => writes.push({ ref, data, create: true }),
      set: (ref, data, options) => writes.push({ ref, data, options }),
    };
    try {
      const result = await run(tx);
      for (const write of writes) if (write.create && this.records.has(write.ref.path)) throw new Error("already exists");
      for (const write of writes) await write.ref.set(write.data, write.options);
      return result;
    } finally { release(); }
  }
}
class Ref {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split("/").at(-1); }
  collection(name) { return new Query(this.db, `${this.path}/${name}`); }
  async get() { const record = this.db.records.get(this.path); return { id: this.id, exists: record !== undefined, data: () => record === undefined ? undefined : structuredClone(record) }; }
  async set(data, options = {}) { this.db.records.set(this.path, structuredClone(options.merge ? { ...this.db.records.get(this.path), ...data } : data)); }
}
class Query {
  constructor(db, path, spec = {}) { Object.assign(this, { db, path, spec }); }
  doc(id) { return new Ref(this.db, `${this.path}/${id}`); }
  where(field, op, value) { return new Query(this.db, this.path, { ...this.spec, wheres: [...(this.spec.wheres || []), [field, op, value]] }); }
  orderBy(field, direction = "asc") { return new Query(this.db, this.path, { ...this.spec, orders: [...(this.spec.orders || []), [String(field), direction]] }); }
  limit(count) { return new Query(this.db, this.path, { ...this.spec, limit: count }); }
  startAfter(...values) { return new Query(this.db, this.path, { ...this.spec, after: values }); }
  async get() {
    let rows = [...this.db.records].filter(([path]) => path.startsWith(`${this.path}/`) && path.split("/").length === this.path.split("/").length + 1);
    for (const [field, op, value] of this.spec.wheres || []) {
      rows = rows.filter(([, data]) => op === "==" ? data[field] === value : op === "in" ? value.includes(data[field]) : data[field]?.includes(value));
    }
    if (this.spec.orders?.length) {
      const valueAt = ([path, data], field) => field === "__name__" ? path.split("/").at(-1) : data[field];
      rows = rows.filter((row) => this.spec.orders.every(([field]) => valueAt(row, field) !== undefined));
      const compare = (left, right) => {
        for (const [field, direction] of this.spec.orders) {
          const a = valueAt(left, field), b = valueAt(right, field), sign = direction === "desc" ? -1 : 1;
          if (a < b) return -1 * sign;
          if (a > b) return 1 * sign;
        }
        return 0;
      };
      rows.sort(compare);
      if (this.spec.after) {
        const nameIndex = this.spec.orders.findIndex(([field]) => field === "__name__");
        const cursorPath = nameIndex >= 0 ? `${this.path}/${this.spec.after[nameIndex]}` : "";
        const cursor = [cursorPath, Object.fromEntries(this.spec.orders.filter(([field]) => field !== "__name__").map(([field], index) => [field, this.spec.after[index]]))];
        rows = rows.filter((row) => compare(row, cursor) > 0);
      }
    }
    if (this.spec.limit) rows = rows.slice(0, this.spec.limit);
    return { docs: await Promise.all(rows.map(([path]) => new Ref(this.db, path).get())) };
  }
}
