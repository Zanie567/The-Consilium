#!/usr/bin/env python3
"""Local CPU benchmark for a Next production build (docs/operations/vercel-cpu-optimisation-2026-11.md).

Usage: python3 scripts/perf/cpu-bench.py <distDir> <label> [--warm N] [--cold] [--out DIR]

LOCAL ONLY. Starts `next start` for an already built <distDir> (NEXT_DIST_DIR) on localhost with the
environment in $BENCH_ENV_FILE (lines `export KEY=value`; DATABASE_URL must point at a throwaway
local database seeded by scripts/setup-test-db.sh, never .env.local), then measures the server
process tree's CPU (user+sys, from ps, 10 ms resolution) around requests.
Warm: N sequential requests per case after 5 warm-ups. Cold: a fresh server per case, CPU of the
first request only (route loading included, boot excluded). Never point it at a remote URL.
"""
import json, os, subprocess, sys, time, urllib.parse, urllib.request, urllib.error, signal

WT = os.getcwd()
ENVF = os.environ.get('BENCH_ENV_FILE', '')
PORT = int(os.environ.get('BENCH_PORT', '3471'))
BASE = f'http://localhost:{PORT}'

CASES = [
    ('home html', '/', {}),
    ('home rsc prefetch', '/', {'RSC': '1', 'Next-Router-Prefetch': '1'}),
    ('article html', '/articles/{article}', {}),
    ('article rsc prefetch', '/articles/{article}', {'RSC': '1', 'Next-Router-Prefetch': '1'}),
    ('category html', '/category/opinion', {}),
    ('category rsc prefetch', '/category/opinion', {'RSC': '1', 'Next-Router-Prefetch': '1'}),
    ('tag html', '/tag/{tag}', {}),
    ('author html', '/author/{author}', {}),
    ('archive html', '/archive', {}),
    ('team html', '/team', {}),
    ('privacy html (static)', '/privacy', {}),
    ('publish-scheduled (idle)', '/api/publish-scheduled', {'Authorization': 'Bearer local-cron-secret', '__method': 'POST'}),
    ('analytics track', '/api/analytics/track', {'__method': 'POST', 'Content-Type': 'application/json', '__body': 'TRACK'}),
    ('ticker markets', '/api/ticker/markets', {}),
    ('auth session (anon)', '/api/auth/session', {}),
]


def fixtures(e):
    """Slugs from the local test database (the seed's ids are generated per run)."""
    url = e['DATABASE_URL']
    host = urllib.parse.urlparse(url).hostname
    if host not in ('localhost', '127.0.0.1'):
        raise SystemExit(f'refusing a non-local database host: {host}')
    q = lambda sql: subprocess.run(['psql', url, '-Atc', sql], capture_output=True, text=True, check=True).stdout.strip().splitlines()[0]
    pub = "status='PUBLISHED' and \"deletedAt\" is null"
    return {
        'article': q(f"select slug from articles where {pub} order by \"publishedAt\" desc nulls last limit 1"),
        'author': q(f"select coalesce(u.slug, u.id) from users u join articles a on a.\"authorId\" = u.id where a.{pub} limit 1"),
        'tag': q(f"select t.slug from tags t join article_tags x on x.\"tagId\" = t.id join articles a on a.id = x.\"articleId\" where a.{pub} limit 1"),
    }


def env():
    if not ENVF:
        raise SystemExit('set BENCH_ENV_FILE to a local-only environment file')
    e = dict(os.environ)
    for line in open(ENVF):
        line = line.strip()
        if line.startswith('export '):
            k, v = line[7:].split('=', 1)
            e[k] = v
    return e


def tree_cpu(pid):
    out = subprocess.run(['ps', '-A', '-o', 'pid=,ppid=,time='], capture_output=True, text=True).stdout
    procs = {}
    for l in out.splitlines():
        p, pp, t = l.split()
        procs[int(p)] = (int(pp), t)
    want = {pid}
    changed = True
    while changed:
        changed = False
        for p, (pp, _) in procs.items():
            if pp in want and p not in want:
                want.add(p); changed = True
    total = 0.0
    for p in want:
        if p in procs:
            t = procs[p][1]
            parts = t.split(':')
            secs = float(parts[-1]) + (int(parts[-2]) * 60 if len(parts) > 1 else 0) + (int(parts[-3]) * 3600 if len(parts) > 2 else 0)
            total += secs
    return total * 1000.0  # ms


def start(dist):
    try:
        urllib.request.urlopen(BASE + '/robots.txt', timeout=1)
        raise SystemExit('port already in use: refusing to benchmark another server')
    except urllib.error.URLError:
        pass
    e = env(); e['NEXT_DIST_DIR'] = dist
    p = subprocess.Popen(['node', 'node_modules/next/dist/bin/next', 'start', '-p', str(PORT)], cwd=WT, env=e,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    for _ in range(200):
        try:
            urllib.request.urlopen(BASE + '/robots.txt', timeout=2).read(); break
        except Exception:
            time.sleep(0.1)
    time.sleep(1.5)
    return p


def stop(p):
    try: os.killpg(p.pid, signal.SIGTERM)
    except Exception: pass
    p.wait(timeout=10)
    for _ in range(50):
        try:
            urllib.request.urlopen(BASE + '/robots.txt', timeout=0.5); time.sleep(0.2)
        except Exception:
            return


_visit = [0]

def req(path, headers):
    h = dict(headers)
    method = h.pop('__method', 'GET')
    body = h.pop('__body', None)
    data = None
    if body == 'TRACK':
        _visit[0] += 1
        data = json.dumps({'type': 'site', 'path': '/', 'visitId': f'bench-{os.getpid()}-{_visit[0]}', 'sessionId': f'benchsess{_visit[0] % 50}'}).encode()
        h['Origin'] = BASE
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            resp.read(); return resp.status
    except urllib.error.HTTPError as err:
        return err.code


def warm(dist, n):
    p = start(dist)
    res = {}
    try:
        for name, path, h in CASES:
            for _ in range(5): req(path, h)
            time.sleep(0.3)
            c0 = tree_cpu(p.pid); t0 = time.time()
            statuses = set()
            for _ in range(n): statuses.add(req(path, h))
            time.sleep(0.3)  # let background revalidation finish
            c1 = tree_cpu(p.pid); t1 = time.time()
            res[name] = {'cpu_ms': round((c1 - c0) / n, 2), 'wall_ms': round((t1 - t0) * 1000 / n, 1), 'status': sorted(statuses)}
            print(f'{name:28s} cpu={res[name]["cpu_ms"]:7.2f} ms  wall={res[name]["wall_ms"]:7.1f} ms  {sorted(statuses)}', flush=True)
    finally:
        stop(p)
    return res


def cold(dist):
    res = {}
    for name, path, h in CASES:
        p = start(dist)
        try:
            c0 = tree_cpu(p.pid)
            s = req(path, h)
            time.sleep(0.5)
            c1 = tree_cpu(p.pid)
            res[name] = {'cpu_ms': round(c1 - c0, 1), 'status': s}
            print(f'COLD {name:28s} cpu={c1 - c0:8.1f} ms  {s}', flush=True)
        finally:
            stop(p)
    return res


if __name__ == '__main__':
    dist, label = sys.argv[1], sys.argv[2]
    n = int(sys.argv[sys.argv.index('--warm') + 1]) if '--warm' in sys.argv else 0
    slugs = fixtures(env())
    CASES[:] = [(name, path.format(**slugs), h) for name, path, h in CASES]
    out = {'dist': dist, 'label': label, 'at': time.strftime('%Y-%m-%dT%H:%M:%S'), 'fixtures': slugs}
    if n: out['warm'] = warm(dist, n)
    if '--cold' in sys.argv: out['cold'] = cold(dist)
    outdir = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else '.'
    path = os.path.join(outdir, f'cpu-bench-{label}.json')
    json.dump(out, open(path, 'w'), indent=1)
    print('wrote', path)
