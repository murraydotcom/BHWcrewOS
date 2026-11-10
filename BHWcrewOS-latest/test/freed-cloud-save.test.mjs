import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
const app = fs.readFileSync(new URL("../provider/workflow-app.mjs", import.meta.url), "utf8");
function harness(save) {
  const row = { id: "SYNTHETIC", note: "Draft", sourceTranscript: "Original source", noteBuilderInput: { assessment: "Knee pain" } };
  const baselines = new Map();
  const context = vm.createContext({ rows: [row], cloudClient: { saveAndVerify: save }, cloudSaveChains: new Map(), cloudPendingIds: new Set(), cloudBaselines: baselines, setNoteSaveState() {}, setCloudState() {}, buildEncounterPacket: x => x, rememberCloudVersion: x => baselines.set(x.id, context.cloudFingerprint(x)) });
  vm.runInContext(app.slice(app.indexOf("function cloudFingerprint("), app.indexOf("function rememberCloudVersion(")), context);
  vm.runInContext(app.slice(app.indexOf("function queueEncounterSave("), app.indexOf("async function flushDirtyEncounters(")), context);
  return { row, baselines, save: () => context.queueEncounterSave(row), fingerprint: x => context.cloudFingerprint(x) };
}
test("verified server normalization does not leave a false device-only save badge", async () => {
  const h = harness(async x => ({ ...x, noteBuilderInput: { ...x.noteBuilderInput, hpi: "" }, updatedAt: "2026-11-10T22:00:00Z" }));
  await h.save();
  assert.equal(h.baselines.get(h.row.id), h.fingerprint(h.row));
  assert.equal(h.row.noteBuilderInput.hpi, "");
});
test("server read-back does not overwrite edits made while a save is in flight", async () => {
  let finish;
  const h = harness(x => new Promise(resolve => { finish = () => resolve({ ...x, updatedAt: "2026-11-10T22:00:00Z" }); }));
  const pending = h.save();
  while (!finish) await Promise.resolve();
  h.row.note = "Newer draft";
  finish();await pending;
  assert.equal(h.row.note, "Newer draft");
  assert.notEqual(h.baselines.get(h.row.id), h.fingerprint(h.row));
});
test("source-only edits remain in session recovery before a note is generated", () => {
  const storage = new Map();
  const context = vm.createContext({ rows: [{ id: "SYNTHETIC", note: "", sourceTranscript: "Fictional Freed source", noteBuilderInput: {}, codes: [], diagnoses: [], tasks: [], documents: [], codingRecommendations: [], clinicalAudit: { status: "not_run" } }], storageSet: (store,key,value) => storage.set(key,value), localStorage: {}, sessionStorage: {}, QUEUE_KEY: "metadata", NOTES_KEY: "clinical", serializeQueue: () => "{}", cloudClient: null });
  vm.runInContext(app.slice(app.indexOf("function persist("), app.indexOf("function setCloudState(")), context);
  context.persist({ cloud: false });
  assert.equal(JSON.parse(storage.get("clinical")).SYNTHETIC.sourceTranscript, "Fictional Freed source");
});
