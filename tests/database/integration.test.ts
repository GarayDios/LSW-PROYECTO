import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPersistenceHandlers } from '../../src/api/persistence/handler.ts';
import { createDefaultState } from '../../src/db/state.ts';
import { SupabaseRepository } from '../../src/db/supabase/client.ts';
import { createCycle, defaultCycleConfig } from '../../src/cores/07-gestion-de-portafolio/cycle-simulator.ts';
import { companies } from '../../src/features/market/data.ts';
import { snapshotInputSchema } from '../../services/mongo-api/model.ts';

test('HTTP repository and real PostgreSQL migration preserve cycles and replay archives after an outage', async () => {
  const database = new PGlite();
  try {
    await database.exec('create role anon; create role authenticated; create role service_role;');
    await database.exec(await readFile(new URL('../../supabase/migrations/202611130001_terminal_persistence.sql', import.meta.url), 'utf8'));
    await database.exec('set role service_role');
    const archives = new Map<string, unknown>();
    let available = false;
    const transport: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const body = JSON.parse(init?.body as string);
      if (url.hostname === 'archive.test') {
        if (!available) return Response.json({ error: 'unavailable' }, { status: 503 });
        const snapshot = snapshotInputSchema.parse(body);
        archives.set(snapshot.id, snapshot);
        return Response.json({ id: snapshot.id, status: 'created' }, { status: 201 });
      }
      const calls: Record<string, [string, unknown[]]> = {
        load_terminal_state: ['select public.load_terminal_state($1) as result', [body.p_owner_id]],
        save_terminal_state: ['select public.save_terminal_state($1,$2,$3,$4,$5::jsonb) as result', [body.p_owner_id, body.p_display_name, body.p_email, body.p_expected_revision, JSON.stringify(body.p_state)]],
        list_analysis_outbox: ['select public.list_analysis_outbox($1,$2) as result', [body.p_owner_id, body.p_limit]],
        mark_analysis_delivered: ['select public.mark_analysis_delivered($1,$2::uuid[]) as result', [body.p_owner_id, body.p_ids]],
      };
      const call = calls[url.pathname.split('/').at(-1)!];
      assert.ok(call, 'only expected RPCs are invoked');
      try {
        const { rows } = await database.query<{ result: unknown }>(call[0], call[1]);
        return Response.json(rows[0].result ?? null);
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
        return Response.json({ code }, { status: code === 'PT409' ? 409 : 400 });
      }
    };
    const config = { supabaseUrl: 'https://postgres.test', supabaseKey: 'sb_secret_test_only_not_a_real_key', mongoBridge: { url: 'https://archive.test', token: 'test-only-shared-token-with-32-characters' } };
    const api = createPersistenceHandlers({
      config: () => config, owner: async () => ({ id: 'integration-user', displayName: 'Ana', email: 'ana@example.test' }),
      repository: () => new SupabaseRepository(config, transport), fetcher: transport,
    });
    const state = createDefaultState();
    state.lists[0].research = {
      source: 'alpaca', generatedAt: '2026-11-13T16:00:00Z', cutoff: '2026-11-09T23:59:59Z',
      warnings: ['Datos de opciones no disponibles para el corte histórico.'], excluded: [{ symbol: 'AAPL', reason: 'Proveedor no disponible.' }],
      snapshots: { NVDA: { spot: 150, iv: null, score: null, probabilityOfProfit: null, probabilityLabel: 'Una pierna neutral al riesgo; no pronóstico.', contractSymbol: null,
        missing: ['dividendYield', 'options.contracts'], sources: ['Alpaca IEX'] } },
    };
    state.cycles.push(createCycle({ ...defaultCycleConfig(companies[0], 'wheel'), id: 'roundtrip-wheel' }));
    state.orders.push({ id: 'roundtrip-order', symbol: 'NVDA', side: 'buy', type: 'call', strike: 150, expiry: '2026-12-11', quantity: 1, premium: 2, total: 200, createdAt: '2026-11-13T12:00:00Z', status: 'Simulada', operationStart: '2026-11-09', operationEnd: '2026-12-11', startTime: '09:30', endTime: '16:00' });
    const put = () => api.PUT(new Request('https://terminal.test/api/persistence', { method: 'PUT', headers: { Origin: 'https://terminal.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 0, state }) }));
    assert.equal((await put()).status, 200, 'Mongo outage does not fail the committed state');
    const offline = await (await api.GET()).json() as { state: unknown; revision: number; archive: { pending: number } };
    assert.deepEqual(offline.state, state);
    assert.equal(offline.revision, 1);
    assert.equal(offline.archive.pending, 1);
    assert.equal(archives.size, 0);
    available = true;
    const recovered = await (await api.GET()).json() as { state: unknown; archive: { pending: number } };
    assert.deepEqual(recovered.state, state);
    assert.equal(recovered.archive.pending, 0);
    assert.equal(archives.size, 1);
    assert.equal((await put()).status, 409, 'replaying a stale state cannot replace a cycle');
    assert.equal(archives.size, 1, 'a conflict does not generate another archive');
  } finally { await database.close(); }
});
