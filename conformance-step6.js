/**
 * conformance-step6.mjs — гейт шага 6 (runtime-integration/1.0.0-draft4.1).
 * A1-A7 + commit-bundle (единый root-state, атомарный install) + двухфазный
 * commit/publish + T2c-T2g + verify (coverage/evidence) + immutability +
 * metadata schema-injection + causalConfig-binding.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { IntegrationRelaxationKernel } from "../src/kernels/integration-relaxation.mjs";
import { ReferenceRelaxationKernel } from "../src/kernels/reference-relaxation.mjs";
import { InProcessHost } from "../src/host/in-process-host.mjs";
import { WorkerHost } from "../src/host/worker-host.mjs";
import { RunJournal } from "../src/journal/run-journal.mjs";
import { InMemoryDriver } from "../src/archive/archive.mjs";
import { SeriesStatsObserver } from "../src/observe/series-stats.mjs";
import {
  RuntimeIntegrationLayer, FactRetentionBuffer, TransitionStaging, validateIdentityChain,
  assertEpoch, assertCausalFactsCapability, assertMetadataConsistency, factsRoot,
  transitionEvidence, transitionEvidenceHash, transactionId, verifyCommitCoverage, verifyCommittedEvidence,
} from "../src/runtime/integration-layer.mjs";
import { causalStateHash } from "./causal-hash.mjs";
import { validate } from "./validate.mjs";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const sCache = new Map();
const schema = (n) => { if (!sCache.has(n)) sCache.set(n, JSON.parse(readFileSync(join(rootDir, "protocol", "schema", `${n}.schema.json`), "utf8"))); return sCache.get(n); };
const validateRecord = (name, data) => validate(schema(name), data, name);
const validateMetadata = (m) => validate(schema("kernel-metadata"), m, "kernel-metadata");
const GOLDEN = JSON.parse(readFileSync(join(rootDir, "fixtures", "integration-hash-vectors.json"), "utf8"));
const INT_ENTRY = new URL("../src/host/integration-worker-entry.mjs", import.meta.url);
const clone = (o) => JSON.parse(JSON.stringify(o));
const PROTOCOL = { protocol: "rost0k-experiment/2", id: "exp-integration-006", createdAt: "2026-07-20T00:00:00Z",
  kernel: { name: "integration-relaxation", version: "1.0.0", abiVersion: "kernel-abi/2", stateFormat: "integration-relaxation-state/1" },
  runtime: { version: "0.6.0" }, manifest: { modules: [], snapshotTransport: { mode: "copy", cadence: 1 } },
  seed: { master: 8842107 }, commands: [], detectors: [], preregistered: { observables: ["ряд"], expectations: ["контроль"] }, environment: { platform: "node/v8", float: "f64" } };
let pass = 0, fail = 0;
async function check(n, fn) { try { const m = await fn(); pass++; console.log(`  ✓ ${n}${m ? " — " + m : ""}`); } catch (e) { fail++; console.log(`  ✗ ${n} — ${e.message}`); } }
const assert = (c, m) => { if (!c) throw new Error(m); };
async function expectCode(p, code, what) { try { await p(); } catch (e) { assert(e.code === code, `${what}: ожидался ${code}, получен ${e.code}: ${e.message}`); return; } throw new Error(`${what}: нарушение не обнаружено`); }
function expectSync(fn, code) { try { fn(); } catch (e) { if (code === null) throw new Error(`неожид: ${e.code}`); assert(e.code === code, `ожидался ${code}, получен ${e.code}`); return; } if (code !== null) throw new Error(`${code} не обнаружено`); }
const directKernel = () => { const k = new IntegrationRelaxationKernel(); k.initialize({ seed: 8842107 }); return k; };
const HASH_N = (n) => { const k = directKernel(); k.step(n); return causalStateHash(k.checkpoint()); };
async function makeLayer(opts = {}) {
  const host = opts.host ?? new InProcessHost(new IntegrationRelaxationKernel());
  if (!opts.host) await host.initialize({ seed: 8842107, params: opts.params });
  const journal = new RunJournal(new InMemoryDriver(), { validateRecord });
  const layer = new RuntimeIntegrationLayer({ host, journal, observers: opts.observers ?? [new SeriesStatsObserver()], diagnostic: opts.diagnostic ?? false, retention: opts.retention, snapshotDepth: opts.snapshotDepth ?? 3, validateMetadata: opts.validateMetadata });
  await journal.open(clone(PROTOCOL), layer.environmentDoc());
  if (opts.noOpen !== true) await layer.open();
  return { host, journal, layer };
}
async function liveRun(opts = {}) { const s = await makeLayer(opts); for (let i = 0; i < (opts.ticks ?? 40); i++) await s.layer.tick(1, { dropSnapshots: opts.dropSnapshots, dropFactSeqs: opts.dropFactSeqs }); s.hash = causalStateHash(await s.host.checkpoint()); return s; }
async function journalCausalCount(j) { return (await j.replay()).causal.filter((x) => x.kind === "causal-fact").length; }
class FailingDriver { constructor(f) { this._i = new InMemoryDriver(); this._f = f; } async putIfAbsent(r, c) { if (this._f(r)) { const e = new Error("отказ " + r.id); e.code = "E_IO"; throw e; } return this._i.putIfAbsent(r, c); } async list() { return this._i.list(); } }
class NoRestoreHost { constructor(i) { this._i = i; } metadata() { return this._i.metadata(); } initialize(c) { return this._i.initialize(c); } step(n) { return this._i.step(n); } checkpoint() { return this._i.checkpoint(); } async restore() {} }
// Хост с подменяемой metadata/checkpoint для тестов open()
class MockHost { constructor(inner, { metaFn, cpFn } = {}) { this._i = inner; this._metaFn = metaFn; this._cpFn = cpFn; } async metadata() { const m = await this._i.metadata(); return this._metaFn ? this._metaFn(m) : m; } initialize(c) { return this._i.initialize(c); } step(n) { return this._i.step(n); } async checkpoint() { const c = await this._i.checkpoint(); return this._cpFn ? this._cpFn(c) : c; } restore(s) { return this._i.restore(s); } }
class ApplyThrowRetention { constructor(inner) { this._i = inner; } get bufferIdentityHash() { return this._i.bufferIdentityHash; } identity() { return this._i.identity(); } get size() { return this._i.size; } get available() { return this._i.available; } reserve(c) { return this._i.reserve(c); } cancelReservation(t) { return this._i.cancelReservation(t); } prepareCommit(t, f) { return this._i.prepareCommit(t, f); } applyPrepared() { throw new Error("apply boom"); } reissue(s) { return this._i.reissue(s); } releaseToArchive(s) { return this._i.releaseToArchive(s); } isTransferred(s) { return this._i.isTransferred(s); } }

console.log("Шаг 6 — Runtime Integration Layer (runtime-integration/1.0.0-draft4.1)");
console.log("Эталоны:");
await check("T10 golden тик100/200/голова", async () => { assert(HASH_N(100) === GOLDEN.trajectoryHashTick100 && HASH_N(200) === GOLDEN.trajectoryHashTick200 && directKernel().step(5).facts.map((f) => `${f.seq}:${f.tick}:${f.type}`).join("|") === GOLDEN.factStreamHead5, "разошлось"); return `${GOLDEN.trajectoryHashTick100}/${GOLDEN.trajectoryHashTick200}`; });

console.log("О-2:");
await check("О-2.1 step(n) ≡ n×step(1)", async () => { const o = directKernel(); const f1 = []; for (let i = 0; i < 100; i++) f1.push(...o.step(1).facts); const m = directKernel(); const fm = m.step(100).facts; assert(JSON.stringify(f1) === JSON.stringify(fm) && causalStateHash(o.checkpoint()) === causalStateHash(m.checkpoint()), "разошлось"); return `${fm.length}`; });
await check("О-2.2 Direct ≡ InProcess ≡ Worker", async () => { const d = directKernel(); const df = d.step(50).facts; const dh = causalStateHash(d.checkpoint()); const ip = new InProcessHost(new IntegrationRelaxationKernel()); await ip.initialize({ seed: 8842107 }); const ipf = (await ip.step(50)).facts; const iph = causalStateHash(await ip.checkpoint()); const wh = new WorkerHost(INT_ENTRY); await wh.initialize({ seed: 8842107 }); const whf = (await wh.step(50)).facts; const whh = causalStateHash(await wh.checkpoint()); await wh.dispose(); assert(JSON.stringify(df) === JSON.stringify(ipf) && JSON.stringify(df) === JSON.stringify(whf) && dh === iph && dh === whh, "разошлось"); return "три хоста"; });
await check("О-2.3 restore продолжает нумерацию", async () => { const k = directKernel(); k.step(60); const mid = k.checkpoint(); const k2 = new IntegrationRelaxationKernel(); k2.initialize({ seed: 8842107 }); k2.restore(mid); const s = k2.step(10).facts.map((f) => f.seq); assert(s[0] === mid.cursors.nextFactSeq && new Set(s).size === s.length, "повтор"); return `с ${mid.cursors.nextFactSeq}`; });
await check("О-2.4 repair сохраняет seq", async () => { const r = await liveRun({ ticks: 40, dropFactSeqs: new Set([12, 13, 27]) }); const f = await r.layer.seal({ execution: "COMPLETED" }); const rep = f.repairHistory.filter((h) => h.outcome === "repaired").map((h) => h.seq).sort((a, b) => a - b); assert(JSON.stringify(rep) === JSON.stringify([12, 13, 27]) && f.auditStatus === "COMPLETE" && r.hash === HASH_N(40), "repair"); return "repaired, COMPLETE"; });
await check("О-2.5 перестановка доставки не меняет replay", async () => { const r = await liveRun({ ticks: 40, dropFactSeqs: new Set([5, 6, 7]) }); await r.layer.seal({ execution: "COMPLETED" }); const s = (await r.journal.replay()).causal.filter((x) => x.kind === "causal-fact").map((x) => x.body.seq); assert(s.every((v, i) => i === 0 || s[i - 1] < v) && s[0] === 0 && s.at(-1) === 39, "порядок"); return "по seq"; });
await check("О-2.6 подмена nextFactSeq ловится хэшем", async () => { const k = directKernel(); k.step(30); const cp = k.checkpoint(); const t = clone(cp); t.cursors.nextFactSeq += 1; assert(causalStateHash(t) !== causalStateHash(cp), "глух"); return "ok"; });
await check("О-2.7 одинаковый seq иное содержимое ⇒ конфликт", async () => { const j = new RunJournal(new InMemoryDriver(), { validateRecord }); await j.open(clone(PROTOCOL), { runtime: "0.6.0" }); const mk = (s) => ({ tier: "fact", type: "fact.field-relaxed", causalTick: 1, seq: 0, factId: "fact:0", payload: { channel: 1, sample: s }, envelope: { correlationId: "fact:0" } }); await j.recordFact(mk(0.1)); await j.recordFact(mk(0.2)); const m = j.buildManifest().streams.find((x) => x.streamId === "facts"); assert((m.conflictCount ?? 0) > 0, "нет"); return `conflict=${m.conflictCount}`; });
await check("О-2.8 исчерпание ⇒ E_SEQ_EXHAUSTED", async () => { const cp = directKernel().checkpoint(); cp.cursors.nextFactSeq = Number.MAX_SAFE_INTEGER; cp.causalConfig = { drive: cp.scalars.drive, emitEvery: cp.scalars.emitEvery }; const k = new IntegrationRelaxationKernel(); k.initialize({ seed: 8842107 }); k.restore(cp); const t = k.checkpoint().tick; await expectCode(async () => k.step(1), "E_SEQ_EXHAUSTED", "исч"); assert(k.checkpoint().tick === t, "мутация"); return "fail-closed"; });

console.log("Живой контур:");
await check("живой прогон ⇒ SEALED + три порядка", async () => { const r = await liveRun({ ticks: 40 }); const f = await r.layer.seal({ execution: "COMPLETED" }); const rp = await r.journal.replay(); assert(f.runSealStatus === "SEALED" && f.auditStatus === "COMPLETE" && rp.causal.length && rp.emission.length && rp.receipt.length && r.layer.phase === "SEALED", "seal"); return `causal=${rp.causal.length}, SEALED`; });
await check("отказ fact-sink ⇒ дыра ⇒ repair ⇒ COMPLETE", async () => { const r = await liveRun({ ticks: 40, dropFactSeqs: new Set([20, 21]) }); const miss = new Set(); for (const g of r.journal.buildManifest().streams.find((s) => s.streamId === "facts").missingSeqRanges) for (let s = g.from; s <= g.to; s++) miss.add(s); assert(miss.has(20) && miss.has(21), "дыра"); const f = await r.layer.seal({ execution: "COMPLETED" }); assert(f.auditStatus === "COMPLETE" && r.hash === HASH_N(40), "audit"); return "repair→COMPLETE"; });
await check("A5: массовый drop ⇒ claims=0, физика эталонна", async () => { const b = await liveRun({ ticks: 40 }); await b.layer.seal({ execution: "COMPLETED" }); const d = await liveRun({ ticks: 40, dropSnapshots: true }); const fd = await d.layer.seal({ execution: "COMPLETED" }); const rb = await b.journal.replay(), rd = await d.journal.replay(); assert(rd.emission.length === 0 && rb.emission.length > 0 && d.hash === b.hash && d.hash === HASH_N(40) && fd.runSealStatus === "SEALED", "инвариант"); return "claims=0, физика эталонна"; });
await check("ЦТ1: APPLIED + отказ result ⇒ UNSEALED, runId неизменен", async () => { async function rc(dr) { const h = new InProcessHost(new IntegrationRelaxationKernel()); await h.initialize({ seed: 8842107 }); const j = new RunJournal(dr, { validateRecord }); await j.open(clone(PROTOCOL), { runtime: "0.6.0", platform: "node/v8", float: "f64", host: "in-process" }); const { commandId } = await j.submitCommand({ body: { op: "nudge" }, requestedTick: 1 }); await h.step(1); const fid = "fact:0"; await j.recordFact({ tier: "fact", type: "fact.command.apply", causalTick: 1, seq: 0, factId: fid, payload: { commandId }, envelope: { correlationId: fid, causationId: commandId } }); const res = await j.resolveCommand(commandId, "APPLIED", { tick: 1, kernelFactId: fid }); return { res, final: await j.finalize({ execution: "COMPLETED" }) }; } const H = await rc(new InMemoryDriver()); const W = await rc(new FailingDriver((r) => r.id.endsWith(":result"))); assert(H.final.runSealStatus === "SEALED" && W.res.journalStatus === "RESULT_MISSING" && W.final.runSealStatus === "UNSEALED" && H.final.runIdentityHash === W.final.runIdentityHash, "оси"); return "runId общий"; });
await check("ЦТ2: OUTCOME_UNKNOWN ⇒ ABORTED+UNSEALED", async () => { const h = new InProcessHost(new IntegrationRelaxationKernel()); await h.initialize({ seed: 8842107 }); const j = new RunJournal(new InMemoryDriver(), { validateRecord }); await j.open(clone(PROTOCOL), { runtime: "0.6.0" }); const { commandId } = await j.submitCommand({ body: { op: "nudge" }, requestedTick: 1 }); await h.step(1); await j.resolveCommand(commandId, "OUTCOME_UNKNOWN", { tick: 1 }); await expectCode(async () => j.finalize({ execution: "COMPLETED" }), "E_FINALIZE_INDETERMINATE", "unknown"); const f = await j.finalize({ execution: "ABORTED", terminationReason: "crash", terminalTick: 1, checkpointAbsenceJustification: "apply↔confirm" }); assert(f.runSealStatus === "UNSEALED" && f.runIdentityClass === "causal-indeterminate", "класс"); return "ABORTED+UNSEALED"; });

console.log("Commit-bundle: атомарность install и окно commit (P0.12):");
await check("staging машина: rollback после COMMITTING/COMMITTED запрещён", async () => { const a = new TransitionStaging(0); a.validated(); a.staged(); a.beginCommit(); expectSync(() => a.rollback(), "E_STAGING_PHASE"); a.markCommitted(); a.publish(true); assert(a.phase === "PUBLISHED", "phase"); const b = new TransitionStaging(1); b.validated(); b.staged(); b.rollback(); assert(b.phase === "ROLLED_BACK", "rb"); return "переходы строгие"; });
for (const fp of ["validate", "stage", "prepare", "afterPrepare", "afterIdentity", "afterMarker"]) {
  await check(`T2(${fp}): сбой до install ⇒ журнал пуст, откат ядра, state pristine`, async () => {
    const s = await makeLayer(); await s.layer.tick(1);
    const hb = causalStateHash(await s.host.checkpoint()); const cl = s.layer.identityChainSnapshot.length; const rsq = s.layer.reportSeq; const jc = await journalCausalCount(s.journal);
    await expectCode(async () => s.layer.tick(1, { failAt: fp }), "E_IO", fp);
    assert(s.layer.phase === "OPEN", `фаза ${s.layer.phase}`);
    assert(s.layer.identityChainSnapshot.length === cl && s.layer.committedSnapshot.length === cl && s.layer.reportSeq === rsq, "chain/committed/reportSeq выросли");
    assert(await journalCausalCount(s.journal) === jc, "журнал получил следы");
    assert(causalStateHash(await s.host.checkpoint()) === hb, "ядро не откатилось");
    await s.layer.tick(1); assert(s.layer.identityChainSnapshot.length === cl + 1, "tick после отката");
    return "журнал пуст, откат, tick продолжен";
  });
}
await check("T-install: сбой ВО ВРЕМЯ install ⇒ CAUSAL_INDETERMINATE (атомарность недоказуема)", async () => {
  const inner = new FactRetentionBuffer({ depth: 100 });
  const s = await makeLayer({ retention: new ApplyThrowRetention(inner) });
  await expectCode(async () => s.layer.tick(1), "E_CAUSAL_INDETERMINATE", "install throw");
  assert(s.layer.phase === "CAUSAL_INDETERMINATE", `фаза ${s.layer.phase}`);
  await expectCode(async () => s.layer.tick(1), "E_PHASE", "tick после indeterminate");
  return "install-сбой ⇒ INDETERMINATE, tick запрещён";
});
await check("T3: недоказуемый откат ⇒ CAUSAL_INDETERMINATE", async () => { const inner = new InProcessHost(new IntegrationRelaxationKernel()); await inner.initialize({ seed: 8842107 }); const host = new NoRestoreHost(inner); const s = await makeLayer({ host, observers: [] }); await s.layer.tick(1); await expectCode(async () => s.layer.tick(1, { failAt: "validate" }), "E_IO", "validate"); assert(s.layer.phase === "CAUSAL_INDETERMINATE", `фаза ${s.layer.phase}`); await expectCode(async () => s.layer.seal({ execution: "COMPLETED" }), "E_CAUSAL_INDETERMINATE", "seal"); return "indeterminate"; });

console.log("Двухфазный commit/publish (P0.10, P0.17):");
await check("publish-сбой ПОСЛЕ commit ⇒ committed, PUBLISH_PARTIAL (не PUBLISHED)", async () => { const s = await makeLayer(); await s.layer.tick(1); const res = await s.layer.tick(1, { dropFactSeqs: new Set([1]) }); assert(res.committed === true && res.publishStatus === "PARTIAL" && res.stagingPhase === "PUBLISH_PARTIAL", `${res.publishStatus}/${res.stagingPhase}`); const f = await s.layer.seal({ execution: "COMPLETED" }); assert(f.auditStatus === "COMPLETE", "repair"); return "PUBLISH_PARTIAL, repair закрыл"; });
await check("полная публикация ⇒ PUBLISHED", async () => { const s = await makeLayer(); const res = await s.layer.tick(1); assert(res.publishStatus === "PUBLISHED" && res.stagingPhase === "PUBLISHED", `${res.publishStatus}/${res.stagingPhase}`); return "PUBLISHED"; });
await check("T8b: падающий наблюдатель ⇒ committed, ошибка зафиксирована, следующий tick один раз", async () => { const Crash = { descriptor: { detectorId: "analyzer.crash", version: "1.0.0" }, configHash: "e".repeat(64), observe() { const e = new Error("boom"); e.code = "E_OBSERVER_CRASH"; throw e; } }; const s = await makeLayer({ observers: [Crash] }); const res = await s.layer.tick(1); assert(res.committed === true, "не committed"); const before = s.layer.identityChainSnapshot.length; const res2 = await s.layer.tick(1); assert(res2.committed && s.layer.identityChainSnapshot.length === before + 1, "следующий tick"); const f = await s.layer.seal({ execution: "COMPLETED" }); assert((await s.journal.replay()).emission.some((x) => x.kind === "observer-failure") && f.runSealStatus === "SEALED", "failure/seal"); return "committed, failure записан, ровно один следующий"; });

console.log("Evidence и покрытие (P0.8, P0.9, P0.13, P0.14, P0.15, P1.14):");
function synthRS(n, mutate = null) {
  const chain = [], committed = [], wal = [];
  let before = "a".repeat(16);
  for (let i = 0; i < n; i++) {
    const after = "b" + String(i).padStart(15, "0");
    const facts = [{ seq: i, tick: i + 1, type: "fact.field-relaxed", payload: { v: i } }];
    const ev = { reportSeq: i, kernelEpoch: 0, causalConfigHash: "c".repeat(16), tickStart: i, tickEnd: i + 1, stateHashBefore: before, stateHashAfter: after, factCount: 1, firstFactSeq: i, lastFactSeq: i, factsRoot: factsRoot(facts) };
    ev.transitionEvidenceHash = transitionEvidenceHash(ev); ev.transactionId = transactionId(i, before, after);
    const id = { reportSeq: i, tickStart: i, tickEnd: i + 1, kernelEpoch: 0, stateHashBefore: before, stateHashAfter: after, factCount: 1, factCountDeclared: 1, firstFactSeq: i, lastFactSeq: i, factsRoot: ev.factsRoot };
    const marker = { marker: "STEP_COMMIT", reportSeq: i, transitionEvidenceHash: ev.transitionEvidenceHash, transactionId: ev.transactionId, evidence: ev, facts };
    chain.push(id); committed.push(marker); wal.push({ marker: "STEP_INTENT", reportSeq: i }, marker);
    before = after;
  }
  const rs = { identityChain: chain, committed, wal, reportSeq: n, nextExpectedSeq: n };
  const rp = { causal: committed.flatMap((m) => m.facts.map((f) => ({ kind: "causal-fact", body: { seq: f.seq, causalTick: f.tick, type: f.type, payload: f.payload } }))) };
  if (mutate) mutate(rs, rp);
  return { rs, rp };
}
await check("P0.13: firstFactSeq/lastFactSeq входят в transitionEvidenceHash", async () => { const e = { reportSeq: 0, kernelEpoch: 0, causalConfigHash: "c", tickStart: 0, tickEnd: 1, stateHashBefore: "a", stateHashAfter: "b", factCount: 1, firstFactSeq: 0, lastFactSeq: 0, factsRoot: "r" }; const h0 = transitionEvidenceHash(e); assert(transitionEvidenceHash({ ...e, firstFactSeq: 99 }) !== h0 && transitionEvidenceHash({ ...e, lastFactSeq: 99 }) !== h0, "не в hash"); return "first/last в commitment"; });
await check("verify: чистый run ⇒ 0 нарушений (positive)", async () => { const { rs, rp } = synthRS(5); assert(verifyCommitCoverage(rs).length === 0 && verifyCommittedEvidence(rs, rp).length === 0, "ложное"); return "consistent"; });
await check("P0.15: удалён committed-маркер ⇒ COVERAGE_BIJECTION", async () => { const { rs } = synthRS(5, (rs) => { rs.committed.pop(); }); assert(verifyCommitCoverage(rs).some((x) => x.why === "COVERAGE_BIJECTION"), "не поймано"); return "pop маркера пойман"; });
await check("P0.15: дырка в reportSeq маркеров ⇒ обнаружено", async () => { const { rs } = synthRS(5, (rs) => { rs.committed[2] = { ...rs.committed[2], reportSeq: 99 }; }); assert(verifyCommitCoverage(rs).length > 0, "не поймано"); return "дырка/индекс пойман"; });
await check("P0.9: подмена factsRoot маркера ⇒ MARKER_SELF", async () => { const { rs, rp } = synthRS(3, (rs) => { rs.committed[1].evidence.factsRoot = "f".repeat(16); }); assert(verifyCommittedEvidence(rs, rp).some((x) => x.why === "MARKER_SELF"), "не поймано"); return "маркер самопроверка"; });
await check("P0.9: chain расходится с маркером ⇒ CHAIN_DISAGREE", async () => { const { rs, rp } = synthRS(3, (rs) => { rs.identityChain[1] = { ...rs.identityChain[1], factsRoot: "f".repeat(16) }; }); assert(verifyCommittedEvidence(rs, rp).some((x) => x.why === "CHAIN_DISAGREE"), "не поймано"); return "chain≠marker"; });
await check("P1.14: подмена transactionId ⇒ TXID", async () => { const { rs, rp } = synthRS(3, (rs) => { rs.committed[1] = { ...rs.committed[1], transactionId: "0".repeat(16) }; }); assert(verifyCommittedEvidence(rs, rp).some((x) => x.why === "TXID"), "не поймано"); return "transactionId сверяется"; });
await check("P0.14: факт отсутствует в журнале ⇒ FACT_MISSING_AFTER_REPAIR", async () => { const { rs, rp } = synthRS(3, (rs, rp) => { rp.causal = rp.causal.filter((x) => x.body.seq !== 1); }); assert(verifyCommittedEvidence(rs, rp).some((x) => x.why === "FACT_MISSING_AFTER_REPAIR"), "не поймано"); return "missing = нарушение"; });
await check("P0.14: подмена payload факта в журнале ⇒ FACTS_ROOT_MISMATCH", async () => { const { rs, rp } = synthRS(3, (rs, rp) => { const t = rp.causal.find((x) => x.body.seq === 1); t.body.payload = { v: 999 }; }); assert(verifyCommittedEvidence(rs, rp).some((x) => x.why === "FACTS_ROOT_MISMATCH"), "не поймано"); return "payload-подмена поймана"; });
await check("P0.14 seal: перманентный missing ⇒ seal COMPLETED отвергнут после repair", async () => { const j = new RunJournal(new InMemoryDriver(), { validateRecord }); const host = new InProcessHost(new IntegrationRelaxationKernel()); await host.initialize({ seed: 8842107 }); const layer = new RuntimeIntegrationLayer({ host, journal: j, observers: [] }); await j.open(clone(PROTOCOL), layer.environmentDoc()); await layer.open(); layer["__noReissue"] = true; j.setReissueSource("facts", { reissue: () => null }); for (let i = 0; i < 10; i++) await layer.tick(1, { dropFactSeqs: new Set([4]) }); await expectCode(async () => layer.seal({ execution: "COMPLETED" }), "E_JOURNAL_INCONSISTENT", "перманентный missing"); return "seal отвергнут (evidence после repair)"; });
await check("seal positive: живой прогон проходит все проверки покрытия/evidence", async () => { const r = await liveRun({ ticks: 20 }); const f = await r.layer.seal({ execution: "COMPLETED" }); assert(f.runSealStatus === "SEALED", "не SEALED"); return "coverage+evidence сошлись"; });

console.log("Immutability (P1.15):");
await check("снапшот-геттеры deep-frozen, внешняя мутация не влияет на внутреннее", async () => { const r = await liveRun({ ticks: 5 }); const snap = r.layer.identityChainSnapshot; assert(Object.isFrozen(snap) && Object.isFrozen(snap[0]), "не заморожен"); let threw = false; try { snap[0].factsRoot = "x"; } catch { threw = true; } const snap2 = r.layer.identityChainSnapshot; assert((threw || snap2[0].factsRoot !== "x") && snap !== snap2, "мутация просочилась/та же ссылка"); assert(r.layer.committedSnapshot !== r.layer.committedSnapshot, "committed не копируется"); return "внешний код не меняет нормативное состояние"; });

console.log("Metadata (P0.16, P1.13, P1.12):");
await check("P0.16: schema-invalid metadata (живой Host) ⇒ open() rejects", async () => { const inner = new InProcessHost(new IntegrationRelaxationKernel()); await inner.initialize({ seed: 8842107 }); const host = new MockHost(inner, { metaFn: (m) => ({ ...m, abiVersion: 123 }) }); const s = await makeLayer({ host, validateMetadata, noOpen: true }); await expectCode(async () => s.layer.open(), "E_METADATA_INVALID", "schema-invalid"); return "open отверг невалидную схему"; });
await check("P0.16: валидная metadata обоих профилей проходит validateMetadata", async () => { assert(validateMetadata(new ReferenceRelaxationKernel().metadata()).ok && validateMetadata(directKernel().metadata()).ok, "невалидна"); const s = await makeLayer({ validateMetadata }); assert(s.layer.phase === "OPEN", "open не прошёл"); return "оба профиля валидны, open ок"; });
await check("P1.13: metadata.causalConfig ≠ checkpoint.causalConfig ⇒ open() rejects", async () => { const inner = new InProcessHost(new IntegrationRelaxationKernel()); await inner.initialize({ seed: 8842107 }); const host = new MockHost(inner, { cpFn: (c) => { const cc = { drive: c.scalars.drive }; return { ...c, causalConfig: cc, causalConfigHash: c.causalConfigHash }; } }); const s = await makeLayer({ host, noOpen: true }); await expectCode(async () => s.layer.open(), "E_METADATA_INCONSISTENT", "config≠checkpoint"); return "рассинхрон config↔checkpoint отвергнут"; });
await check("P1.12: причинная конфигурация без hash ⇒ open() rejects (парность)", async () => { const inner = new InProcessHost(new IntegrationRelaxationKernel()); await inner.initialize({ seed: 8842107 }); const host = new MockHost(inner, { cpFn: (c) => { const { causalConfigHash, ...rest } = c; return rest; } }); const s = await makeLayer({ host, noOpen: true }); await expectCode(async () => s.layer.open(), "E_METADATA_INCONSISTENT", "парность"); return "causalConfig без hash отвергнут"; });
await check("assertMetadataConsistency: рассинхрон валит до tick", async () => { expectSync(() => assertMetadataConsistency({ causalFacts: true, factStreams: [], seqScope: "kernel-global", causalConfig: [] }), "E_METADATA_INCONSISTENT"); expectSync(() => assertMetadataConsistency({ causalFacts: true, factStreams: [{ id: "f", type: "fact.x" }], seqScope: "stream-local", causalConfig: [] }), "E_METADATA_INCONSISTENT"); assert(assertMetadataConsistency(directKernel().metadata()) === true, "integration"); return "seqScope/factStreams/causalConfig проверены"; });

console.log("Прочие инварианты:");
await check("capability в контуре: causalFacts=false + facts отклонены", async () => { const ref = new ReferenceRelaxationKernel(); ref.initialize({ seed: 8842107 }); assert(assertCausalFactsCapability(ref.metadata(), ref.step(1)) === false && assertCausalFactsCapability(directKernel().metadata(), directKernel().step(1)) === true, "cap"); expectSync(() => assertCausalFactsCapability({ causalFacts: false }, { facts: [{ tier: "fact" }] }), "E_CAUSALFACTS_DISABLED"); return "подлог отклонён"; });
await check("epoch guard: kernelEpoch≠0 ⇒ E_UNSUPPORTED_EPOCH", async () => { expectSync(() => assertEpoch(0), null); expectSync(() => assertEpoch(1), "E_UNSUPPORTED_EPOCH"); assert(validateIdentityChain([{ reportSeq: 0, kernelEpoch: 1, tickStart: 0, tickEnd: 1, stateHashBefore: "a".repeat(16), stateHashAfter: "b".repeat(16), factCount: 0, factCountDeclared: 0, factsRoot: "c".repeat(16) }]).some((x) => x.invariant === "EPOCH"), "цепь"); return "0 ок, 1 отклонён"; });
await check("P1.7: prepareCommit сверяет facts.length и уникальность seq", async () => { const rb = new FactRetentionBuffer({ depth: 5 }); const t = rb.reserve(1); expectSync(() => rb.prepareCommit(t, [{ seq: 0 }, { seq: 1 }]), "E_FACT_DEMAND_MISMATCH"); const rb2 = new FactRetentionBuffer({ depth: 5 }); const t2 = rb2.reserve(2); expectSync(() => rb2.prepareCommit(t2, [{ seq: 0 }, { seq: 0 }]), "E_FACT_DEMAND_MISMATCH"); return "mismatch и дубли отвергнуты"; });
await check("T1: overflow retention ДО step (retained-custody), ядро не тронуто", async () => { const s = await makeLayer({ retention: new FactRetentionBuffer({ depth: 3, retentionPolicy: "retained-custody" }) }); for (let i = 0; i < 3; i++) await s.layer.tick(1); const tb = (await s.host.checkpoint()).tick; await expectCode(async () => s.layer.tick(1), "E_RETENTION_EXHAUSTED", "overflow"); assert((await s.host.checkpoint()).tick === tb, "мутация"); return "custody до step"; });
await check("P1.8: default ephemeral-custody, длинный прогон не упирается", async () => { const rb = new FactRetentionBuffer({ depth: 3 }); assert(rb.identity().retentionPolicy === "ephemeral-custody", "default"); const s = await makeLayer({ retention: rb }); for (let i = 0; i < 40; i++) await s.layer.tick(1); assert(rb.size <= 3, `size=${rb.size}`); return `40 тактов, depth=3, size=${rb.size}`; });
await check("T4: restore при emitEvery≠1 восстанавливает машину", async () => { const src = new IntegrationRelaxationKernel(); src.initialize({ seed: 8842107, params: { emitEvery: 5 } }); src.step(20); const cp = src.checkpoint(); const dst = new IntegrationRelaxationKernel(); dst.initialize({ seed: 8842107, params: { emitEvery: 1 } }); dst.restore(cp); assert(causalStateHash(dst.checkpoint()) === causalStateHash(src.checkpoint()) && JSON.stringify(dst.step(10).facts.map((f) => f.tick)) === JSON.stringify([25, 30]), "restore"); return "emitEvery=5 восстановлен"; });
await check("P1.9: open поверх restored checkpoint (tick 60) ⇒ первый seq=60", async () => { const host = new InProcessHost(new IntegrationRelaxationKernel()); await host.initialize({ seed: 8842107 }); const seed = directKernel(); seed.step(60); await host.restore(seed.checkpoint()); const s = await makeLayer({ host, observers: [] }); assert(s.layer.reportSeq === 0, "reportSeq"); const res = await s.layer.tick(1); assert(res.report.facts[0].seq === 60 && res.committed, `seq=${res.report.facts[0].seq}`); return "первый seq=60"; });
await check("T5: конкурентный tick ⇒ E_CONCURRENT_TICK", async () => { const s = await makeLayer(); const p = s.layer.tick(1); await expectCode(async () => s.layer.tick(1), "E_CONCURRENT_TICK", "reentr"); await p; assert(s.layer.identityChainSnapshot.length === 1, "повреждён"); return "non-reentrant"; });
await check("P1.10: исключение finalize ⇒ SEAL_FAILED", async () => { const s = await makeLayer(); await s.layer.tick(1); const orig = s.journal.finalize.bind(s.journal); s.journal.finalize = async () => { const e = new Error("boom"); e.code = "E_IO"; throw e; }; await expectCode(async () => s.layer.seal({ execution: "COMPLETED" }), "E_IO", "finalize"); assert(s.layer.phase === "SEAL_FAILED", `фаза ${s.layer.phase}`); s.journal.finalize = orig; return "SEALING→SEAL_FAILED"; });
await check("state machine: close()⇒CLOSED, tick после seal запрещён", async () => { const s = await liveRun({ ticks: 5 }); await s.layer.seal({ execution: "COMPLETED" }); await expectCode(async () => s.layer.tick(1), "E_PHASE", "tick"); s.layer.close(); assert(s.layer.phase === "CLOSED", `${s.layer.phase}`); return "SEALED→CLOSED"; });
await check("T9: seqScope kernel-global, factId=fact:{seq}", async () => { assert(directKernel().metadata().seqScope === "kernel-global", "seqScope"); const r = await liveRun({ ticks: 20 }); await r.layer.seal({ execution: "COMPLETED" }); const facts = (await r.journal.replay()).causal.filter((x) => x.kind === "causal-fact"); assert(facts.every((f) => f.body.factId === `fact:${f.body.seq}`) && new Set(facts.map((f) => f.body.seq)).size === facts.length, "коллизия"); return "единый поток"; });
await check("P1.16: SnapshotRing не деградирует при падающем наблюдателе (все handles освобождены)", async () => { const Crash = { descriptor: { detectorId: "c", version: "1" }, configHash: "e".repeat(64), observe() { throw new Error("x"); } }; const s = await makeLayer({ observers: [Crash], snapshotDepth: 2 }); for (let i = 0; i < 30; i++) await s.layer.tick(1); const res = await s.layer.tick(1); assert(res.committed, "деградация"); return "30+ тактов, пул не исчерпан"; });
await check("A5: RuntimeDiagnostic OFF ≡ ON по causal audit replay", async () => { const off = await liveRun({ ticks: 40, diagnostic: false }); const fo = await off.layer.seal({ execution: "COMPLETED" }); const on = await liveRun({ ticks: 40, diagnostic: true }); const fn = await on.layer.seal({ execution: "COMPLETED" }); const s1 = (await off.journal.replay()).causal.filter((x) => x.kind === "causal-fact").map((x) => x.body.seq); const s2 = (await on.journal.replay()).causal.filter((x) => x.kind === "causal-fact").map((x) => x.body.seq); assert(off.hash === on.hash && fo.runIdentityHash === fn.runIdentityHash && JSON.stringify(s1) === JSON.stringify(s2), "разошлось"); return "инвариантно"; });
await check("terminology: causal audit replay", async () => { const r = await liveRun({ ticks: 10 }); await r.layer.seal({ execution: "COMPLETED" }); const f = (await r.journal.replay()).causal.filter((x) => x.kind === "causal-fact")[0]; assert(f.body.payload.channel !== undefined && f.body.payload.sample !== undefined && f.body.payload.field === undefined, "не {channel,sample}"); return "{channel,sample}"; });

console.log(`\nИтог шага 6: ${pass} прошло, ${fail} провалено.`);
console.log(`Эталоны Integration Profile: тик100=${GOLDEN.trajectoryHashTick100} тик200=${GOLDEN.trajectoryHashTick200}`);
if (fail > 0) process.exit(1);
