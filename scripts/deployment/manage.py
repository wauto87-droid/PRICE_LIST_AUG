#!/usr/bin/env python3
"""Project-scoped deployment. Python standard library only; never shells out with secrets."""
import argparse
import contextlib
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tarfile
import time
import queue
import threading
import signal
import socket
import tempfile
import stat
from urllib.parse import urlsplit
import ipaddress
from collections import deque

REPORT = None

class Diagnostics:
    """Only explicitly public command output is streamed; all other output stays captured."""
    def __init__(self, verbose=False, heartbeat=10):
        self.verbose = verbose
        self.heartbeat = heartbeat
        self.path = None
        self.stream = None
        self.number = 0
        self.stage_name = 'Preflight'
        self.secrets = set()
        self.private_block = False
        self.tail = deque(maxlen=12)

    def protect(self, values):
        for key, value in values.items():
            if any(word in key.upper() for word in ('PASSWORD', 'TOKEN', 'SECRET', 'DATABASE_URL')) and value:
                self.secrets.add(value)

    def redact(self, text):
        text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text)
        if '-----BEGIN ' in text and 'PRIVATE KEY' in text:
            self.private_block = True
        if self.private_block:
            if '-----END ' in text and 'PRIVATE KEY' in text:
                self.private_block = False
            return '[REDACTED private key]'
        for value in sorted(self.secrets, key=len, reverse=True):
            text = text.replace(value, '[REDACTED]')
        text = re.sub(r'(?i)(?:password|passwd|secret|token|authorization|database_url)[\w-]*[\s\"\x27]*[:=].*', '[REDACTED credential assignment]', text)
        text = re.sub(r'(?i)([a-z][a-z0-9+.-]*://)[^\s/@]+:[^\s/@]+@', r'\1[REDACTED]@', text)
        text = re.sub(r'(?i)\bBearer\s+\S+', 'Bearer [REDACTED]', text)
        return re.sub(r'\b[a-fA-F0-9]{64}\b', '[REDACTED]', text)

    def emit(self, text):
        safe = self.redact(text)
        print(safe, flush=True)
        if self.stream:
            self.stream.write(safe + '\n')
            self.stream.flush()
        self.tail.append(safe)

    def stage(self, name):
        self.number += 1
        self.stage_name = name
        self.tail.clear()
        self.emit(f'==> [{self.number}] {name}')

    def open(self, root):
        if self.stream:
            return
        directory = root / 'logs'
        require(not directory.is_symlink(), 'Unsafe log directory')
        directory.mkdir(mode=0o700, exist_ok=True)
        require(directory.stat().st_mode & 0o077 == 0, 'Logs directory must be private mode 0700')
        if os.name == 'posix':
            require(directory.stat().st_uid == 0, 'Logs directory must be root-owned')
        self.path = directory / (dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + secrets.token_hex(4) + '.log')
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        self.stream = os.fdopen(fd, 'w', encoding='utf-8')
        self.emit(f'Diagnostic log: {self.path}')

    def close(self):
        if self.stream:
            self.stream.close()
            self.stream = None

    def command(self, args, *, data, output, timeout, check, live, env, cwd):
        started = time.monotonic()
        events = queue.Queue()
        if self.verbose:
            self.emit(f'    Starting {Path(str(args[0])).name}; timeout {timeout}s (arguments hidden)')
        process = subprocess.Popen([str(a) for a in args], stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,
                                   stdout=output or subprocess.PIPE, stderr=subprocess.STDOUT if live else subprocess.PIPE,
                                   start_new_session=os.name == 'posix', env=env, cwd=cwd)

        def collect():
            try:
                if live:
                    # Buffer complete lines before redaction, including split UTF-8/secret chunks.
                    pending = b''
                    dropping = False
                    while True:
                        chunk = process.stdout.read1(4096)
                        if not chunk:
                            break
                        pending += chunk
                        while b'\n' in pending:
                            line, pending = pending.split(b'\n', 1)
                            events.put(('line', '[oversized line omitted]' if dropping or len(line) > 65536 else line.decode('utf-8', errors='replace')))
                            dropping = False
                        if len(pending) > 65536:
                            pending = b''
                            dropping = True
                    if pending or dropping:
                        events.put(('line', '[oversized line omitted]' if dropping else pending.decode('utf-8', errors='replace')))
                    process.wait()
                    events.put(('done', (b'', b'')))
                else:
                    events.put(('done', process.communicate(input=data)))
            except Exception:
                events.put(('error', None))

        reader = threading.Thread(target=collect, daemon=True)
        reader.start()
        last_notice = started
        try:
            while True:
                now = time.monotonic()
                if now - started >= timeout:
                    raise DeployError(f'{self.stage_name}: {args[0]} timed out after {timeout}s')
                try:
                    kind, value = events.get(timeout=min(0.2, max(0.001, timeout - (now - started))))
                except queue.Empty:
                    kind, value = None, None
                if kind == 'line':
                    self.emit(value)
                    last_notice = time.monotonic()
                elif kind == 'done':
                    result = subprocess.CompletedProcess(args, process.returncode, *value)
                    if check and result.returncode:
                        raise DeployError(f'{self.stage_name}: {args[0]} failed (exit {result.returncode})' + ('' if live else '; sensitive/captured output withheld'))
                    if self.verbose:
                        self.emit(f'    Finished {Path(str(args[0])).name}: exit {result.returncode}, {time.monotonic() - started:.1f}s')
                    return result
                elif kind == 'error':
                    raise DeployError(f'{self.stage_name}: output collection failed')
                if time.monotonic() - last_notice >= self.heartbeat:
                    self.emit(f'    {self.stage_name}: still working ({int(time.monotonic() - started)}s elapsed)')
                    last_notice = time.monotonic()
        finally:
            if os.name == 'posix' and (process.poll() is None or reader.is_alive()):
                # Only this command's new process group; never other VPS services.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if process.poll() is None:
                process.kill()
                process.wait()
            reader.join(timeout=2)
            for stream in (process.stdin, process.stdout, process.stderr):
                if stream and not stream.closed:
                    stream.close()

ROOT = Path('/opt/shop-pricelist')
PROJECT = 'amt-pricelist'
DB_IMAGE = 'docker.io/library/postgres:17-bookworm'
BASE_PATH = '/amt_price_list'
SERVICES = ('app', 'worker', 'backup')
PM2_PROCESSES = ('amt-pricelist-app', 'amt-pricelist-worker')
MEMORY_MIB = {'db': 512, 'app': 768, 'worker': 1024, 'backup': 256}
DEFAULT_DB_PORT = '15432'
MIN_PM2_NODE = (24, 0, 0)
ENV_KEYS = {'POSTGRES_USER', 'POSTGRES_DB', 'POSTGRES_PASSWORD', 'DATABASE_URL', 'SETUP_TOKEN', 'APP_PORT', 'APP_ORIGIN', 'APP_BASE_PATH', 'COOKIE_SECURE', 'PDF_MAX_PAGES', 'UPLOAD_MAX_MB', 'BACKUP_RETENTION_DAYS', 'UPLOAD_DIR', 'BACKUP_DIR', 'APP_RUNTIME', 'DB_HOST', 'DB_PORT', 'PM2_APP_INSTANCES'}

class DeployError(Exception):
    pass

def require(condition, message):
    if not condition:
        raise DeployError(message)


def parse_semver(text):
    match = re.search(r'v?(\d+)\.(\d+)\.(\d+)', text.strip())
    require(match is not None, f'Unrecognized version output: {text!r}')
    return tuple(int(part) for part in match.groups())

def run(args, *, data=None, output=None, timeout=300, check=True, live=False, env=None, cwd=None):
    # No command includes credentials. Do not echo raw stderr: engines can render env values.
    try:
        if REPORT:
            require(not live or (data is None and output is None), 'Cannot stream secret input or binary output')
            return REPORT.command(args, data=data, output=output, timeout=timeout, check=check, live=live, env=env, cwd=cwd)
        result = subprocess.run([str(a) for a in args], input=data, stdout=output or subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout, check=False, env=env, cwd=cwd)
    except (OSError, subprocess.TimeoutExpired):
        raise DeployError(f'{args[0]} failed or timed out; no credentials were logged') from None
    if check and result.returncode:
        raise DeployError(f'{args[0]} operation failed (exit {result.returncode}); stopped safely')
    return result

def decoded(result):
    return (result.stdout or b'').decode('utf-8').strip()

def app_runtime(values):
    return values.get('APP_RUNTIME') or 'compose'


def runtime_for_env(values, override=None):
    return override or app_runtime(values)

def database_url(values):
    if app_runtime(values) == 'pm2':
        host = values.get('DB_HOST', '127.0.0.1')
        port = values.get('DB_PORT', DEFAULT_DB_PORT)
        return (f"postgresql://{values['POSTGRES_USER']}:{values['POSTGRES_PASSWORD']}@"
                f"{host}:{port}/{values['POSTGRES_DB']}")
    return (f"postgresql://{values['POSTGRES_USER']}:{values['POSTGRES_PASSWORD']}@/"
            f"{values['POSTGRES_DB']}?host=%2Fvar%2Frun%2Fpostgresql")

def atomic(path, data):
    path = Path(path)
    require(not path.is_symlink(), f'Refusing symlink: {path.name}')
    temp = path.with_name(path.name + '.' + secrets.token_hex(6) + '.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data.encode() if isinstance(data, str) else data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
        if os.name == 'posix':
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if temp.exists():
            temp.unlink()

def read_env(path):
    require(path.is_file() and not path.is_symlink(), 'Private environment file missing or unsafe')
    require(path.stat().st_mode & 0o077 == 0, 'Environment must have mode 0600')
    values = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, sep, value = line.partition('=')
        require(sep and key in ENV_KEYS and key not in values, 'Unknown/duplicate environment key; inspect privately')
        require(not any(c in value for c in '\r\n\x00'), 'Invalid environment value')
        values[key] = value
    require(re.fullmatch(r'[a-z][a-z0-9_]{0,31}', values.get('POSTGRES_USER', '')), 'Invalid dedicated database username')
    require(re.fullmatch(r'[a-z][a-z0-9_]{0,31}', values.get('POSTGRES_DB', '')), 'Invalid dedicated database name')
    require(re.fullmatch(r'[a-f0-9]{64}', values.get('POSTGRES_PASSWORD', '')), 'Database password must be a generated 64-character hex secret')
    require(re.fullmatch(r'[a-f0-9]{64}', values.get('SETUP_TOKEN', '')), 'Setup token must be generated hex')
    require(values.get('APP_PORT', '').isdigit() and 18180 <= int(values['APP_PORT']) <= 18199, 'Invalid app port')
    values.setdefault('APP_BASE_PATH', BASE_PATH)
    require(values['APP_BASE_PATH'] == BASE_PATH, 'Unexpected application base path')
    values.setdefault('APP_RUNTIME', 'compose')
    require(values['APP_RUNTIME'] in ('compose', 'pm2'), 'Unexpected application runtime')
    values.setdefault('DB_HOST', '127.0.0.1')
    require(values['DB_HOST'] in ('127.0.0.1', 'localhost'), 'Database host must stay on loopback')
    values.setdefault('DB_PORT', DEFAULT_DB_PORT)
    require(values['DB_PORT'].isdigit() and 1024 <= int(values['DB_PORT']) <= 65535, 'Invalid database port')
    values.setdefault('PM2_APP_INSTANCES', '2')
    require(values['PM2_APP_INSTANCES'].isdigit() and 1 <= int(values['PM2_APP_INSTANCES']) <= 8, 'Invalid PM2 app instance count')
    origin = values.get('APP_ORIGIN', '')
    if origin != f"http://localhost:{values['APP_PORT']}":
        parse_public_url(origin + BASE_PATH)
    require(values.get('COOKIE_SECURE') == ('true' if origin.startswith('https://') else 'false'), 'Cookie security does not match origin')
    if REPORT:
        REPORT.protect(values)
    return values

def env_text(values):
    result = dict(values)
    result['DATABASE_URL'] = database_url(result)
    return ''.join(f'{k}={v}\n' for k, v in sorted(result.items()))

def new_env(port, runtime='compose'):
    return dict(POSTGRES_USER='amt', POSTGRES_DB='amt_pricelist', POSTGRES_PASSWORD=secrets.token_hex(32),
                SETUP_TOKEN=secrets.token_hex(32), APP_PORT=str(port), APP_ORIGIN=f'http://localhost:{port}',
                APP_BASE_PATH=BASE_PATH, COOKIE_SECURE='false', PDF_MAX_PAGES='100', UPLOAD_MAX_MB='20', BACKUP_RETENTION_DAYS='14',
                UPLOAD_DIR='/data/uploads', BACKUP_DIR='/data/backups', APP_RUNTIME=runtime,
                DB_HOST='127.0.0.1', DB_PORT=DEFAULT_DB_PORT, PM2_APP_INSTANCES='2')

def project_label(labels):
    labels = labels or {}
    return labels.get('com.docker.compose.project') or labels.get('io.podman.compose.project')

def resource_labels(resource):
    candidates = [resource[key] for key in ('Labels', 'labels') if resource.get(key) is not None]
    require(not candidates or all(value == candidates[0] for value in candidates), 'Conflicting resource label schemas')
    return candidates[0] if candidates else {}

def resource_internal(resource):
    candidates = [resource[key] for key in ('Internal', 'internal') if resource.get(key) is not None]
    require(not candidates or all(value is candidates[0] for value in candidates), 'Conflicting network internal schemas')
    return candidates[0] if candidates else None

def check_memory(available_kib, command):
    # Status/stop/recovery inspection must remain usable under memory pressure.
    minimum = (
        3 * 1024**2 if command == 'install' else
        2 * 1024**2 if command == 'upgrade' else
        512 * 1024 if command in ('start', 'restore-check') else
        0
    )
    require(available_kib >= minimum, f'{command} needs at least {minimum / 1024**2:g} GiB available RAM; no other service will be stopped')

def parse_public_url(value):
    require(isinstance(value, str) and value == value.strip(), 'Public URL has surrounding whitespace')
    parsed = urlsplit(value)
    require(parsed.scheme in ('http', 'https') and parsed.hostname and not parsed.username and not parsed.password,
            'Public URL must be an HTTP(S) hostname without credentials')
    require(parsed.path.rstrip('/') == BASE_PATH and not parsed.query and not parsed.fragment,
            f'Public URL must end in {BASE_PATH} with no query or fragment')
    require(parsed.port is None, 'Public URL must use the standard HTTP/HTTPS port')
    host = parsed.hostname.lower().rstrip('.')
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if parsed.scheme == 'http':
        require(address is not None and str(address) == '76.13.244.160', 'Temporary HTTP is permitted only for the approved VPS IP')
    else:
        require(address is None and re.fullmatch(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', host),
                'HTTPS requires a valid domain name')
    origin = f'{parsed.scheme}://{host}'
    return {'url': origin + BASE_PATH, 'origin': origin, 'host': host, 'scheme': parsed.scheme}

def safe_entries(directory):
    path = Path(directory)
    if not path.exists():
        return []
    require(path.is_dir() and not path.is_symlink(), f'Unsafe cleanup directory: {path}')
    return sorted(path.iterdir(), key=lambda item: item.name)

def _site_blocks(text):
    """Return simple top-level Caddy site blocks; refuse structurally uncertain input."""
    blocks, depth, active = [], 0, None
    offset = 0
    for line in text.splitlines(keepends=True):
        code = line.split('#', 1)[0]
        tokens = re.findall(r'(?<!\S)[{}](?!\S)', code)
        if depth == 0 and '{' in tokens:
            require(tokens.count('{') == 1 and tokens.index('{') == len(tokens) - 1, 'Unsupported Caddy top-level structure')
            header = code[:code.rfind('{')].strip()
            require(header and not header.startswith('('), 'Caddy snippets/imports require manual review')
            active = {'header': header, 'start': offset, 'body_start': offset + len(line)}
        for token in tokens:
            depth += 1 if token == '{' else -1
            require(depth >= 0, 'Unbalanced Caddy configuration')
            if depth == 0 and active:
                active.update(close=offset, end=offset + len(line))
                blocks.append(active)
                active = None
        offset += len(line)
    require(depth == 0 and active is None, 'Unbalanced Caddy configuration')
    return blocks

def _header_hosts(header):
    hosts = set()
    for item in re.split(r'[\s,]+', header):
        if not item:
            continue
        parsed = urlsplit(item if '://' in item else '//' + item)
        if parsed.hostname:
            hosts.add(parsed.hostname.lower().rstrip('.'))
    return hosts

def caddy_candidate(text, target, upstream):
    require('import ' not in text and re.search(r'(?m)^\s*import\s+', text) is None,
            'Caddy imports require manual review; no proxy file was changed')
    begin_site, end_site = '# BEGIN AMT PRICE LIST SITE', '# END AMT PRICE LIST SITE'
    begin_route, end_route = '# BEGIN AMT PRICE LIST ROUTE', '# END AMT PRICE LIST ROUTE'
    clean = re.sub(r'(?ms)^# BEGIN AMT PRICE LIST SITE[^\n]*\n.*?^# END AMT PRICE LIST SITE[^\n]*\n?', '', text)
    clean = re.sub(r'(?ms)^\s*# BEGIN AMT PRICE LIST ROUTE[^\n]*\n.*?^\s*# END AMT PRICE LIST ROUTE[^\n]*\n?', '', clean)
    require(begin_site not in clean and begin_route not in clean, 'Malformed AMT-managed Caddy markers')
    blocks = _site_blocks(clean)
    matches = [b for b in blocks if target['host'] in _header_hosts(b['header'])]
    require(len(matches) <= 1, 'Multiple Caddy site blocks match the requested hostname')
    route = (f'\n    {begin_route} {target["url"]}\n'
             f'    @amt_price_list path {BASE_PATH} {BASE_PATH}/*\n'
             '    handle @amt_price_list {\n'
             f'        reverse_proxy {upstream}\n'
             '    }\n'
             f'    {end_route} {target["url"]}\n')
    if matches:
        block = matches[0]
        body = clean[block['body_start']:block['close']]
        require(BASE_PATH not in body and '@amt_price_list' not in body, 'Requested Caddy path is already configured outside AMT ownership')
        return clean[:block['close']] + route + clean[block['close']:], False
    site = (f'\n{begin_site} {target["url"]}\n'
            f'{target["origin"]} {{\n'
            f'{route}'
            '}\n'
            f'{end_site} {target["url"]}\n')
    return clean.rstrip() + '\n' + site, True

def port_rows(text):
    rows = {}
    for line in text.splitlines():
        columns = line.split()
        require(len(columns) >= 5, 'Cannot interpret listening sockets; refusing to choose a port')
        address = columns[3]
        match = re.search(r':(\d+)$', address)
        require(match is not None, 'Cannot interpret listening port')
        rows.setdefault(int(match[1]), []).append(address)
    return rows

def choose_port(tcp, udp, reserved, existing=None, own_running=False):
    if existing is not None:
        require(18180 <= existing <= 18199, 'Stored port outside dedicated range')
        foreign = reserved.get(existing, False)
        addresses = tcp.get(existing, [])
        require(not foreign and existing not in udp, 'Stored port is reserved by another service; nothing will be stopped')
        require(not addresses or (own_running and all(a == f'127.0.0.1:{existing}' for a in addresses)),
                'Stored port is occupied or ownership is unclear; nothing will be stopped')
        return existing
    for port in range(18180, 18200):
        if port not in tcp and port not in udp and port not in reserved:
            return port
    raise DeployError('No unused port in 18180–18199; no existing service will be stopped')

class Deployment:
    def __init__(self, args):
        self.args = args
        self.root = ROOT
        self.envfile = self.root / 'shared' / '.env'
        self.state = self.root / 'state'
        self.release = None
        self.env = None

    def stage(self, name):
        if REPORT:
            REPORT.stage(name)

    def log_ready(self):
        if REPORT and not self.args.dry_run:
            REPORT.protect(self.env or {})
            REPORT.open(self.root)

    def engine(self, *args, **kwargs):
        return run(['docker', *args], **kwargs)

    def runtime(self):
        if self.args.runtime:
            return self.args.runtime
        if self.env:
            return app_runtime(self.env)
        return 'pm2'

    def native_runtime(self):
        return self.runtime() == 'pm2'

    @staticmethod
    def is_native_runtime(runtime):
        return runtime == 'pm2'

    def native_paths(self, release=None):
        release = release or self.release
        require(release is not None, 'No release selected')
        shared = self.root / 'shared' / 'runtime'
        return {
            'release': release,
            'shared': shared,
            'python': shared / 'python',
            'browsers': shared / 'playwright',
            'logs': shared / 'pm2-logs',
            'ecosystem': release / 'scripts' / 'deployment' / 'pm2.ecosystem.cjs',
        }

    def native_env(self, extra=None, release=None, values_override=None):
        require(self.env is not None, 'Environment not loaded')
        paths = self.native_paths(release)
        env = dict(os.environ)
        values = dict(self.env, APP_RUNTIME='pm2')
        if values_override:
            values.update(values_override)
        env.update(values)
        env['DATABASE_URL'] = database_url(values)
        env['PLAYWRIGHT_BROWSERS_PATH'] = str(paths['browsers'])
        env['PYTHON_BIN'] = str(paths['python'] / 'bin' / 'python')
        env['PM2_LOG_DIR'] = str(paths['logs'])
        if extra:
            env.update(extra)
        return env

    def native_runtime_env(self, extra=None, release=None):
        require(self.env is not None, 'Environment not loaded')
        values = dict(self.env)
        host = values.get('DB_HOST', '127.0.0.1')
        port = int(values.get('DB_PORT', DEFAULT_DB_PORT))
        if host in ('127.0.0.1', 'localhost') and not self.host_port_ready(host, port):
            values['DB_HOST'] = self.db_private_ipv4()
        return self.native_env(extra=extra, release=release, values_override={'DB_HOST': values['DB_HOST']})

    def host_port_ready(self, host, port, timeout=1.5):
        try:
            with socket.create_connection((host, port), timeout=timeout):
                return True
        except OSError:
            return False

    def compose(self, *args, release=None, **kwargs):
        release = release or self.release
        require(release is not None, 'No release selected')
        return self.engine('compose', '--project-name', PROJECT, '--project-directory', release,
                           '--env-file', self.envfile, '-f', release / 'compose.yaml',
                           '-f', release / 'deploy-images.json', *args, **kwargs)

    def inventory(self):
        ids = decoded(self.engine('ps', '-aq')).split()
        return json.loads(decoded(self.engine('inspect', *ids))) if ids else []

    def owned(self, container):
        return project_label(container.get('Config', {}).get('Labels')) == PROJECT

    def ownership(self, first=False, allow_legacy_db=False):
        for item in self.inventory():
            name = item.get('Name', '').lstrip('/')
            if name.startswith(PROJECT):
                require(self.owned(item), 'Conflicting container name is not owned by this project')
            if first:
                require(not self.owned(item), 'Project resources already exist; refusing first-install adoption')
        volumes = ['database', 'database_socket', 'uploads', 'backups']
        for kind, names in [('volume', volumes), ('network', ['private'])]:
            listed = decoded(self.engine(kind, 'ls', '--format', '{{.Name}}')).splitlines()
            for suffix in names:
                name = f'{PROJECT}_{suffix}'
                if name in listed:
                    require(not first, 'Existing dedicated resources need manual ownership review')
                    resource = json.loads(decoded(self.engine(kind, 'inspect', name)))[0]
                    require(project_label(resource_labels(resource)) == PROJECT, 'Volume/network ownership mismatch')
                    if kind == 'network':
                        require(resource_internal(resource) is True, 'Dedicated network is not internal')
        for item in self.inventory():
            if not self.owned(item):
                require(not any(m.get('Name') in [f'{PROJECT}_{v}' for v in volumes] for m in item.get('Mounts', [])), 'Another project mounts AMT storage; refusing changes')
                continue
            service = item.get('Config', {}).get('Labels', {}).get('com.docker.compose.service')
            if service == 'db':
                mounts = [m for m in item.get('Mounts', []) if m.get('Destination') == '/var/lib/postgresql/data']
                require(len(mounts) == 1 and mounts[0].get('Name') == PROJECT + '_database', 'Database volume mismatch')
                sockets = [m for m in item.get('Mounts', []) if m.get('Destination') == '/var/run/postgresql']
                if not sockets and allow_legacy_db:
                    require(len(item.get('Mounts', [])) == 1, 'Legacy database has unexpected mounts')
                else:
                    require(len(sockets) == 1 and sockets[0].get('Name') == PROJECT + '_database_socket', 'Database socket volume mismatch')
                bindings = item.get('HostConfig', {}).get('PortBindings', {}) or {}
                allowed_port = self.env.get('DB_PORT', DEFAULT_DB_PORT) if self.env else DEFAULT_DB_PORT
                allowed = {'5432/tcp': [{'HostIp': '127.0.0.1', 'HostPort': allowed_port}]}
                require(bindings in ({}, allowed), 'Database must stay unpublished or bind only to loopback on the dedicated AMT database port')

    def port(self, existing=None):
        tcp = port_rows(decoded(run(['ss', '-H', '-ltn'])))
        udp = port_rows(decoded(run(['ss', '-H', '-lun'])))
        reserved, own_running = {}, False
        for item in self.inventory():
            service = item.get('Config', {}).get('Labels', {}).get('com.docker.compose.service')
            for internal, bindings in (item.get('HostConfig', {}).get('PortBindings') or {}).items():
                for binding in bindings or []:
                    port = int(binding['HostPort'])
                    own = self.owned(item) and service == 'app' and internal == '3000/tcp' and binding.get('HostIp') == '127.0.0.1'
                    reserved[port] = reserved.get(port, False) or not own
                    if port == existing and own and item.get('State', {}).get('Running'):
                        own_running = True
        return choose_port(tcp, udp, reserved, existing, own_running)

    def preflight(self):
        require(sys.platform.startswith('linux'), 'Run deployment on the Linux VPS; local tests do not deploy')
        require(sys.version_info >= (3, 12), 'Python 3.12 or newer is required for safe archive extraction')
        require(os.geteuid() == 0, 'Run through an authorized root/sudo session')
        for tool in ['docker', 'git', 'ss', 'curl', 'systemctl']:
            require(shutil.which(tool), f'Missing prerequisite: {tool}. No packages were installed')
        self.engine('version')
        self.engine('compose', 'version')
        if self.args.command in ('install', 'upgrade'):
            require(shutil.disk_usage('/opt').free >= 12 * 1024**3, 'At least 12 GiB free disk is required')
            require(shutil.which('podman'), 'This bounded-build installer requires the existing native Podman runtime; no replacement is installed')
            require('podman' in decoded(self.engine('info')).lower(), 'Docker endpoint is not the local Podman runtime; refuse an unbounded daemon build')
            info = json.loads(decoded(run(['podman', 'info', '--format', 'json'])))
            require(info['host']['cgroupVersion'] == 'v2' and not info['host']['security']['rootless'], 'Bounded builds require rootful Podman with cgroup v2')
        runtime_hint = self.args.runtime
        if runtime_hint is None and self.envfile.exists():
            with contextlib.suppress(Exception):
                runtime_hint = app_runtime(read_env(self.envfile))
        runtime_hint = runtime_hint or ('pm2' if self.args.command == 'install' else 'compose')
        if self.args.command in ('install', 'upgrade', 'start', 'backup-job') and runtime_hint == 'pm2':
            for tool in ['node', 'python3', 'pm2', 'corepack', 'pg_dump', 'pg_restore', 'tesseract', 'pdftotext']:
                require(shutil.which(tool), f'Missing prerequisite for PM2 runtime: {tool}. No packages were installed')
            node_version = parse_semver(decoded(run(['node', '--version'])))
            require(node_version >= MIN_PM2_NODE,
                    f'PM2 runtime requires Node.js {MIN_PM2_NODE[0]}+; found v{".".join(str(part) for part in node_version)}')
        memory = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
        check_memory(int(memory['MemAvailable'].split()[0]), self.args.command)
        legacy_recovery = (self.args.command == 'install' and self.args.resume and
                           (self.args.replace_failed_release or self.args.recover_install))
        self.ownership(first=not self.root.exists(), allow_legacy_db=legacy_recovery)
        print('Runtime, capacity and project ownership checks passed. Shared proxy/firewall configuration is unchanged.')

    def current(self):
        self.load_environment()
        self.release = (self.root / 'current').resolve(strict=True)
        require(self.release.parent == self.root / 'releases' and self.release.is_dir(), 'Current release points outside the deployment')

    def load_environment(self):
        require(self.root.is_dir() and not self.root.is_symlink(), 'Deployment root is missing or unsafe')
        require((self.root / '.amt-owner').read_text().strip() == PROJECT, 'Deployment directory ownership marker mismatch')
        require(self.root.stat().st_uid == 0 and self.root.stat().st_mode & 0o077 == 0, 'Deployment root must be root-owned mode 0700')
        self.env = read_env(self.envfile)

    def initialize_volumes(self):
        self.ownership()
        existing = decoded(self.engine('volume', 'ls', '--format', '{{.Name}}')).splitlines()
        for volume in ('database', 'database_socket', 'uploads', 'backups'):
            name = f'{PROJECT}_{volume}'
            if name not in existing:
                self.engine('volume', 'create', '--label', f'com.docker.compose.project={PROJECT}',
                            '--label', f'com.docker.compose.volume={volume}', name)
        self.ownership()
        self.engine('run', '--rm', '--network', 'none', '--label', f'com.docker.compose.project={PROJECT}',
                    '-v', f'{PROJECT}_database_socket:/socket', DB_IMAGE, 'sh', '-c',
                    'chown postgres:postgres /socket && chmod 0777 /socket')
        for volume in ('uploads', 'backups'):
            self.engine('run', '--rm', '--network', 'none', '--label', f'com.docker.compose.project={PROJECT}',
                        '-v', f'{PROJECT}_{volume}:/data', DB_IMAGE, 'chown', '1000:1000', '/data')

    @contextlib.contextmanager
    def locked(self):
        import fcntl
        lock = Path('/run/lock/amt-pricelist-deploy.lock')
        fd = os.open(lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            require(os.fstat(fd).st_uid == 0, 'Deployment lock ownership mismatch')
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise DeployError('Another AMT deployment/rotation is running') from None
            yield
        finally:
            os.close(fd)

    def event(self, action, **details):
        with (self.state / 'history.jsonl').open('a') as stream:
            stream.write(json.dumps({'time': dt.datetime.now(dt.timezone.utc).isoformat(), 'action': action, **details}) + '\n')

    def checkpoint(self, phase, **details):
        atomic(self.state / 'deployment.json', json.dumps({'phase': phase, **details}))

    def db_id(self):
        ids = decoded(self.compose('ps', '-q', 'db')).split()
        require(len(ids) == 1, 'Expected exactly one dedicated database container')
        return ids[0]

    def container_private_ipv4(self, container_id, label):
        metadata = json.loads(decoded(self.engine('inspect', container_id)))[0]
        networks = metadata.get('NetworkSettings', {}).get('Networks') or {}
        for network in networks.values():
            address = network.get('IPAddress') or ''
            if not address:
                continue
            try:
                parsed = ipaddress.ip_address(address)
            except ValueError:
                continue
            if isinstance(parsed, ipaddress.IPv4Address):
                return str(parsed)
        raise DeployError(f'{label} container does not expose a private IPv4 address')

    def db_private_ipv4(self):
        return self.container_private_ipv4(self.db_id(), 'Database')

    def app_id(self):
        ids = decoded(self.compose('ps', '-q', 'app')).split()
        require(len(ids) == 1, 'Expected exactly one app container')
        return ids[0]

    def app_metadata(self):
        return json.loads(decoded(self.engine('inspect', self.app_id())))[0]

    def app_private_ipv4(self):
        return self.container_private_ipv4(self.app_id(), 'App')

    def app_health_urls(self):
        health_path = f'{BASE_PATH}/api/v1/health'
        urls = [f"http://127.0.0.1:{self.env['APP_PORT']}{health_path}"]
        if not self.native_runtime():
            try:
                urls.append(f'http://{self.app_private_ipv4()}:3000{health_path}')
            except DeployError:
                pass
        return urls

    def stable_upstream(self):
        return f"127.0.0.1:{self.env['APP_PORT']}"

    def healthy_upstream(self):
        for url in self.app_health_urls():
            result = run(['curl', '--silent', '--fail', '--max-time', '5', url], check=False, timeout=10)
            if result.returncode == 0:
                if f'127.0.0.1:{self.env["APP_PORT"]}' in url:
                    return self.stable_upstream()
                return f'{urlsplit(url).hostname}:3000'
        raise DeployError('AMT app health endpoint did not respond on the published port or private container IP')

    def database(self, sql, env=None, check=True):
        env = env or self.env
        script = 'IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -X -h 127.0.0.1 -U "$1" -d "$2" -At -v ON_ERROR_STOP=1'
        return self.engine('exec', '-i', self.db_id(), 'sh', '-c', script, 'amt', env['POSTGRES_USER'], env['POSTGRES_DB'],
                           data=(env['POSTGRES_PASSWORD'] + '\n' + sql + '\n').encode(), check=check)

    def pm2_running(self):
        result = run(['pm2', 'jlist'], check=False, env=self.native_runtime_env())
        if result.returncode != 0:
            return {}
        items = json.loads(decoded(result) or '[]')
        return {
            item.get('name'): item.get('pm2_env', {}).get('status')
            for item in items
            if item.get('name') in PM2_PROCESSES
        }

    def backup_timer_name(self):
        return 'amt-pricelist-backup.timer'

    def backup_service_name(self):
        return 'amt-pricelist-backup.service'

    def healthy(self):
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if self.database('SELECT 1;', check=False).returncode == 0:
                if self.native_runtime():
                    states = self.pm2_running()
                    if all(states.get(name) == 'online' for name in PM2_PROCESSES):
                        self.healthy_upstream()
                        return
                else:
                    ids = decoded(self.compose('ps', '-q', *SERVICES)).split()
                    if len(ids) == 3:
                        states = json.loads(decoded(self.engine('inspect', *ids)))
                        if all(c.get('State', {}).get('Running') for c in states):
                            self.healthy_upstream()
                            return
            time.sleep(3)
        raise DeployError('Health checks failed; project remains in recovery state')

    def wait_db(self):
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if self.database('SELECT 1;', check=False).returncode == 0:
                return
            time.sleep(2)
        raise DeployError('Database authentication did not become ready')

    def start(self):
        self.stage('Start AMT services and verify health')
        self.ownership()
        self.port(int(self.env['APP_PORT']))  # Immediate fail-closed recheck; never kill a listener.
        if self.native_runtime():
            env = self.native_runtime_env()
            run(['pm2', 'delete', *PM2_PROCESSES], check=False, env=env)
            run(['pm2', 'start', self.native_paths()['ecosystem'], '--only', ','.join(PM2_PROCESSES), '--update-env'],
                timeout=300, live=True, env=env)
        else:
            self.compose('up', '-d', '--no-deps', '--no-build', *SERVICES)
            try:
                self.verify_limits(*SERVICES)
            except DeployError:
                self.stop()
                raise
        self.healthy()

    def verify_limits(self, *services):
        for service in services:
            ids = decoded(self.compose('ps', '-q', service)).split()
            require(len(ids) == 1, f'Expected exactly one {service} container to verify memory cap')
            container = json.loads(decoded(self.engine('inspect', ids[0])))[0]
            limit = container.get('HostConfig', {}).get('Memory', 0)
            require(isinstance(limit, int) and 0 < limit <= MEMORY_MIB[service] * 1024**2,
                    f'Runtime did not enforce the {service} memory cap; stopping AMT startup')

    def stop(self):
        self.stop_runtime(self.runtime())

    def stop_runtime(self, runtime):
        if self.is_native_runtime(runtime):
            run(['systemctl', 'stop', self.backup_timer_name(), self.backup_service_name()], check=False)
            run(['pm2', 'delete', *PM2_PROCESSES], check=False, env=self.native_runtime_env())
        else:
            self.compose('stop', '-t', '60', *SERVICES)

    @staticmethod
    def _managed_unit_text(path):
        if not path.exists():
            return None
        require(path.is_file() and not path.is_symlink(), f'Unsafe systemd unit path: {path.name}')
        return path.read_text()

    def _sync_startup_units(self, release):
        target = Path('/etc/systemd/system/amt-pricelist.service')
        service_text = self._managed_unit_text(target)
        if service_text is not None:
            require('AMT Price List isolated application' in service_text, 'Existing systemd unit is not recognized; refusing overwrite')
        atomic(target, (release / 'docker' / 'amt-pricelist.service').read_bytes())
        target.chmod(0o644)

        backup_units = {
            'amt-pricelist-backup.service': 'AMT Price List scheduled backup job',
            'amt-pricelist-backup.timer': 'AMT Price List backup timer',
        }
        if self.native_runtime():
            for name, marker in backup_units.items():
                backup_target = Path('/etc/systemd/system') / name
                backup_text = self._managed_unit_text(backup_target)
                if backup_text is not None:
                    require(marker in backup_text, f'Existing systemd unit is not recognized: {name}')
                atomic(backup_target, (release / 'docker' / name).read_bytes())
                backup_target.chmod(0o644)
        else:
            run(['systemctl', 'disable', '--now', self.backup_timer_name(), self.backup_service_name()], check=False)
            for name, marker in backup_units.items():
                backup_target = Path('/etc/systemd/system') / name
                backup_text = self._managed_unit_text(backup_target)
                if backup_text is None:
                    continue
                require(marker in backup_text, f'Existing systemd unit is not recognized: {name}')
                backup_target.unlink()

    def snapshot(self):
        self.stage('Create private recovery backup')
        target = self.root / 'recovery' / (dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + secrets.token_hex(3))
        target.mkdir(mode=0o700)
        atomic(target / 'private.env', env_text(self.env))
        with (target / 'database.dump').open('xb') as stream:
            script = 'IFS= read -r PGPASSWORD; export PGPASSWORD; exec pg_dump -h 127.0.0.1 -U "$1" -d "$2" -Fc --no-owner --no-acl'
            self.engine('exec', '-i', self.db_id(), 'sh', '-c', script, 'amt', self.env['POSTGRES_USER'], self.env['POSTGRES_DB'],
                        data=(self.env['POSTGRES_PASSWORD'] + '\n').encode(), output=stream, timeout=900)
        with (target / 'uploads.tar').open('xb') as stream:
            self.engine('run', '--rm', '--network', 'none', '--label', 'amt.recovery=backup', '-v', f'{PROJECT}_uploads:/data:ro', DB_IMAGE,
                        'tar', '-C', '/data', '-cf', '-', '.', output=stream, timeout=900)
        highwater = decoded(self.database("SELECT last_value::text || ':' || is_called::text FROM quotation_serial_seq;"))
        counts = decoded(self.database("SELECT json_build_object('products',(SELECT count(*) FROM products),'quotations',(SELECT count(*) FROM quotations),'users',(SELECT count(*) FROM users))::text;"))
        manifest = {'release': self.release.name, 'quotationSequence': highwater, 'counts': json.loads(counts),
                    'sha256': {name: hashlib.file_digest((target / name).open('rb'), 'sha256').hexdigest() for name in ['database.dump', 'uploads.tar']}}
        atomic(target / 'manifest.json', json.dumps(manifest, indent=2))
        atomic(target / 'COMPLETE', 'verified-files-written\n')
        self.event('BACKUP', backup=target.name)
        print(f'Complete private recovery backup: {target}')
        return target

    def rotate(self, resume=False):
        journal = self.state / 'rotation.json'
        if resume:
            require(journal.is_file(), 'No interrupted rotation exists')
        else:
            require(not journal.exists(), 'Interrupted rotation exists; use rotate-secrets --resume')
            self.stop()
            backup = self.snapshot()
            replacement = dict(self.env, POSTGRES_PASSWORD=secrets.token_hex(32))
            if decoded(self.database('SELECT count(*) FROM users;')) == '0':
                replacement['SETUP_TOKEN'] = secrets.token_hex(32)
            atomic(self.state / 'rotation-old.env', env_text(self.env))
            atomic(self.state / 'rotation-new.env', env_text(replacement))
            atomic(journal, json.dumps({'phase': 'PREPARED', 'backup': backup.name}))
        self.stop()
        old = read_env(self.state / 'rotation-old.env')
        new = read_env(self.state / 'rotation-new.env')
        # Probe real TCP authentication, never infer success from POSTGRES_PASSWORD or socket trust.
        if self.database('SELECT 1;', new, check=False).returncode != 0:
            require(self.database('SELECT 1;', old, check=False).returncode == 0, 'Neither credential authenticates; keep services stopped and inspect the private journal')
            sql = ('SET log_statement=none; SET log_min_duration_statement=-1; SET log_min_error_statement=panic; '
                   f'ALTER ROLE "{new["POSTGRES_USER"]}" PASSWORD \'{new["POSTGRES_PASSWORD"]}\';')
            self.database(sql, old)
        require(self.database('SELECT 1;', new, check=False).returncode == 0, 'New database credential failed verification')
        atomic(journal, json.dumps({'phase': 'DATABASE_CHANGED'}))
        atomic(self.envfile, env_text(new))
        self.env = new
        self.compose('up', '-d', '--no-deps', '--no-build', '--force-recreate', 'db')
        self.wait_db()
        self.port(int(self.env['APP_PORT']))
        if not self.native_runtime():
            self.compose('up', '-d', '--no-deps', '--no-build', '--force-recreate', *SERVICES)
        else:
            self.start()
        self.healthy()
        self.event('SECRETS_ROTATED')
        # Archive evidence privately rather than deleting recovery credentials automatically.
        archive = self.state / ('rotation-complete-' + secrets.token_hex(6))
        archive.mkdir(mode=0o700)
        for name in ['rotation.json', 'rotation-old.env', 'rotation-new.env']:
            os.replace(self.state / name, archive / name)
        print('App database credentials rotated and authenticated; user passwords and VPS access are unchanged.')

    def source(self, fetch=True):
        self.stage('Check clean source and resolve release')
        source = Path(self.args.source).resolve()
        require(decoded(run(['git', '-C', source, 'status', '--porcelain', '--untracked-files=normal'])) == '', 'Dirty Git checkout: commit or remove local changes deliberately; no automatic stash/reset')
        remote = decoded(run(['git', '-C', source, 'remote', 'get-url', 'origin']))
        require('PRICE_LIST_AUG' in remote and not re.search(r'https?://[^/]+@', remote), 'Expected this app origin with no embedded credentials')
        require(not self.args.ref.startswith('-'), 'Invalid Git ref')
        if fetch:
            run(['git', '-C', source, 'fetch', '--prune', 'origin'], timeout=300)
        commit = decoded(run(['git', '-C', source, 'rev-parse', '--verify', self.args.ref + '^{commit}']))
        require(re.fullmatch(r'[a-f0-9]{40,64}', commit), 'Could not resolve immutable release')
        return source, commit

    def prepare_release(self, source, commit):
        release = self.root / 'releases' / (commit[:12] + '-' + secrets.token_hex(4))
        release.mkdir(mode=0o700)
        archive = run(['git', '-C', source, 'archive', '--format=tar', commit]).stdout
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            for member in tar.getmembers():
                path = Path(member.name)
                require(not path.is_absolute() and '..' not in path.parts and (member.isfile() or member.isdir()), 'Unsafe archive member or symlink')
                require(not (path.name.startswith('.env') and path.name != '.env.example'), 'Release must not contain environment secrets')
            tar.extractall(release, filter='data')
        for required in ['compose.yaml', 'Dockerfile', 'pnpm-lock.yaml', 'scripts/deployment/manage.py']:
            require((release / required).is_file(), f'Release is missing {required}; commit and push deployment tooling first')
        images = {
            s: {
                'image': f'localhost/{PROJECT}-' + ('app' if s == 'migrate' else s) + ':' + commit,
                'environment': {'APP_RELEASE': commit[:12]},
            }
            for s in ['app', 'migrate', 'worker', 'backup']
        }
        atomic(release / 'deploy-images.json', json.dumps({'services': images}))
        atomic(release / 'release.json', json.dumps({'commit': commit, 'migrations': self.migration_files(release)}))
        self.compose('config', '--quiet', release=release)
        if self.runtime() == 'pm2':
            self.build_native_release(release)
        else:
            self.build_release(release, commit)
        return release

    def build_release(self, release, commit):
        # Native Podman is intentional: Docker daemon builds can ignore client limits.
        # The Dockerfile checks the effective cgroup limit before installing packages.
        network_args = ['--network=host'] if self.args.build_network == 'host' else []
        if network_args:
            warning = 'Build-only host networking enabled: build processes can reach host-network services. Runtime networks remain unchanged.'
            if REPORT:
                REPORT.emit(warning)
            else:
                print(warning, flush=True)
        for target in ('app', 'worker', 'backup'):
            self.stage(f'Build {target} image (2 GiB memory cap)')
            run(['podman', 'build', *network_args, '--jobs=1', '--memory=2g', '--memory-swap=2g',
                 '--build-arg', 'AMT_VERIFY_BUILD_LIMIT=1', '--target', target,
                 '--tag', f'localhost/{PROJECT}-{target}:{commit}', '--file', release / 'Dockerfile', release], timeout=3600, live=True)

    def build_native_release(self, release):
        paths = self.native_paths(release)
        for directory in (paths['shared'], paths['browsers'], paths['logs']):
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.stage('Install host dependencies for PM2 runtime')
        run(['corepack', 'enable'], timeout=120, env=self.native_env(release=release), cwd=release)
        run(['corepack', 'pnpm', 'install', '--frozen-lockfile'], timeout=3600, live=True,
            env=self.native_env({'PLAYWRIGHT_BROWSERS_PATH': str(paths['browsers'])}, release=release), cwd=release)
        self.stage('Build PM2 release assets')
        run(['corepack', 'pnpm', 'build'], timeout=3600, live=True,
            env=self.native_env({'PLAYWRIGHT_BROWSERS_PATH': str(paths['browsers'])}, release=release), cwd=release)
        self.stage('Prepare PM2 worker runtime')
        run(['python3', '-m', 'venv', paths['python']], timeout=300, env=self.native_env(release=release))
        run([paths['python'] / 'bin' / 'pip', 'install', '--no-cache-dir', '-r', release / 'scripts' / 'requirements.txt'],
            timeout=1800, live=True, env=self.native_env(release=release))
        run(['corepack', 'pnpm', 'exec', 'playwright', 'install', 'chromium'], timeout=1800, live=True,
            env=self.native_env({'PLAYWRIGHT_BROWSERS_PATH': str(paths['browsers'])}, release=release), cwd=release)

    def run_native_migrate(self):
        self.stage('Run database migrations')
        run(['node', 'node_modules/tsx/dist/cli.mjs', 'scripts/migrate.ts'], timeout=600, live=True,
            env=self.native_runtime_env(), cwd=self.release)

    def run_backup_job(self):
        self.stage('Run scheduled backup job')
        run(['node', 'node_modules/tsx/dist/cli.mjs', 'scripts/backup-service.ts', '--once'], timeout=900, live=True,
            env=self.native_runtime_env(), cwd=self.release)

    @staticmethod
    def migration_files(release):
        return {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted((release / 'database').glob('*.sql'))}

    def activate(self, release):
        temp = self.root / ('current-' + secrets.token_hex(4))
        temp.symlink_to(release, target_is_directory=True)
        os.replace(temp, self.root / 'current')
        self.release = release

    def cleanup_plan(self):
        current = (self.root / 'current').resolve(strict=True)
        require(current.parent == self.root / 'releases' and current.is_dir(), 'Current release points outside the deployment')
        current_name = current.name
        releases = [entry for entry in safe_entries(self.root / 'releases') if entry.is_dir()]
        keep_releases = {current_name}
        for release in sorted(releases, key=lambda item: item.stat().st_mtime, reverse=True):
            if release.name != current_name:
                keep_releases.add(release.name)
                break
        cutoff = time.time() - 14 * 24 * 60 * 60
        return {
            'keep_releases': keep_releases,
            'removable_releases': [entry for entry in releases if entry.name not in keep_releases],
            'removable_recovery': [
                entry for entry in safe_entries(self.root / 'recovery')
                if entry.is_dir() and entry.stat().st_mtime < cutoff
            ],
            'removable_logs': [
                entry for entry in safe_entries(self.root / 'logs')
                if entry.is_file() and entry.stat().st_mtime < cutoff
            ],
        }

    @staticmethod
    def print_cleanup_plan(plan):
        print('Cleanup plan:')
        print(f'  Keep releases: {", ".join(sorted(plan["keep_releases"]))}')
        for entry in plan['removable_releases']:
            print(f'  Remove release: {entry}')
        for entry in plan['removable_recovery']:
            print(f'  Remove recovery backup: {entry}')
        for entry in plan['removable_logs']:
            print(f'  Remove log: {entry}')
        print('  Prune unused Podman images')

    def apply_cleanup_plan(self, plan, *, action='CLEANUP'):
        for entry in plan['removable_releases']:
            shutil.rmtree(entry)
        for entry in plan['removable_recovery']:
            shutil.rmtree(entry)
        for entry in plan['removable_logs']:
            entry.unlink()
        run(['podman', 'image', 'prune', '-a', '-f'], timeout=900, live=True)
        self.event(action, keptReleases=sorted(plan['keep_releases']),
                   removedReleases=[entry.name for entry in plan['removable_releases']],
                   removedRecovery=[entry.name for entry in plan['removable_recovery']],
                   removedLogs=[entry.name for entry in plan['removable_logs']])
        return plan

    def auto_cleanup_after_upgrade(self):
        self.stage('Clean older AMT releases and unused images')
        try:
            plan = self.cleanup_plan()
            self.apply_cleanup_plan(plan, action='AUTO_CLEANUP')
            print('Automatic cleanup complete. Kept the current release, one rollback release, current state, and shared secrets.')
        except Exception as error:
            message = str(error) if isinstance(error, DeployError) else 'Unexpected cleanup failure; inspect logs and prune old AMT artifacts manually'
            print(f'Automatic cleanup skipped: {message}')

    def deploy(self, first):
        if self.root.exists():
            self.load_environment()
            self.log_ready()
        source, commit = self.source()
        requested_commit = commit
        journal = self.state / 'install.json'
        recovery = None
        if first and self.args.resume:
            self.load_environment()
            require(journal.is_file(), 'No resumable first installation; retain files for manual review')
            recovery = json.loads(journal.read_text())
            require(not recovery.get('completed'), 'Installation is already complete; use upgrade')
            replace_release = (self.args.replace_failed_release or
                               (self.args.recover_install and requested_commit != recovery.get('commit')))
            if replace_release:
                self.check_replace_failed()
                atomic(self.state / ('install-replaced-' + secrets.token_hex(6) + '.json'), journal.read_bytes())
                # The guard proved this is the sole pre-migration DB container. Recreate it
                # from the replacement release so it receives the private socket mount.
                if self.release is not None:
                    self.compose('rm', '-s', '-f', 'db')
                    self.release = None
                atomic(self.envfile, env_text(self.env))
                recovery = {'commit': requested_commit, 'candidate': None}
                atomic(journal, json.dumps(recovery))
                self.event('FAILED_RELEASE_REPLACED', commit=requested_commit)
            commit = recovery['commit']
            require(re.fullmatch(r'[a-f0-9]{40,64}', commit), 'Invalid recovery commit')
            self.port(int(self.env['APP_PORT']))
        elif first:
            require(not self.root.exists(), 'Install refuses an existing deployment directory')
            self.ownership(first=True)
            port = self.port()
            self.root.mkdir(mode=0o700)
            for directory in ['shared', 'state', 'releases', 'recovery']:
                (self.root / directory).mkdir(mode=0o700)
            atomic(self.root / '.amt-owner', PROJECT + '\n')
            self.env = new_env(port, runtime=self.runtime())
            atomic(self.envfile, env_text(self.env))
            atomic(journal, json.dumps({'commit': commit, 'candidate': None}))
            self.log_ready()
        else:
            self.current()
        previous_runtime = runtime_for_env(self.env) if self.env else None
        self.env['APP_RUNTIME'] = self.runtime()
        self.env.setdefault('DB_HOST', '127.0.0.1')
        self.env.setdefault('DB_PORT', DEFAULT_DB_PORT)
        self.env.setdefault('PM2_APP_INSTANCES', '2')
        previous = self.release
        if recovery and recovery.get('candidate'):
            require(re.fullmatch(r'[a-f0-9]{12}-[a-f0-9]{8}', recovery['candidate']), 'Invalid recovery release')
            release = self.root / 'releases' / recovery['candidate']
            require(release.is_dir() and not release.is_symlink(), 'Recovery release missing or unsafe')
            require(json.loads((release / 'release.json').read_text())['commit'] == commit, 'Recovery release commit mismatch')
        else:
            release = self.prepare_release(source, commit)
            if first:
                atomic(journal, json.dumps({'commit': commit, 'candidate': release.name}))
        self.checkpoint('BUILT', previous=previous.name if previous else None, candidate=release.name)
        if previous:
            require(self.migration_files(previous).items() <= self.migration_files(release).items(), 'Migration removal/change is not an additive upgrade')
            self.stop_runtime(previous_runtime)
            self.snapshot()
        self.release = release
        self.stage('Initialize dedicated storage and database')
        if first and self.args.resume:
            self.stop()
        self.initialize_volumes()
        self.compose('up', '-d', '--no-deps', '--no-build', 'db')
        self.verify_limits('db')
        self.wait_db()
        self.verify_database_runtime()
        self.checkpoint('MIGRATING', previous=previous.name if previous else None, candidate=release.name)
        atomic(self.envfile, env_text(self.env))
        if self.native_runtime():
            self.run_native_migrate()
        else:
            self.stage('Run database migrations')
            self.compose('run', '--rm', '--no-deps', 'migrate', timeout=600)
        self.start()
        self.activate(release)
        self.stage('Activate release and configure AMT startup')
        self._sync_startup_units(release)
        run(['systemctl', 'daemon-reload'])
        run(['systemctl', 'enable', 'amt-pricelist.service'])
        if self.native_runtime():
            run(['systemctl', 'enable', self.backup_timer_name()])
            run(['systemctl', 'start', self.backup_timer_name()])
        self.checkpoint('HEALTHY', current=release.name, previous=previous.name if previous else None)
        if first:
            atomic(journal, json.dumps({'commit': commit, 'candidate': release.name, 'completed': True}))
        self.event('INSTALLED' if first else 'UPGRADED', commit=commit, release=release.name)
        if not first and self.args.rotate:
            self.rotate()
        self.refresh_proxy()
        if not first:
            self.auto_cleanup_after_upgrade()
        upstream = self.stable_upstream()
        action = 'Install' if first else 'Upgrade'
        print(f'{action} complete: release {release.name} ({commit[:12]}).')
        if self.native_runtime():
            print('Auto-start on VPS reboot is enabled through systemd; PM2 manages the AMT app and worker, while PostgreSQL remains isolated.')
        else:
            print('Auto-start on VPS reboot is enabled through systemd and the AMT containers use restart-unless-stopped.')
        if not first:
            print(f'Users on {self.env["APP_ORIGIN"]}{BASE_PATH} should refresh their browser now to load the new release.')
        print(f"Ready: ssh -N -L {self.env['APP_PORT']}:{upstream} root@76.13.244.160")
        print(f"Open {self.env['APP_ORIGIN']}{BASE_PATH}. Read the setup token privately from {self.envfile}; it is never printed here.")

    def check_replace_failed(self):
        require(not (self.root / 'current').exists(), 'Cannot replace a release after activation')
        recovery = json.loads((self.state / 'install.json').read_text())
        require(not recovery.get('completed'), 'Installation already completed')
        state_file = self.state / 'deployment.json'
        if state_file.exists():
            require(json.loads(state_file.read_text()).get('phase') in ('BUILT', 'MIGRATING'), 'Replacement blocked after migrations or ambiguous recovery state')
        volumes = decoded(self.engine('volume', 'ls', '--format', '{{.Name}}')).splitlines()
        owned = [c for c in self.inventory() if self.owned(c)]
        services = {c.get('Config', {}).get('Labels', {}).get('com.docker.compose.service') for c in owned}
        require(services <= {'db'}, 'Application or ambiguous AMT containers already exist; replacement refused')
        if f'{PROJECT}_database' in volumes or 'db' in services:
            require(services == {'db'}, 'Database storage exists without exactly one recognized database container')
            self.release = self.recovery_release(recovery)
            exists = self.database("SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='migrations';", check=False)
            require(exists.returncode == 0 and decoded(exists) in ('0', '1'), 'Replacement refused because database state is ambiguous')
            if decoded(exists) == '1':
                applied = self.database('SELECT count(*) FROM migrations;', check=False)
                require(applied.returncode == 0 and decoded(applied) == '0', 'Replacement refused because database migrations exist or database state is ambiguous')

    def recovery_release(self, recovery):
        name = recovery.get('candidate')
        require(isinstance(name, str) and re.fullmatch(r'[a-f0-9]{12}-[a-f0-9]{8}', name), 'Recovery release is missing or invalid')
        release = self.root / 'releases' / name
        require(release.is_dir() and not release.is_symlink(), 'Recovery release missing or unsafe')
        metadata = json.loads((release / 'release.json').read_text())
        require(metadata.get('commit') == recovery.get('commit'), 'Recovery release commit mismatch')
        return release

    def verify_database_runtime(self):
        script = ("const {Client}=require('pg'); const shared={connectionTimeoutMillis:5000,query_timeout:5000,statement_timeout:5000}; "
                  "async function main(){const good=new Client({...shared,connectionString:process.env.DATABASE_URL}); "
                  "try{await good.connect(); await good.query('SELECT 1')}catch{return 20}finally{await good.end().catch(()=>{})} "
                  "const p=good.connectionParameters; const bad=new Client({...shared,host:p.host,port:p.port,database:p.database,user:p.user,password:'deliberately-invalid',ssl:false}); "
                  "try{await bad.connect(); await bad.end(); return 21}catch(error){return error.code==='28P01'?0:22}} main().then(code=>process.exit(code)).catch(()=>process.exit(23))")
        if self.native_runtime():
            result = run(['node', '-e', script], check=False, timeout=60, env=self.native_runtime_env(), cwd=self.release)
            if result.returncode == 20:
                raise DeployError('Local PM2 database connection failed before migrations')
        else:
            result = self.compose('run', '--rm', '--no-deps', 'migrate', 'node', '-e', script, check=False, timeout=60)
            if result.returncode == 20:
                raise DeployError('Private PostgreSQL socket connection failed before migrations')
        if result.returncode == 21:
            raise DeployError('PostgreSQL authentication accepted an invalid password; SCRAM policy is not enforced')
        require(result.returncode == 0, 'PostgreSQL authentication self-test failed unexpectedly')

    def _caddy_context(self):
        result = decoded(run(['systemctl', 'show', 'caddy', '--property=ActiveState', '--property=ExecStart', '--no-pager']))
        require('ActiveState=active' in result and '--config /etc/caddy/Caddyfile' in result,
                'Active Caddy service/configuration path differs from the inspected deployment')
        path = Path('/etc/caddy/Caddyfile')
        require(path.is_file() and not path.is_symlink() and path.stat().st_uid == 0 and path.stat().st_mode & 0o022 == 0,
                'Caddyfile must be a root-owned, non-writable regular file')
        text = path.read_text()
        require('import ' not in text and re.search(r'(?m)^\s*import\s+', text) is None,
                'Caddy imports were introduced after inspection; manual review required')
        run(['caddy', 'validate', '--config', path, '--adapter', 'caddyfile'])
        adapted = decoded(run(['caddy', 'adapt', '--config', '-', '--adapter', 'caddyfile'], data=text.encode()))
        config = json.loads(adapted)
        rendered = json.dumps(config, sort_keys=True)
        for expected in ('softwaresolver.online', 'localhost:3000', 'localhost:3007', '/al-ameen*'):
            require(expected in rendered, 'Existing Caddy routes differ from the inspected structural baseline')
        return path, text, path.stat().st_mode & 0o777

    @staticmethod
    def _http_status(url):
        result = run(['curl', '--silent', '--show-error', '--output', '/dev/null', '--max-time', '15',
                      '--write-out', '%{http_code}', url], check=False, timeout=20)
        return decoded(result), result.returncode

    def _apply_caddy(self, target, upstream):
        path, original, mode = self._caddy_context()
        candidate, created_site = caddy_candidate(original, target, upstream)
        if candidate == original:
            return created_site
        proxy_dir = self.state / 'proxy'
        proxy_dir.mkdir(mode=0o700, exist_ok=True)
        require(not proxy_dir.is_symlink() and (os.name != 'posix' or proxy_dir.stat().st_mode & 0o077 == 0), 'Proxy recovery directory is unsafe')
        checkpoint = proxy_dir / (dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + secrets.token_hex(4))
        checkpoint.mkdir(mode=0o700)
        atomic(checkpoint / 'Caddyfile.before', original)
        atomic(checkpoint / 'candidate.Caddyfile', candidate)
        run(['caddy', 'validate', '--config', checkpoint / 'candidate.Caddyfile', '--adapter', 'caddyfile'])
        target_root_status, target_root_rc = self._http_status(target['origin'] + '/')
        wrote_caddy = False
        try:
            atomic(path, candidate)
            path.chmod(mode)
            wrote_caddy = True
            run(['caddy', 'validate', '--config', path, '--adapter', 'caddyfile'])
            run(['systemctl', 'reload', 'caddy'])
            deadline = time.monotonic() + 120
            while time.monotonic() < deadline:
                code, rc = self._http_status(target['url'] + '/api/v1/health')
                if rc == 0 and code == '200':
                    break
                time.sleep(3)
            else:
                raise DeployError('Public AMT health check failed after Caddy reload')
            if target_root_rc == 0:
                current_root_status, rc = self._http_status(target['origin'] + '/')
                require(rc == 0 and current_root_status == target_root_status, 'Existing root application status changed')
            return created_site
        except Exception:
            if wrote_caddy:
                atomic(path, original)
                path.chmod(mode)
                run(['caddy', 'validate', '--config', path, '--adapter', 'caddyfile'], check=False)
                run(['systemctl', 'reload', 'caddy'], check=False)
            raise

    def refresh_proxy(self):
        caddyfile = Path('/etc/caddy/Caddyfile')
        if not caddyfile.is_file():
            return
        target_url = None
        public_file = self.state / 'public-url.json'
        if public_file.is_file():
            try:
                target_url = json.loads(public_file.read_text()).get('url')
            except Exception:
                pass
        if not target_url and self.env and self.env.get('APP_ORIGIN'):
            origin = self.env['APP_ORIGIN']
            if origin != f"http://localhost:{self.env.get('APP_PORT')}":
                target_url = origin + BASE_PATH
        if not target_url:
            try:
                text = caddyfile.read_text()
                match = re.search(r'# BEGIN AMT PRICE LIST (?:ROUTE|SITE)\s+(\S+)', text)
                if match:
                    target_url = match.group(1)
            except Exception:
                pass
        if not target_url:
            return
        target = parse_public_url(target_url)
        try:
            upstream = self.healthy_upstream()
        except Exception:
            upstream = self.stable_upstream()
        self.stage(f'Refresh Caddy proxy upstream to {upstream}')
        created_site = self._apply_caddy(target, upstream)
        atomic(self.state / 'public-url.json', json.dumps({'url': target['url'], 'createdSite': created_site,
                                                           'upstream': upstream,
                                                           'updatedAt': dt.datetime.now(dt.timezone.utc).isoformat()}))
        self.event('PROXY_REFRESHED', url=target['url'], upstream=upstream)
        print(f'AMT Caddy proxy upstream verified at {upstream} for {target["url"]}.')

    def public_url(self, dry_run=False):
        require(self.args.url, f'set-public-url requires --url ending in {BASE_PATH}')
        target = parse_public_url(self.args.url)
        if target['scheme'] == 'https':
            addresses = {item[4][0] for item in socket.getaddrinfo(target['host'], 443, type=socket.SOCK_STREAM)}
            require('76.13.244.160' in addresses, 'Domain DNS does not point to this VPS IPv4 address')
        path, original, mode = self._caddy_context()
        upstream = self.stable_upstream()
        candidate, created_site = caddy_candidate(original, target, upstream)
        if dry_run:
            with tempfile.NamedTemporaryFile('w', prefix='amt-caddy-', suffix='.tmp', delete=False) as temp:
                temp.write(candidate)
                temp_path = Path(temp.name)
            try:
                run(['caddy', 'validate', '--config', temp_path, '--adapter', 'caddyfile'])
            finally:
                temp_path.unlink(missing_ok=True)
            print(f'Dry-run URL validated for {target["url"]}; existing Caddyfile and AMT services were not changed.')
            return
        self.stage(f'Configure public URL {target["url"]}')
        old_env = dict(self.env)
        replacement = dict(self.env, APP_ORIGIN=target['origin'], APP_BASE_PATH=BASE_PATH,
                           COOKIE_SECURE='true' if target['scheme'] == 'https' else 'false')
        wrote_env = False
        try:
            atomic(self.envfile, env_text(replacement))
            self.env = replacement
            wrote_env = True
            if self.native_runtime():
                self.start()
            else:
                self.compose('up', '-d', '--no-deps', '--no-build', '--force-recreate', *SERVICES)
            self.healthy()
            created_site = self._apply_caddy(target, self.stable_upstream())
            atomic(self.state / 'public-url.json', json.dumps({'url': target['url'], 'createdSite': created_site,
                                                               'updatedAt': dt.datetime.now(dt.timezone.utc).isoformat()}))
            self.event('PUBLIC_URL_CHANGED', url=target['url'])
            print(f'Public AMT URL verified: {target["url"]}. Sign in again on the new hostname.')
        except Exception:
            if wrote_env:
                atomic(self.envfile, env_text(old_env))
                self.env = old_env
                if self.native_runtime():
                    self.start()
                else:
                    self.compose('up', '-d', '--no-deps', '--no-build', '--force-recreate', *SERVICES, check=False)
            raise

    def rollback(self):
        require(self.args.release and re.fullmatch(r'[a-f0-9]{12}-[a-f0-9]{8}', self.args.release), 'Specify an exact --release directory name')
        target = self.root / 'releases' / self.args.release
        require(target.is_dir() and not target.is_symlink(), 'Rollback release is missing or unsafe')
        require(self.migration_files(target) == self.migration_files(self.release), 'Rollback blocked: migration sets differ; use isolated recovery review')
        applied = decoded(self.database('SELECT name FROM migrations ORDER BY name;')).splitlines()
        require(applied == list(self.migration_files(target)), 'Actual database migration set is incompatible with rollback')
        self.stop()
        self.snapshot()
        self.checkpoint('ROLLBACK', previous=self.release.name, candidate=target.name)
        self.release = target
        self.start()
        self.activate(target)
        self.checkpoint('HEALTHY', current=target.name)
        self.event('ROLLED_BACK', release=target.name)
        self.refresh_proxy()

    def restore_check(self):
        require(self.args.backup, 'Specify --backup with an exact completed recovery directory')
        backup = Path(self.args.backup).resolve(strict=True)
        require(backup.parent == self.root / 'recovery' and (backup / 'COMPLETE').is_file(), 'Not a completed project recovery backup')
        manifest = json.loads((backup / 'manifest.json').read_text())
        for name in ['database.dump', 'uploads.tar']:
            with (backup / name).open('rb') as f:
                require(hashlib.file_digest(f, 'sha256').hexdigest() == manifest['sha256'][name], 'Backup checksum mismatch')
        token = secrets.token_hex(6)
        name, volume, network = (f'{PROJECT}-restore-{token}-{x}' for x in ['db', 'data', 'net'])
        drill = self.state / ('restore-' + token)
        drill.mkdir(mode=0o700)
        password = secrets.token_hex(32)
        atomic(drill / '.env', f'POSTGRES_USER=amt_restore\nPOSTGRES_DB=amt_restore\nPOSTGRES_PASSWORD={password}\n')
        self.engine('network', 'create', '--internal', '--label', 'amt.restore=' + token, network)
        self.engine('volume', 'create', '--label', 'amt.restore=' + token, volume)
        self.engine('run', '-d', '--name', name, '--label', 'amt.restore=' + token, '--network', network, '--env-file', drill / '.env', '-v', volume + ':/var/lib/postgresql/data', DB_IMAGE)
        atomic(drill / 'resources.json', json.dumps({'container': name, 'volume': volume, 'network': network}))
        for _ in range(60):
            if self.engine('exec', name, 'pg_isready', '-U', 'amt_restore', '-d', 'amt_restore', check=False).returncode == 0:
                break
            time.sleep(2)
        else:
            raise DeployError('Restore database did not start; retained isolated resources for inspection')
        self.engine('cp', backup / 'database.dump', name + ':/tmp/restore.dump')
        self.engine('exec', name, 'pg_restore', '--exit-on-error', '--no-owner', '--no-acl', '-U', 'amt_restore', '-d', 'amt_restore', '/tmp/restore.dump', timeout=900)
        query = "SELECT json_build_object('products',(SELECT count(*) FROM products),'quotations',(SELECT count(*) FROM quotations),'users',(SELECT count(*) FROM users))::text;"
        counts = decoded(self.engine('exec', name, 'psql', '-X', '-U', 'amt_restore', '-d', 'amt_restore', '-Atc', query))
        require(json.loads(counts) == manifest['counts'], 'Restored record counts do not match backup')
        seq = decoded(self.engine('exec', name, 'psql', '-X', '-U', 'amt_restore', '-d', 'amt_restore', '-Atc', "SELECT last_value::text || ':' || is_called::text FROM quotation_serial_seq;"))
        require(seq == manifest['quotationSequence'], 'Restored quotation sequence mismatch')
        # No app/worker is attached to the restored DB: it cannot issue duplicate quotations.
        self.engine('stop', name)
        self.event('RESTORE_CHECKED', backup=backup.name, resources=str(drill))
        print(f'Restore counts and quotation sequence verified. Isolated stopped resources retained: {drill}')

    def cleanup(self):
        self.load_environment()
        phase_file = self.state / 'deployment.json'
        require(phase_file.is_file(), 'Cleanup requires a deployment state file')
        phase = json.loads(phase_file.read_text()).get('phase')
        require(phase == 'HEALTHY', 'Cleanup is allowed only after a healthy deployment')
        plan = self.cleanup_plan()
        self.print_cleanup_plan(plan)

        if self.args.dry_run:
            print('Dry-run cleanup only. No releases, images, logs or recovery backups were removed.')
            return

        self.apply_cleanup_plan(plan)
        print('Cleanup complete. Current release, one rollback release, current state, and shared secrets were preserved.')

    def status(self):
        self.load_environment()
        current_link = self.root / 'current'
        if current_link.exists():
            self.current()
            print(f'Runtime: {self.runtime()}')
            print(decoded(self.compose('ps', 'db')))
            if self.native_runtime():
                print(decoded(run(['pm2', 'status'], check=False, env=self.native_runtime_env())))
                timer_enabled = decoded(run(['systemctl', 'is-enabled', self.backup_timer_name()], check=False)) or 'unknown'
                timer_active = decoded(run(['systemctl', 'is-active', self.backup_timer_name()], check=False)) or 'unknown'
                print(f'Backup timer: {timer_enabled} / {timer_active}.')
            else:
                print(decoded(self.compose('ps')))
            enabled = decoded(run(['systemctl', 'is-enabled', 'amt-pricelist.service'], check=False)) or 'unknown'
            active = decoded(run(['systemctl', 'is-active', 'amt-pricelist.service'], check=False)) or 'unknown'
            print(f'Auto-start on VPS reboot: {"enabled" if enabled == "enabled" else enabled}. Systemd state: {active}.')
            return
        details = []
        install_file = self.state / 'install.json'
        if install_file.is_file():
            try:
                install_data = json.loads(install_file.read_text())
                if install_data.get('commit'):
                    details.append(f"commit: {install_data['commit']}")
                if install_data.get('candidate'):
                    details.append(f"candidate: {install_data['candidate']}")
            except Exception:
                pass
        deployment_file = self.state / 'deployment.json'
        if deployment_file.is_file():
            try:
                dep_data = json.loads(deployment_file.read_text())
                if dep_data.get('phase'):
                    details.append(f"phase: {dep_data['phase']}")
            except Exception:
                pass
        recovery_info = f" ({', '.join(details)})" if details else ""
        print(f"Installation incomplete; recovery state active{recovery_info}. Use 'install --resume' or 'recover-install' to complete.")

    def setup_token(self):
        self.load_environment()
        print('Current deployment setup token (handle privately; first-run setup only):')
        print(self.env['SETUP_TOKEN'])

    def execute(self):
        self.stage('Check runtime, memory, ownership and ports')
        self.preflight()
        if self.args.command == 'status':
            self.status()
            return
        if self.args.command == 'setup-token':
            self.setup_token()
            return
        if self.args.command == 'cleanup':
            self.cleanup()
            return
        if self.args.command == 'install':
            if self.args.resume:
                self.load_environment()
                self.port(int(self.env['APP_PORT']))
            else:
                require(not self.root.exists(), 'Existing installation directory: use install --resume only for an interrupted first install')
                self.port()
        if self.args.command not in ['install', 'status', 'start', 'stop', 'setup-token', 'cleanup', 'backup-job']:
            self.current()
            self.port(int(self.env['APP_PORT']))
        elif self.args.command in ['start', 'stop', 'backup-job']:
            self.current()
        if self.args.dry_run:
            if self.args.command == 'set-public-url':
                self.public_url(dry_run=True)
            if self.args.command == 'cleanup':
                self.cleanup()
                return
            if self.args.command in ['install', 'upgrade']:
                _, requested_commit = self.source(fetch=False)
                if self.args.replace_failed_release or (self.args.recover_install and requested_commit != json.loads((self.state / 'install.json').read_text()).get('commit')):
                    self.check_replace_failed()
            print('Dry run: inspected only. No fetch, files, containers, migrations, secrets or system services changed.')
            return
        require(self.args.command in ['start', 'stop', 'setup-token', 'backup-job'] or self.args.access_verified, 'Confirm SSH-key verification and separate root-password rotation with --access-verified')
        with self.locked():
            if self.root.exists():
                self.log_ready()
            if self.root.exists() and (self.state / 'rotation.json').exists():
                require(self.args.command == 'rotate-secrets' and self.args.resume, 'Interrupted rotation: only rotate-secrets --resume is permitted')
            before = {c['Id']: c.get('State', {}).get('Status') for c in self.inventory() if not self.owned(c)}
            try:
                command = self.args.command
                if command in ['install', 'upgrade']:
                    self.deploy(command == 'install')
                elif command == 'rotate-secrets':
                    self.rotate(self.args.resume)
                elif command == 'backup':
                    self.stop()
                    self.snapshot()
                    self.start()
                elif command == 'restore-check':
                    self.restore_check()
                elif command == 'rollback':
                    self.rollback()
                elif command == 'set-public-url':
                    self.public_url()
                elif command == 'cleanup':
                    self.cleanup()
                elif command == 'backup-job':
                    self.run_backup_job()
                elif command == 'start':
                    phase = json.loads((self.state / 'deployment.json').read_text()).get('phase')
                    require(phase == 'HEALTHY', 'Incomplete deployment must be recovered before boot startup')
                    self.compose('up', '-d', '--no-deps', '--no-build', 'db')
                    self.wait_db()
                    self.start()
                    self.refresh_proxy()
                elif command == 'stop':
                    self.stop()
            finally:
                after = {c['Id']: c.get('State', {}).get('Status') for c in self.inventory() if not self.owned(c) and c['Id'] in before}
                if after != before:
                    print('WARNING: unrelated container state changed; investigate without automatically restarting it.', file=sys.stderr)

def arguments(argv=None):
    parser = argparse.ArgumentParser(description='AMT-only VPS deployment; no root/user password changes or public proxy configuration')
    parser.add_argument('command', nargs='?', choices=['install', 'recover-install', 'upgrade', 'status', 'backup', 'restore-check', 'rotate-secrets', 'rollback', 'start', 'stop', 'cleanup', 'setup-token', 'set-public-url', 'backup-job'])
    parser.add_argument('--source', default=str(Path(__file__).resolve().parents[2]), help='Clean Git checkout; not a deployed release directory')
    parser.add_argument('--ref', default='origin/master')
    parser.add_argument('--release', help='Exact retained release directory for rollback')
    parser.add_argument('--backup', help='Exact completed recovery backup directory for restore verification')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--runtime', choices=['compose', 'pm2'],
                        help='Runtime for app and worker processes; database remains dedicated and isolated')
    parser.add_argument('--build-network', choices=['default', 'host'],
                        help='Image builds only: host grants build processes access to host-network services; runtime isolation is unchanged')
    parser.add_argument('-v', '--verbose', '--v', action='store_true', help='Extra timings and safe diagnostics; build output is always visible')
    parser.add_argument('--yes', action='store_true', help='Explicit non-interactive approval; never implies secret rotation')
    parser.add_argument('--access-verified', action='store_true', help='Operator confirms SSH-key access and separately rotated VPS root password')
    parser.add_argument('--rotate', action='store_true', help='Explicitly opt into app-secret rotation after a successful upgrade')
    parser.add_argument('--resume', action='store_true', help='Recover an interrupted first install or credential rotation')
    parser.add_argument('--replace-failed-release', action='store_true', help='Replace a pinned first-install release only before any application migration')
    parser.add_argument('--url', help='Public URL ending in /amt_price_list; HTTP only for the approved VPS IP, HTTPS for a domain')
    args = parser.parse_args(argv)
    if not args.command:
        require(sys.stdin.isatty(), 'Non-interactive use requires an explicit command and --yes')
        options = ['install', 'recover-install', 'upgrade', 'status', 'backup', 'restore-check', 'rotate-secrets', 'rollback', 'cleanup', 'setup-token', 'set-public-url']
        for i, item in enumerate(options, 1):
            print(f'{i}. {item}')
        choice = input('Select command: ').strip()
        require(choice.isdigit() and 1 <= int(choice) <= len(options), 'Invalid selection')
        args.command = options[int(choice) - 1]
    args.recover_install = args.command == 'recover-install'
    if args.recover_install:
        args.command = 'install'
        args.resume = True
        args.build_network = 'host'
    elif args.command == 'upgrade' and args.build_network is None:
        args.build_network = 'host'
    elif args.build_network is None:
        args.build_network = 'default'
    require(not args.replace_failed_release or (args.command == 'install' and args.resume), '--replace-failed-release requires install --resume')
    require(not args.url or args.command == 'set-public-url', '--url is valid only with set-public-url')
    if args.command == 'set-public-url' and not args.url and sys.stdin.isatty():
        args.url = input('Public URL (including /amt_price_list): ').strip()
    if not args.dry_run and args.command not in ['status', 'start', 'stop', 'setup-token']:
        if args.recover_install and not args.yes:
            approved = (sys.stdin.isatty() and
                        input('Recover the interrupted AMT install now? Confirm your SSH-key VPS access still works. (y/N): ').lower() == 'y')
            require(approved, 'Cancelled; use --yes --access-verified for non-interactive recovery')
            args.access_verified = True
        else:
            if not args.access_verified and sys.stdin.isatty():
                args.access_verified = input('SSH-key access verified AND root password separately rotated? (y/N): ').lower() == 'y'
            if not args.yes:
                require(sys.stdin.isatty() and input(f'Run AMT {args.command}? Brief app-only downtime may occur. (y/N): ').lower() == 'y', 'Cancelled; use --yes for non-interactive operation')
        if args.command == 'upgrade' and not args.rotate and sys.stdin.isatty() and not args.yes:
            args.rotate = input('Rotate AMT app secrets after upgrade? (y/N): ').lower() == 'y'
    return args

def main():
    global REPORT
    os.umask(0o077)
    try:
        args = arguments()
        REPORT = Diagnostics(args.verbose)
        Deployment(args).execute()
    except (DeployError, ValueError, KeyError, OSError) as error:
        # Never print raw exception contents from engine output/environment parsing.
        message = str(error) if isinstance(error, DeployError) else 'Unexpected filesystem/configuration failure; inspect private recovery state'
        if REPORT:
            recent = list(REPORT.tail)
            if recent:
                REPORT.emit(f'Failure context for stage: {REPORT.stage_name}')
                for line in recent[-8:]:
                    REPORT.emit('    ' + line)
            REPORT.emit('STOP: ' + message)
            if REPORT.path:
                REPORT.emit(f'Review redacted diagnostics: {REPORT.path}')
        else:
            print('STOP: ' + message, file=sys.stderr)
        print('No global cleanup or automatic database restore was attempted. Retain all recovery files.', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('Interrupted. Retain recovery state; resume credential rotation if its journal exists.', file=sys.stderr)
        return 130
    finally:
        if REPORT:
            REPORT.close()
        REPORT = None
    return 0

if __name__ == '__main__':
    sys.exit(main())
