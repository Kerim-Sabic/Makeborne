/* eslint-disable @typescript-eslint/no-require-imports -- Offline journal, SDK transport and supervisor doubles. */
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

async function main() {
  const { publicationLifecycleJournal, publicationCleanupGate } = await import('../../../infra/project-runtime/publication-journal.mjs');
  const { vercelPublicationExecutor } = await import('../../../infra/project-runtime/vercel-publication-executor.mjs');
  const { supervisePublications } = await import('../../../infra/project-runtime/publication-supervisor.mjs');
  const { publicationControl } = await import('../../../infra/project-runtime/publication-control.mjs');
  const { runPublicationController } = await import('../../../infra/project-runtime/publication-controller.mjs');
  const workerId = randomUUID(), now = Date.now();
  const signal = () => new AbortController().signal;
  const iso = milliseconds => new Date(milliseconds).toISOString();
  const record = (extra = {}) => ({ preparationId: randomUUID(), workerId, fence: '9007199254740993',
    leaseUntil: iso(now + 290000), name: `mbpub-compiler-${randomUUID()}`, kind: 'compiler',
    image: `team/project/compiler@sha256:${'a'.repeat(64)}`, evidenceSha256: 'b'.repeat(64),
    runtimeIdentity: `sha256:${'c'.repeat(64)}`, latestExpectedExpiry: iso(now + 280000),
    sessionId: 'session-original', providerExpiresAt: iso(now + 75000), state: 'cleanup_unconfirmed', ...extra });
  const claim = value => ({ record: value, cleanupFence: '9007199254740995', cleanupLeaseUntil: iso(now + 30000) });
  function fixture(options = {}) {
    const original = record(), calls = [], finishes = [];
    let pending = true;
    const rpc = async (name, args) => {
      calls.push({ name, args });
      if (name.endsWith('_claim')) return pending ? { records: [claim(original)], pending: 1 } : { records: [], pending: 0 };
      assert.ok(name.endsWith('_finish'));
      finishes.push(args.p_state);
      if (options.finishError) throw Error('lost finish response');
      if (args.p_state === 'stopped') pending = false;
      return { ...original, state: args.p_state };
    };
    const transport = { async get(args) {
      calls.push({ name: 'get', args }); assert.equal(args.resume, false);
      if (options.getError) throw Object.assign(Error('not found'), { status: 404 });
      return { name: options.wrongName ? `mbpub-compiler-${randomUUID()}` : original.name,
        currentSession: () => ({ sessionId: options.differentSession ? 'session-other' : original.sessionId }),
        async stop() { calls.push({ name: 'stop' }); if (options.stopError) throw Error('stop unavailable');
          return { id: options.wrongStopId ? 'session-other' : options.differentSession ? 'session-other' : original.sessionId,
            status: options.stopStatus ?? 'stopped' }; } };
    } };
    return { original, rpc, transport, calls, finishes, pending: () => pending,
      gate: () => publicationCleanupGate({ rpc, transport, now: () => now }) };
  }
  let passed = 0;
  async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`); }

  await check('lifecycle requires exact durable acknowledgement; known identity changes fail closed', async () => {
    const original = record({ state: 'running' });
    for (const key of ['name', 'preparationId', 'workerId', 'fence', 'image', 'evidenceSha256', 'runtimeIdentity', 'sessionId']) {
      await assert.rejects(publicationLifecycleJournal(async () => ({ ...original, [key]: key === 'fence' ? '2' : 'wrong' }))(original), /JOURNAL_INVALID/);
    }
    await assert.rejects(publicationLifecycleJournal(async () => null)(original), /JOURNAL_INVALID/);
    const events = [];
    await publicationLifecycleJournal(async (name, args, abort) => { events.push(name); assert.ok(abort instanceof AbortSignal); return args.p_record; })(original);
    assert.deepEqual(events, ['makeborne_publication_worker_sandbox_event']);
  });
  await check('PostgreSQL microseconds survive acknowledgement comparison; equivalent timezone is accepted', async () => {
    const original = record({ leaseUntil: '2026-10-13T12:05:00.123456Z', latestExpectedExpiry: '2026-10-13T12:04:55.123456Z', providerExpiresAt: '2026-10-13T12:01:00.123456Z' });
    await publicationLifecycleJournal(async () => ({ ...original, leaseUntil: '2026-10-13T14:05:00.123456+02:00' }))(original);
    await assert.rejects(publicationLifecycleJournal(async () => ({ ...original, leaseUntil: '2026-10-13T12:05:00.123457Z' }))(original), /JOURNAL_INVALID/);
    await assert.rejects(publicationLifecycleJournal(async args => args)({ ...original, latestExpectedExpiry: '2026-10-13T12:04:55.123457Z' }), /JOURNAL_INVALID/);
  });
  await check('actual executor waits for database acknowledgement before create; lost acknowledgement creates no VM', async () => {
    const approved = { compiler: { image: `team/compiler@sha256:${'a'.repeat(64)}`, runtimeImageId: `sha256:${'b'.repeat(64)}`, evidenceSha256: 'c'.repeat(64) },
      renderer: { image: `team/renderer@sha256:${'d'.repeat(64)}`, rendererId: `chromium-144.0.1-controller-${'e'.repeat(64)}`, evidenceSha256: 'f'.repeat(64) } };
    for (const lost of [false, true]) {
      let acknowledge, announce; let creates = 0;
      const arrived = new Promise(resolve => { announce = resolve; });
      const journal = publicationLifecycleJournal(async (_name, args) => {
        if (args.p_record.state === 'creating') { announce(); await new Promise((resolve, reject) => { acknowledge = () => lost ? reject(Error('lost DB response')) : resolve(); }); }
        return args.p_record;
      });
      const executor = vercelPublicationExecutor({ approved, context: { preparationId: randomUUID(), workerId, fence: '1', leaseUntil: iso(Date.now() + 290000) },
        transport: { async create() { creates++; throw Error('synthetic unknown create'); }, async get() { throw Error('synthetic 404'); } }, onLifecycle: journal });
      const running = executor.render({ origin: 'https://synthetic.example', path: '/', indexHtml: '<html><body>synthetic</body></html>', files: [], signal: signal() });
      const rejected = assert.rejects(running);
      await arrived; assert.equal(creates, 0); acknowledge(); await rejected; assert.equal(creates, lost ? 0 : 1);
    }
  });
  await check('control only acknowledges journal after COMMIT; lost COMMIT response destroys connection', async () => {
    const original = record(), statements = [], releases = [];
    const rpc = publicationControl({ async connect() { return { async query(sql) { statements.push(sql); if (sql === 'COMMIT') throw Error('lost commit response'); return { rows: [{ result: original }] }; }, release: destroy => releases.push(destroy) }; } });
    await assert.rejects(publicationLifecycleJournal(rpc)(original), /lost commit response/);
    assert.equal(statements.at(-1), 'COMMIT'); assert.deepEqual(releases, [true]);
  });
  await check('hidden pending resources block; database-excluded active peers represented by pending zero permit work', async () => {
    let gets = 0;
    for (const pending of [1, 5]) await assert.rejects(publicationCleanupGate({ rpc: async () => ({ records: [], pending }), transport: { get: async () => gets++ } })(workerId, signal()), /CLEANUP_PENDING/);
    await publicationCleanupGate({ rpc: async () => ({ records: [], pending: 0 }), transport: { get: async () => gets++ } })(workerId, signal());
    assert.equal(gets, 0);
  });
  await check('SDK terminal status and exact returned session ID are required before stopped acknowledgement', async () => {
    for (const status of ['stopped', 'failed', 'aborted']) { const f = fixture({ stopStatus: status }); await f.gate()(workerId, signal()); assert.deepEqual(f.finishes, ['stopped']); assert.equal(f.pending(), false); }
    for (const status of ['running', 'stopping', 'pending', 'snapshotting']) { const f = fixture({ stopStatus: status }); await assert.rejects(f.gate()(workerId, signal()), /CLEANUP_UNCONFIRMED/); assert.deepEqual(f.finishes, ['cleanup_unconfirmed']); assert.equal(f.pending(), true); }
    const f = fixture({ wrongStopId: true }); await assert.rejects(f.gate()(workerId, signal()), /CLEANUP_UNCONFIRMED/); assert.equal(f.pending(), true);
  });
  await check('recovery cannot stop another name or another known durable session', async () => {
    for (const option of ['wrongName', 'differentSession']) { const f = fixture({ [option]: true }); await assert.rejects(f.gate()(workerId, signal()), /CLEANUP_UNCONFIRMED/); assert.equal(f.calls.filter(call => call.name === 'stop').length, 0, option); assert.deepEqual(f.finishes, ['cleanup_unconfirmed']); }
  });
  await check('unknown-create intent without session remains recoverable by exact name', async () => {
    const original = record(); delete original.sessionId; delete original.providerExpiresAt;
    let pending = true, stops = 0;
    const gate = publicationCleanupGate({ now: () => now, rpc: async (name, args) => {
      if (name.endsWith('_claim')) return pending ? { records: [claim(original)], pending: 1 } : { records: [], pending: 0 };
      assert.equal(args.p_state, 'stopped'); pending = false; return { ...original, state: 'stopped' };
    }, transport: { async get() { return { name: original.name, currentSession: () => ({ sessionId: 'recovered' }), async stop() { stops++; return { id: 'recovered', status: 'stopped' }; } }; } } });
    await gate(workerId, signal()); assert.equal(stops, 1);
  });
  await check('404, stop failure and lost finish response preserve unresolved cleanup', async () => {
    for (const option of ['getError', 'stopError', 'finishError']) { const f = fixture({ [option]: true }); await assert.rejects(f.gate()(workerId, signal()), /CLEANUP_UNCONFIRMED/); assert.equal(f.pending(), true); assert.equal(f.finishes.at(-1), 'cleanup_unconfirmed'); }
  });
  await check('invalid pending envelopes, stale cleanup lease and bigint overflow fail before SDK', async () => {
    const original = record(); let gets = 0;
    const malformed = [null, { records: [], pending: -1 }, { records: [], pending: '1' }, { records: [], pending: 0, extra: true },
      { records: [claim(original)], pending: 0 }, { records: [claim(original), claim(original)], pending: 2 },
      { records: [{ ...claim(original), cleanupFence: '9223372036854775808' }], pending: 1 },
      { records: [{ ...claim(original), cleanupLeaseUntil: iso(now + 9000) }], pending: 1 }];
    for (const response of malformed) await assert.rejects(publicationCleanupGate({ now: () => now, rpc: async () => response, transport: { get: async () => gets++ } })(workerId, signal()), /JOURNAL_INVALID/);
    assert.equal(gets, 0);
  });
  await check('pass bound claims exactly its capacity and never leaks an extra unattempted claim', async () => {
    const f = fixture();
    await assert.rejects(publicationCleanupGate({ rpc: f.rpc, transport: f.transport, now: () => now, maxPerPass: 1 })(workerId, signal()), /CLEANUP_PENDING/);
    assert.equal(f.calls.filter(call => call.name.endsWith('_claim')).length, 1); assert.deepEqual(f.finishes, ['stopped']);
    await f.gate()(workerId, signal()); assert.equal(f.calls.filter(call => call.name === 'stop').length, 1);
  });
  await check('beforeRun cleanup failure blocks the next candidate outside the per-attempt catch', async () => {
    const ids = [randomUUID(), randomUUID()], controller = new AbortController(), runs = [], events = [];
    let pending = 0;
    const gate = publicationCleanupGate({ rpc: async () => ({ records: [], pending }), transport: { get: async () => assert.fail('must not discover active peers') } });
    await supervisePublications({ workerId, signal: controller.signal, rpc: async () => ids.map(id => ({ id })), beforePoll: gate, beforeRun: gate,
      run: async id => { runs.push(id); pending = 1; throw Error('PUBLICATION_CLEANUP_UNCONFIRMED'); }, emit: event => events.push(event), wait: async () => controller.abort() });
    assert.deepEqual(runs, [ids[0]]); assert.equal(events.filter(event => event.type === 'attempt_started').length, 1); assert.ok(events.some(event => event.type === 'control_unavailable'));
  });
  await check('pre-aborted gate starts no cleanup claim', async () => {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(publicationCleanupGate({ rpc: async () => assert.fail('no claim after abort'), transport: { get: async () => assert.fail() } })(workerId, controller.signal));
  });
  await check('host composition mandates cleanup before discovery and every run, with durable lifecycle injected', async () => {
    const controller = new AbortController(), ids = [randomUUID(), randomUUID()], calls = [], runs = [];
    let pending = 0;
    const approved = { compiler: { image: `team/compiler@sha256:${'a'.repeat(64)}`, runtimeImageId: `sha256:${'b'.repeat(64)}`, evidenceSha256: 'c'.repeat(64) },
      renderer: { image: `team/renderer@sha256:${'d'.repeat(64)}`, rendererId: `chromium-144.0.1-controller-${'e'.repeat(64)}`, evidenceSha256: 'f'.repeat(64) } };
    const pool = { async connect() { return { async query(sql, args) {
      if (!sql.startsWith('SELECT public.')) return { rows: [] };
      if (sql.includes('_cleanup_claim(')) { calls.push('cleanup'); return { rows: [{ result: { records: [], pending } }] }; }
      if (sql.includes('_candidates(')) { calls.push('candidates'); return { rows: [{ result: ids.map(id => ({ id })) }] }; }
      assert.ok(sql.includes('_sandbox_event('));
      const value = JSON.parse(args[0]); calls.push(value.state); if (value.state === 'cleanup_unconfirmed') pending = 1;
      return { rows: [{ result: value }] };
    }, release() {} }; } };
    const transport = { async create() { calls.push('create'); assert.equal(calls.at(-2), 'creating'); throw Error('unknown create outcome'); }, async get() { throw Object.assign(Error('not found'), { status: 404 }); } };
    const store = { async putIfAbsent() { assert.fail('no output expected'); }, async get() { assert.fail('no output expected'); } };
    await runPublicationController({ pool, transport, approved, store, sitesDomain: 'makeborne.site', workerId, signal: controller.signal,
      resolveArtwork: async () => [], wait: async () => controller.abort(),
      runPreparation: async (id, owner, deps, abort) => {
        runs.push(id); assert.equal(owner, workerId); assert.equal(deps.address('example'), 'https://example.makeborne.site/');
        const executor = await deps.executor({ preparationId: id, workerId, fence: '1', leaseUntil: iso(Date.now() + 290000) }, abort);
        assert.equal(executor.store, store); assert.equal(executor.sitesDomain, 'makeborne.site');
        await executor.render({ origin: 'https://example.makeborne.site', path: '/', indexHtml: '<html><body>synthetic</body></html>', files: [], signal: abort });
        assert.fail('unknown create must not complete');
      } });
    assert.deepEqual(runs, [ids[0]]); assert.deepEqual(calls, ['cleanup', 'candidates', 'cleanup', 'creating', 'create', 'cleanup_unconfirmed', 'cleanup']);
  });
  console.log(`${passed} publication journal groups passed; SQL/RPC and SDK transport are doubles, no live qualification.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
