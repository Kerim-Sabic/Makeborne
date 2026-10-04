"""Opt-in local-only, real two-session reservation races. No external calls."""
import concurrent.futures
import datetime
import json
import os
import subprocess
import time
import uuid

if os.environ.get('MAKEBORNE_VERIFY_LOCAL_FIXTURES') != 'true':
    raise SystemExit('Set MAKEBORNE_VERIFY_LOCAL_FIXTURES=true for isolated local fixtures.')

CONTAINER = 'supabase_db_makeborne-local'
BASE = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1']
def run(sql, check=True):
    result = subprocess.run(BASE, input=sql, text=True, encoding='utf-8', capture_output=True, timeout=25)
    if check and result.returncode:
        raise RuntimeError(result.stderr)
    return result

def literal(value):
    return "'" + str(value).replace("'", "''") + "'"

def uid(): return str(uuid.uuid4())
owner, workspace, project, artifact = [uid() for _ in range(4)]
proposals = [uid() for _ in range(3)]
hashes = [letter * 64 for letter in 'bcd']
now = datetime.datetime.now(datetime.timezone.utc)
start, end = now.isoformat(), (now + datetime.timedelta(hours=1)).isoformat()
created = False

def call(index, key):
    args = [proposals[index], key, owner, hashes[index], 'a' * 64]
    return 'select makeborne_private.reserve_generation_proposal(' + ','.join(map(literal,args)) + ');'

def race(first_sql, second_sql):
    app = 'makeborne_race_' + uuid.uuid4().hex
    first = subprocess.Popen(BASE, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
    try:
        first.stdin.write('begin; set local role service_role; ' + first_sql + ' select pg_sleep(4); commit;')
        first.stdin.close()
        first_id = first.stdout.readline().strip()
        uuid.UUID(first_id)
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(run, f"set application_name={literal(app)}; set role service_role; " + second_sql, False)
            saw_wait = False
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                state = run(f"select count(*) from pg_stat_activity where application_name={literal(app)} and wait_event_type='Lock';").stdout.strip()
                if state == '1':
                    saw_wait = True
                    break
                if pending.done(): break
                time.sleep(.05)
            second = pending.result(timeout=20)
        first.wait(timeout=15)
        if first.returncode: raise RuntimeError(first.stderr.read())
        assert saw_wait, 'Did not observe a real blocked concurrent session'
        return first_id, second
    finally:
        if first.poll() is None:
            first.kill()
            first.wait()

try:
    statements = [
        'begin;',
        f"insert into auth.users(id,email) values('{owner}','race-{owner}@example.invalid');",
        f"insert into public.workspaces(id,name,owner_id) values('{workspace}','Local concurrency fixture','{owner}');",
        f"insert into public.projects(id,workspace_id,title,kind) values('{project}','{workspace}','Fixture','website');",
        f"insert into public.artifacts(id,workspace_id,project_id,title,kind) values('{artifact}','{workspace}','{project}','Fixture','website');",
        f"insert into makeborne_private.generation_budgets(workspace_id,spending_enabled,vendor_limit,credit_limit,concurrency_limit) values('{workspace}',true,24,6,10);",
    ]
    for proposal, digest in zip(proposals, hashes):
        snapshot = {'version':'generation-proposal-v1','inputHash':'a'*64,'approvalHash':digest,'input':{'scope':{'workspaceId':workspace,'projectId':project,'artifactId':artifact},'baseVersionId':None},'workflow':{'version':'workflow-v1','output':'website','approved':False,'maximumVendorMicrousd':'12','maximumCustomerCredits':'3','preparedAt':start,'expiresAt':end,'stages':[{}, {}, {}]}}
        statements.append(f"insert into makeborne_private.generation_proposals(id,workspace_id,project_id,artifact_id,input_hash,approval_hash,snapshot,maximum_vendor_microusd,maximum_customer_credits,prepared_at,expires_at) values('{proposal}','{workspace}','{project}','{artifact}','{'a'*64}','{digest}',{literal(json.dumps(snapshot))}::jsonb,12,3,'{start}','{end}');")
    run('\n'.join(statements) + '\ncommit;')
    created = True
    key = uid()
    first_id, duplicate = race(call(0,key), call(0,key))
    assert duplicate.returncode == 0 and duplicate.stdout.strip() == first_id, duplicate.stderr
    assert run(f"select vendor_reserved||','||credit_reserved||','||active_reservations||','||revision from makeborne_private.generation_budgets where workspace_id='{workspace}';").stdout.strip() == '12,3,1,1'
    print('PASS observed lock wait: concurrent duplicate reserves once')
    _, competing = race(call(1,uid()), call(2,uid()))
    assert competing.returncode != 0 and 'Insufficient generation budget' in competing.stderr, competing.stderr
    assert run(f"select vendor_reserved||','||credit_reserved||','||active_reservations||','||revision from makeborne_private.generation_budgets where workspace_id='{workspace}';").stdout.strip() == '24,6,2,2'
    assert run(f"select count(*) from makeborne_private.generation_reservations where workspace_id='{workspace}';").stdout.strip() == '2'
    print('PASS observed lock wait: competing proposals cannot exceed shared budget')
    release = f"select makeborne_private.release_generation_reservation('{first_id}','{owner}','Concurrent cancellation');"
    released, duplicate_release = race(release, release)
    assert released == first_id and duplicate_release.returncode == 0 and duplicate_release.stdout.strip() == first_id
    assert run(f"select vendor_reserved||','||credit_reserved||','||active_reservations||','||revision from makeborne_private.generation_budgets where workspace_id='{workspace}';").stdout.strip() == '12,3,1,3'
    print('PASS observed lock wait: concurrent cancellation releases balances once')

    remaining = run(f"select id from makeborne_private.generation_reservations where workspace_id='{workspace}' and status='reserved';").stdout.strip()
    dispatch_key = uid()
    dispatch = f"select result->>'dispatchId' from (select makeborne_private.claim_generation_dispatch('{remaining}','{dispatch_key}','{owner}','{hashes[1]}','{'a'*64}') result) d where (result->>'claimed')::boolean;"
    claimed, duplicate_dispatch = race(dispatch, dispatch)
    assert duplicate_dispatch.returncode == 0 and duplicate_dispatch.stdout.strip() == '', duplicate_dispatch.stderr
    assert run(f"select count(*) from makeborne_private.generation_dispatches where reservation_id='{remaining}';").stdout.strip() == '1'
    assert run(f"select status from makeborne_private.generation_reservations where id='{remaining}';").stdout.strip() == 'uncertain'
    assert run(f"select vendor_reserved||','||credit_reserved||','||active_reservations||','||revision from makeborne_private.generation_budgets where workspace_id='{workspace}';").stdout.strip() == '12,3,1,3'
    print('PASS observed lock wait: only one concurrent worker receives a dispatch claim')

finally:
    if created:
        run(f"""begin;
        delete from makeborne_private.generation_dispatches where reservation_id in (select id from makeborne_private.generation_reservations where workspace_id='{workspace}');
        delete from makeborne_private.generation_reservations where workspace_id='{workspace}';
        delete from makeborne_private.generation_budgets where workspace_id='{workspace}';
        delete from makeborne_private.generation_proposals where workspace_id='{workspace}';
        delete from public.artifacts where workspace_id='{workspace}';
        delete from public.projects where workspace_id='{workspace}';
        delete from public.workspaces where id='{workspace}';
        delete from auth.users where id='{owner}';
        commit;""")
        assert run(f"select count(*) from public.workspaces where id='{workspace}';").stdout.strip() == '0'
        print('PASS generated local fixture removed; no enabled fixture budget remains')
