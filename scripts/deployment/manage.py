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

ROOT = Path('/opt/shop-pricelist')
PROJECT = 'amt-pricelist'
DB_IMAGE = 'postgres:17-bookworm'
SERVICES = ('app', 'worker', 'backup')
ENV_KEYS = {'POSTGRES_USER', 'POSTGRES_DB', 'POSTGRES_PASSWORD', 'DATABASE_URL', 'SETUP_TOKEN', 'APP_PORT', 'APP_ORIGIN', 'COOKIE_SECURE', 'PDF_MAX_PAGES', 'UPLOAD_MAX_MB', 'BACKUP_RETENTION_DAYS', 'UPLOAD_DIR', 'BACKUP_DIR'}

class DeployError(Exception):
    pass

def require(condition, message):
    if not condition:
        raise DeployError(message)

def run(args, *, data=None, output=None, timeout=300, check=True):
    # No command includes credentials. Do not echo raw stderr: engines can render env values.
    try:
        result = subprocess.run([str(a) for a in args], input=data, stdout=output or subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise DeployError(f'{args[0]} failed or timed out; no credentials were logged') from None
    if check and result.returncode:
        raise DeployError(f'{args[0]} operation failed (exit {result.returncode}); stopped safely')
    return result

def decoded(result):
    return (result.stdout or b'').decode('utf-8').strip()

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
    require(values.get('APP_ORIGIN') == f"http://localhost:{values['APP_PORT']}" and values.get('COOKIE_SECURE') == 'false', 'This installer supports loopback tunnel mode only; HTTPS needs a reviewed domain configuration')
    return values

def env_text(values):
    result = dict(values)
    result['DATABASE_URL'] = f"postgresql://{result['POSTGRES_USER']}:{result['POSTGRES_PASSWORD']}@db:5432/{result['POSTGRES_DB']}"
    return ''.join(f'{k}={v}\n' for k, v in sorted(result.items()))

def new_env(port):
    return dict(POSTGRES_USER='amt', POSTGRES_DB='amt_pricelist', POSTGRES_PASSWORD=secrets.token_hex(32),
                SETUP_TOKEN=secrets.token_hex(32), APP_PORT=str(port), APP_ORIGIN=f'http://localhost:{port}',
                COOKIE_SECURE='false', PDF_MAX_PAGES='100', UPLOAD_MAX_MB='20', BACKUP_RETENTION_DAYS='14',
                UPLOAD_DIR='/data/uploads', BACKUP_DIR='/data/backups')

def project_label(labels):
    labels = labels or {}
    return labels.get('com.docker.compose.project') or labels.get('io.podman.compose.project')

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

    def engine(self, *args, **kwargs):
        return run(['docker', *args], **kwargs)

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

    def ownership(self, first=False):
        for item in self.inventory():
            name = item.get('Name', '').lstrip('/')
            if name.startswith(PROJECT):
                require(self.owned(item), 'Conflicting container name is not owned by this project')
            if first:
                require(not self.owned(item), 'Project resources already exist; refusing first-install adoption')
        for kind, names in [('volume', ['database', 'uploads', 'backups']), ('network', ['private'])]:
            listed = decoded(self.engine(kind, 'ls', '--format', '{{.Name}}')).splitlines()
            for suffix in names:
                name = f'{PROJECT}_{suffix}'
                if name in listed:
                    require(not first, 'Existing dedicated resources need manual ownership review')
                    resource = json.loads(decoded(self.engine(kind, 'inspect', name)))[0]
                    require(project_label(resource.get('Labels')) == PROJECT, 'Volume/network ownership mismatch')
                    if kind == 'network':
                        require(resource.get('Internal') is True, 'Dedicated network is not internal')
        for item in self.inventory():
            if not self.owned(item):
                continue
            service = item.get('Config', {}).get('Labels', {}).get('com.docker.compose.service')
            if service == 'db':
                mounts = [m for m in item.get('Mounts', []) if m.get('Destination') == '/var/lib/postgresql/data']
                require(len(mounts) == 1 and mounts[0].get('Name') == PROJECT + '_database', 'Database volume mismatch')
                require(not any(item.get('HostConfig', {}).get('PortBindings', {}).values()), 'Database must not publish ports')

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
        require(os.geteuid() == 0, 'Run through an authorized root/sudo session')
        for tool in ['docker', 'git', 'ss', 'curl', 'systemctl']:
            require(shutil.which(tool), f'Missing prerequisite: {tool}. No packages were installed')
        self.engine('version')
        self.engine('compose', 'version')
        require(shutil.disk_usage('/opt').free >= 12 * 1024**3, 'At least 12 GiB free disk is required')
        memory = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
        require(int(memory['MemAvailable'].split()[0]) >= 4 * 1024**2, 'At least 4 GiB available RAM is required')
        self.ownership(first=not self.root.exists())
        print('Runtime, capacity and project ownership checks passed. Shared proxy/firewall configuration is unchanged.')

    def current(self):
        require(self.root.is_dir() and not self.root.is_symlink(), 'Deployment root is missing or unsafe')
        require((self.root / '.amt-owner').read_text().strip() == PROJECT, 'Deployment directory ownership marker mismatch')
        require(self.root.stat().st_uid == 0 and self.root.stat().st_mode & 0o077 == 0, 'Deployment root must be root-owned mode 0700')
        self.release = (self.root / 'current').resolve(strict=True)
        require(self.release.parent == self.root / 'releases' and self.release.is_dir(), 'Current release points outside the deployment')
        self.env = read_env(self.envfile)

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

    def database(self, sql, env=None, check=True):
        env = env or self.env
        script = 'IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -X -h 127.0.0.1 -U "$1" -d "$2" -At -v ON_ERROR_STOP=1'
        return self.engine('exec', '-i', self.db_id(), 'sh', '-c', script, 'amt', env['POSTGRES_USER'], env['POSTGRES_DB'],
                           data=(env['POSTGRES_PASSWORD'] + '\n' + sql + '\n').encode(), check=check)

    def healthy(self):
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if self.database('SELECT 1;', check=False).returncode == 0:
                result = run(['curl', '--silent', '--fail', '--max-time', '5', f"http://127.0.0.1:{self.env['APP_PORT']}/api/v1/health"], check=False, timeout=10)
                ids = decoded(self.compose('ps', '-q', *SERVICES)).split()
                if result.returncode == 0 and len(ids) == 3:
                    states = json.loads(decoded(self.engine('inspect', *ids)))
                    if all(c.get('State', {}).get('Running') for c in states):
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
        self.ownership()
        self.port(int(self.env['APP_PORT']))  # Immediate fail-closed recheck; never kill a listener.
        self.compose('up', '-d', '--no-deps', '--no-build', *SERVICES)
        self.healthy()

    def stop(self):
        self.compose('stop', '-t', '60', *SERVICES)

    def snapshot(self):
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
        self.compose('up', '-d', '--no-deps', '--no-build', '--force-recreate', *SERVICES)
        self.healthy()
        self.event('SECRETS_ROTATED')
        # Archive evidence privately rather than deleting recovery credentials automatically.
        archive = self.state / ('rotation-complete-' + secrets.token_hex(6))
        archive.mkdir(mode=0o700)
        for name in ['rotation.json', 'rotation-old.env', 'rotation-new.env']:
            os.replace(self.state / name, archive / name)
        print('App database credentials rotated and authenticated; user passwords and VPS access are unchanged.')

    def source(self, fetch=True):
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
        images = {s: {'image': f'{PROJECT}-' + ('app' if s == 'migrate' else s) + ':' + commit} for s in ['app', 'migrate', 'worker', 'backup']}
        atomic(release / 'deploy-images.json', json.dumps({'services': images}))
        atomic(release / 'release.json', json.dumps({'commit': commit, 'migrations': self.migration_files(release)}))
        self.compose('config', '--quiet', release=release)
        self.compose('build', 'app', 'worker', 'backup', release=release, timeout=3600)
        return release

    @staticmethod
    def migration_files(release):
        return {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted((release / 'database').glob('*.sql'))}

    def activate(self, release):
        temp = self.root / ('current-' + secrets.token_hex(4))
        temp.symlink_to(release, target_is_directory=True)
        os.replace(temp, self.root / 'current')
        self.release = release

    def deploy(self, first):
        source, commit = self.source()
        if first:
            require(not self.root.exists(), 'Install refuses an existing deployment directory')
            port = self.port()
            self.root.mkdir(mode=0o700)
            for directory in ['shared', 'state', 'releases', 'recovery']:
                (self.root / directory).mkdir(mode=0o700)
            atomic(self.root / '.amt-owner', PROJECT + '\n')
            self.env = new_env(port)
            atomic(self.envfile, env_text(self.env))
        else:
            self.current()
        previous = self.release
        release = self.prepare_release(source, commit)
        self.checkpoint('BUILT', previous=previous.name if previous else None, candidate=release.name)
        if previous:
            self.stop()
            self.snapshot()
            require(self.migration_files(previous).items() <= self.migration_files(release).items(), 'Migration removal/change is not an additive upgrade')
        self.release = release
        self.compose('up', '-d', '--no-deps', '--no-build', 'db')
        self.wait_db()
        self.checkpoint('MIGRATING', previous=previous.name if previous else None, candidate=release.name)
        self.compose('run', '--rm', '--no-deps', 'migrate', timeout=600)
        # Initialize only the dedicated volumes; no host/chown of unrelated application data.
        for volume in ['uploads', 'backups']:
            self.engine('run', '--rm', '--network', 'none', '-v', f'{PROJECT}_{volume}:/data', DB_IMAGE, 'chown', '1000:1000', '/data')
        self.start()
        self.activate(release)
        unit = release / 'docker/amt-pricelist.service'
        target = Path('/etc/systemd/system/amt-pricelist.service')
        if target.exists():
            require('AMT Price List isolated application' in target.read_text(), 'Existing systemd unit is not recognized; refusing overwrite')
        atomic(target, unit.read_bytes())
        target.chmod(0o644)
        run(['systemctl', 'daemon-reload'])
        run(['systemctl', 'enable', 'amt-pricelist.service'])
        self.checkpoint('HEALTHY', current=release.name, previous=previous.name if previous else None)
        self.event('INSTALLED' if first else 'UPGRADED', commit=commit, release=release.name)
        if not first and self.args.rotate:
            self.rotate()
        print(f"Ready: ssh -N -L {self.env['APP_PORT']}:127.0.0.1:{self.env['APP_PORT']} root@76.13.244.160")
        print(f"Open {self.env['APP_ORIGIN']}. Read the setup token privately from {self.envfile}; it is never printed here.")

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

    def execute(self):
        self.preflight()
        if self.args.command != 'install':
            self.current()
            self.port(int(self.env['APP_PORT']))
        if self.args.dry_run:
            if self.args.command in ['install', 'upgrade']:
                self.source(fetch=False)
            print('Dry run: inspected only. No fetch, files, containers, migrations, secrets or system services changed.')
            return
        if self.args.command == 'status':
            print(decoded(self.compose('ps')))
            return
        require(self.args.command in ['start', 'stop'] or self.args.access_verified, 'Confirm SSH-key verification and separate root-password rotation with --access-verified')
        with self.locked():
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
                elif command == 'start':
                    phase = json.loads((self.state / 'deployment.json').read_text()).get('phase')
                    require(phase == 'HEALTHY', 'Incomplete deployment must be recovered before boot startup')
                    self.compose('up', '-d', '--no-deps', '--no-build', 'db')
                    self.wait_db()
                    self.start()
                elif command == 'stop':
                    self.stop()
            finally:
                after = {c['Id']: c.get('State', {}).get('Status') for c in self.inventory() if not self.owned(c) and c['Id'] in before}
                if after != before:
                    print('WARNING: unrelated container state changed; investigate without automatically restarting it.', file=sys.stderr)

def arguments(argv=None):
    parser = argparse.ArgumentParser(description='AMT-only VPS deployment; no root/user password changes or public proxy configuration')
    parser.add_argument('command', nargs='?', choices=['install', 'upgrade', 'status', 'backup', 'restore-check', 'rotate-secrets', 'rollback', 'start', 'stop'])
    parser.add_argument('--source', default=str(Path(__file__).resolve().parents[2]), help='Clean Git checkout; not a deployed release directory')
    parser.add_argument('--ref', default='origin/master')
    parser.add_argument('--release', help='Exact retained release directory for rollback')
    parser.add_argument('--backup', help='Exact completed recovery backup directory for restore verification')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--yes', action='store_true', help='Explicit non-interactive approval; never implies secret rotation')
    parser.add_argument('--access-verified', action='store_true', help='Operator confirms SSH-key access and separately rotated VPS root password')
    parser.add_argument('--rotate', action='store_true', help='Explicitly opt into app-secret rotation after a successful upgrade')
    parser.add_argument('--resume', action='store_true', help='Recover an interrupted credential rotation')
    args = parser.parse_args(argv)
    if not args.command:
        require(sys.stdin.isatty(), 'Non-interactive use requires an explicit command and --yes')
        options = ['install', 'upgrade', 'status', 'backup', 'restore-check', 'rotate-secrets', 'rollback']
        for i, item in enumerate(options, 1):
            print(f'{i}. {item}')
        choice = input('Select command: ').strip()
        require(choice.isdigit() and 1 <= int(choice) <= len(options), 'Invalid selection')
        args.command = options[int(choice) - 1]
    if not args.dry_run and args.command not in ['status', 'start', 'stop']:
        if not args.access_verified and sys.stdin.isatty():
            args.access_verified = input('SSH-key access verified AND root password separately rotated? (y/N): ').lower() == 'y'
        if not args.yes:
            require(sys.stdin.isatty() and input(f'Run AMT {args.command}? Brief app-only downtime may occur. (y/N): ').lower() == 'y', 'Cancelled; use --yes for non-interactive operation')
        if args.command == 'upgrade' and not args.rotate and sys.stdin.isatty() and not args.yes:
            args.rotate = input('Rotate AMT app secrets after upgrade? (y/N): ').lower() == 'y'
    return args

def main():
    os.umask(0o077)
    try:
        Deployment(arguments()).execute()
    except (DeployError, ValueError, KeyError, OSError) as error:
        # Never print raw exception contents from engine output/environment parsing.
        message = str(error) if isinstance(error, DeployError) else 'Unexpected filesystem/configuration failure; inspect private recovery state'
        print('STOP: ' + message, file=sys.stderr)
        print('No global cleanup or automatic database restore was attempted. Retain all recovery files.', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('Interrupted. Retain recovery state; resume credential rotation if its journal exists.', file=sys.stderr)
        return 130
    return 0

if __name__ == '__main__':
    sys.exit(main())
