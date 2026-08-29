"""Local safety tests: no VPS, Docker engine, credentials or network required."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import contextlib
import io
import sys
import re
import time
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('deployment', ROOT / 'scripts/deployment/manage.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def result(text=''):
    return subprocess.CompletedProcess([], 0, text.encode(), b'')

class SafetyTests(unittest.TestCase):
    def deployment(self):
        args = m.arguments(['install', '--dry-run'])
        args.resume = False
        return m.Deployment(args)

    def test_first_free_port_skips_tcp_udp_and_reserved(self):
        self.assertEqual(m.choose_port({18180: ['*:18180']}, {18181: ['*:18181']}, {18182: False}), 18183)

    def test_exhausted_ports_fail(self):
        with self.assertRaises(m.DeployError):
            m.choose_port(dict.fromkeys(range(18180, 18200), ['occupied']), {}, {})

    def test_existing_port_retained_even_if_lower_free(self):
        self.assertEqual(m.choose_port({}, {}, {}, 18188), 18188)

    def test_own_running_port_allowed(self):
        self.assertEqual(m.choose_port({18188: ['127.0.0.1:18188']}, {}, {18188: False}, 18188, True), 18188)

    def test_pm2_state_parser_ignores_invalid_json_and_extracts_status(self):
        self.assertEqual(m.pm2_process_states('not-json'), {})
        parsed = m.pm2_process_states(json.dumps([
            {'name': 'amt-pricelist-app', 'pm2_env': {'status': 'online'}},
            {'name': 'other', 'pm2_env': {'status': 'stopped'}},
        ]))
        self.assertEqual(parsed['amt-pricelist-app'], 'online')
        self.assertEqual(parsed['other'], 'stopped')

    def test_foreign_or_unclear_listener_refused(self):
        for tcp, udp, reserved, running in [
            ({18188: ['127.0.0.1:18188']}, {}, {}, False),
            ({18188: ['0.0.0.0:18188']}, {}, {}, True),
            ({}, {18188: ['*:18188']}, {}, True),
            ({}, {}, {18188: True}, True),
        ]:
            with self.subTest(tcp=tcp, udp=udp, reserved=reserved):
                with self.assertRaises(m.DeployError):
                    m.choose_port(tcp, udp, reserved, 18188, running)

    def test_socket_parser_ipv4_ipv6_and_malformed(self):
        self.assertEqual(set(m.port_rows('LISTEN 0 128 127.0.0.1:18180 0.0.0.0:*\nLISTEN 0 128 [::]:18181 [::]:*')), {18180, 18181})
        with self.assertRaises(m.DeployError):
            m.port_rows('unexpected output')

    def test_resource_inspection_accepts_docker_and_native_podman_keys(self):
        labels = {'com.docker.compose.project': m.PROJECT}
        for resource in ({'Labels': labels, 'Internal': True}, {'labels': labels, 'internal': True}):
            self.assertEqual(m.project_label(m.resource_labels(resource)), m.PROJECT)
            self.assertIs(m.resource_internal(resource), True)

    def test_resource_inspection_rejects_missing_wrong_and_noninternal_metadata(self):
        self.assertIsNone(m.project_label(m.resource_labels({})))
        self.assertEqual(m.project_label(m.resource_labels({'labels': {'com.docker.compose.project': 'other'}})), 'other')
        self.assertIs(m.resource_internal({'internal': False}), False)
        with self.assertRaisesRegex(m.DeployError, 'Conflicting resource label schemas'):
            m.resource_labels({'Labels': {'a': '1'}, 'labels': {'a': '2'}})
        with self.assertRaisesRegex(m.DeployError, 'Conflicting network internal schemas'):
            m.resource_internal({'Internal': True, 'internal': False})

    def test_install_memory_threshold(self):
        m.check_memory(int(3.8 * 1024**2), 'install')
        m.check_memory(3 * 1024**2, 'install')
        with self.assertRaises(m.DeployError):
            m.check_memory(3 * 1024**2 - 1, 'install')

    def test_upgrade_memory_threshold(self):
        m.check_memory(int(2.8 * 1024**2), 'upgrade')
        m.check_memory(2 * 1024**2, 'upgrade')
        with self.assertRaises(m.DeployError):
            m.check_memory(2 * 1024**2 - 1, 'upgrade')

    def test_runtime_and_diagnostics_memory(self):
        m.check_memory(512 * 1024, 'start')
        with self.assertRaises(m.DeployError):
            m.check_memory(511 * 1024, 'start')
        for command in ('status', 'stop', 'backup', 'rotate-secrets', 'setup-token', 'cleanup'):
            m.check_memory(0, command)

    def test_sequential_bounded_native_builds(self):
        d = self.deployment()
        with patch.object(m, 'run', return_value=result()) as run:
            d.build_release(ROOT, 'a' * 40)
        self.assertEqual(len(run.call_args_list), 3)
        targets = []
        for call in run.call_args_list:
            args = call.args[0]
            self.assertEqual(args[:2], ['podman', 'build'])
            self.assertFalse(any(str(a).startswith('--network') for a in args))
            for flag in ('--jobs=1', '--memory=2g', '--memory-swap=2g', 'AMT_VERIFY_BUILD_LIMIT=1'):
                self.assertIn(flag, args)
            targets.append(args[args.index('--target') + 1])
        self.assertEqual(targets, ['app', 'worker', 'backup'])

    def test_host_network_builds_only(self):
        d = self.deployment()
        d.args.build_network = 'host'
        with patch.object(m, 'run', return_value=result()) as run:
            d.build_release(ROOT, 'a' * 40)
        for call in run.call_args_list:
            self.assertIn('--network=host', call.args[0])
            self.assertIn('--memory=2g', call.args[0])
            self.assertTrue(call.kwargs['live'])
        d.release = ROOT
        d.engine = Mock(return_value=result())
        d.compose('up', '-d', '--no-build', 'app', 'worker', 'backup')
        args = d.engine.call_args.args
        self.assertNotIn('--network=host', args)
        self.assertNotIn('--build-network', args)

    def test_build_network_cli_validation(self):
        self.assertEqual(m.arguments(['install', '--dry-run']).build_network, 'default')
        self.assertEqual(m.arguments(['upgrade', '--dry-run']).build_network, 'host')
        self.assertEqual(m.arguments(['install', '--resume', '--dry-run', '--build-network=host']).build_network, 'host')
        self.assertEqual(m.arguments(['upgrade', '--dry-run', '--build-network=default']).build_network, 'default')
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            m.arguments(['install', '--dry-run', '--build-network=untrusted'])
        self.assertEqual(error.exception.code, 2)

    def test_recover_install_defaults_to_safe_one_command_settings(self):
        args = m.arguments(['recover-install', '--dry-run'])
        self.assertEqual(args.command, 'install')
        self.assertTrue(args.recover_install)
        self.assertTrue(args.resume)
        self.assertEqual(args.ref, 'origin/master')
        self.assertEqual(args.build_network, 'host')

    def test_setup_token_command_is_accepted(self):
        args = m.arguments(['setup-token'])
        self.assertEqual(args.command, 'setup-token')
        self.assertFalse(args.dry_run)

    def test_cleanup_command_is_accepted(self):
        args = m.arguments(['cleanup', '--dry-run'])
        self.assertEqual(args.command, 'cleanup')
        self.assertTrue(args.dry_run)

    def test_resumed_build_uses_host_network_and_original_commit(self):
        with tempfile.TemporaryDirectory() as temp:
            d = self.resume_fixture(temp)
            d.args.build_network = 'host'
            original_password = d.env['POSTGRES_PASSWORD']
            def prepare(source, commit):
                self.assertEqual(commit, 'a' * 40)
                d.build_release(ROOT, commit)
            d.prepare_release = Mock(side_effect=prepare)
            with patch.object(m, 'run', side_effect=m.DeployError('build failed')) as run:
                with self.assertRaises(m.DeployError):
                    d.deploy(True)
            self.assertIn('--network=host', run.call_args.args[0])
            self.assertIn('localhost/amt-pricelist-app:' + 'a' * 40, run.call_args.args[0])
            self.assertEqual(d.env['POSTGRES_PASSWORD'], original_password)
            d.port.assert_called_once_with(18188)
            self.assertEqual(json.loads((d.state / 'install.json').read_text())['commit'], 'a' * 40)

    def test_failed_build_stops_before_next_image(self):
        d = self.deployment()
        with patch.object(m, 'run', side_effect=m.DeployError('build failed')) as run:
            with self.assertRaises(m.DeployError):
                d.build_release(ROOT, 'a' * 40)
        self.assertEqual(run.call_count, 1)

    def test_volume_labels_before_initialization(self):
        d = self.deployment()
        d.ownership = Mock()
        d.engine = Mock(return_value=result())
        d.initialize_volumes()
        creates = [c.args for c in d.engine.call_args_list if c.args[:2] == ('volume', 'create')]
        self.assertEqual(len(creates), 4)
        for args in creates:
            self.assertIn('com.docker.compose.project=amt-pricelist', args)
        self.assertEqual(d.ownership.call_count, 2)
        helpers = [c.args for c in d.engine.call_args_list if c.args[0] == 'run']
        self.assertEqual(len(helpers), 3)
        self.assertTrue(all('none' in c and any('chown' in str(part) for part in c) for c in helpers))
        socket_helper = next(c for c in helpers if 'amt-pricelist_database_socket:/socket' in c)
        self.assertTrue(any('chmod 0777' in str(part) for part in socket_helper))

    def test_ownership_failure_prevents_volume_writes(self):
        d = self.deployment()
        d.ownership = Mock(side_effect=m.DeployError('foreign volume'))
        d.engine = Mock()
        with self.assertRaises(m.DeployError):
            d.initialize_volumes()
        d.engine.assert_not_called()

    @staticmethod
    def legacy_database_container(*, mounts=None, ports=None, service='db', project=m.PROJECT):
        return {
            'Name': '/amt-pricelist-db-1',
            'Config': {'Labels': {
                'com.docker.compose.project': project,
                'com.docker.compose.service': service,
            }},
            'Mounts': mounts if mounts is not None else [{
                'Type': 'volume', 'Name': 'amt-pricelist_database',
                'Destination': '/var/lib/postgresql/data',
            }],
            'HostConfig': {'PortBindings': ports or {}},
        }

    def ownership_fixture(self, container):
        d = self.deployment()
        d.inventory = Mock(return_value=[container])
        labels = {'com.docker.compose.project': m.PROJECT}
        resources = {
            'amt-pricelist_database': {'Labels': labels},
            'amt-pricelist_uploads': {'Labels': labels},
            'amt-pricelist_backups': {'Labels': labels},
            'amt-pricelist_private': {'labels': labels, 'internal': True},
        }
        def engine(*args, **kwargs):
            if args[1] == 'ls':
                names = [name for name in resources if name.startswith('amt-pricelist_')]
                if args[0] == 'network':
                    names = ['amt-pricelist_private']
                elif args[0] == 'volume':
                    names = [name for name in names if name != 'amt-pricelist_private']
                return result('\n'.join(names))
            return result(json.dumps([resources[args[2]]]))
        d.engine = Mock(side_effect=engine)
        return d

    def test_only_explicit_recovery_preflight_accepts_legacy_database_without_socket(self):
        d = self.ownership_fixture(self.legacy_database_container())
        with self.assertRaisesRegex(m.DeployError, 'Database socket volume mismatch'):
            d.ownership()
        d.ownership(allow_legacy_db=True)

    def test_legacy_recovery_still_rejects_unexpected_mounts_and_published_database(self):
        mounts = self.legacy_database_container()['Mounts'] + [{
            'Type': 'volume', 'Name': 'foreign', 'Destination': '/unexpected',
        }]
        d = self.ownership_fixture(self.legacy_database_container(mounts=mounts))
        with self.assertRaisesRegex(m.DeployError, 'unexpected mounts'):
            d.ownership(allow_legacy_db=True)
        d = self.ownership_fixture(self.legacy_database_container(ports={'5432/tcp': [{'HostPort': '5432'}]}))
        with self.assertRaisesRegex(m.DeployError, 'stay unpublished or bind only to loopback'):
            d.ownership(allow_legacy_db=True)

    def test_preflight_enables_legacy_allowance_only_for_explicit_replacement(self):
        d = self.deployment()
        d.engine = Mock(return_value=result('podman'))
        d.ownership = Mock()
        with patch.object(m.sys, 'platform', 'linux'), patch.object(m.sys, 'version_info', (3, 12)), \
             patch.object(m.os, 'geteuid', return_value=0, create=True), patch.object(m.shutil, 'which', return_value='/bin/tool'), \
             patch.object(m.shutil, 'disk_usage', return_value=Mock(free=13 * 1024**3)), \
             patch.object(m.Path, 'read_text', return_value='MemAvailable: 4194304 kB\n'), \
             patch.object(m, 'run', side_effect=lambda args, **kwargs: result('v24.0.0') if args == ['node', '--version'] else result('{"host":{"cgroupVersion":"v2","security":{"rootless":false}}}')):
            d.preflight()
            self.assertFalse(d.ownership.call_args.kwargs['allow_legacy_db'])
            d.args.resume = True
            d.args.replace_failed_release = True
            d.preflight()
        self.assertTrue(d.ownership.call_args.kwargs['allow_legacy_db'])

    def test_pm2_preflight_requires_node_24_or_newer(self):
        d = self.deployment()
        d.args.command = 'upgrade'
        d.args.runtime = 'pm2'
        d.engine = Mock(return_value=result('podman'))
        d.ownership = Mock()

        def fake_run(args, **kwargs):
            if args == ['podman', 'info', '--format', 'json']:
                return result('{"host":{"cgroupVersion":"v2","security":{"rootless":false}}}')
            if args == ['node', '--version']:
                return result('v20.20.2')
            return result('podman')

        with patch.object(m.sys, 'platform', 'linux'), patch.object(m.sys, 'version_info', (3, 12)), \
             patch.object(m.os, 'geteuid', return_value=0, create=True), patch.object(m.shutil, 'which', return_value='/bin/tool'), \
             patch.object(m.shutil, 'disk_usage', return_value=Mock(free=13 * 1024**3)), \
             patch.object(m.Path, 'read_text', return_value='MemAvailable: 4194304 kB\n'), \
             patch.object(m, 'run', side_effect=fake_run):
            with self.assertRaisesRegex(m.DeployError, r'PM2 runtime requires Node\.js 24\+; found v20\.20\.2'):
                d.preflight()

    def test_port_recheck_prevents_start(self):
        d = self.deployment()
        d.env = m.new_env(18188)
        d.ownership = Mock()
        d.port = Mock(side_effect=m.DeployError('occupied'))
        d.compose = Mock()
        with self.assertRaises(m.DeployError):
            d.start()
        d.compose.assert_not_called()

    def test_port_accepts_saved_port_held_by_amt_pm2_app(self):
        d = self.deployment()
        d.inventory = Mock(return_value=[])
        with patch.object(m, 'run', side_effect=[
            result('LISTEN 0 128 127.0.0.1:18188 0.0.0.0:*'),
            result('UNCONN 0 0 127.0.0.1:9999 0.0.0.0:*'),
            subprocess.CompletedProcess([], 0, json.dumps([
                {'name': 'amt-pricelist-app', 'pm2_env': {'status': 'online'}}
            ]).encode(), b''),
        ]):
            self.assertEqual(d.port(18188), 18188)

    def test_dry_run_no_fetch_or_deployment(self):
        d = self.deployment()
        with tempfile.TemporaryDirectory() as temp:
            d.root = Path(temp) / 'absent'
            d.preflight = Mock()
            d.port = Mock(return_value=18180)
            d.source = Mock(return_value=(ROOT, 'a' * 40))
            d.deploy = Mock()
            d.execute()
            d.source.assert_called_once_with(fetch=False)
            d.deploy.assert_not_called()
            self.assertFalse(d.root.exists())

    def test_execute_setup_token_is_read_only(self):
        args = m.arguments(['setup-token'])
        d = m.Deployment(args)
        d.preflight = Mock()
        d.load_environment = Mock()
        d.port = Mock()
        d.current = Mock()
        d.inventory = Mock(return_value=[])
        d.env = m.new_env(18180)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            d.execute()
        d.preflight.assert_called_once()
        d.load_environment.assert_called_once()
        d.port.assert_not_called()
        d.current.assert_not_called()
        self.assertIn('Current deployment setup token', output.getvalue())
        self.assertIn(d.env['SETUP_TOKEN'], output.getvalue())

    def test_cleanup_dry_run_keeps_current_and_latest_rollback(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            d = self.deployment()
            d.args = m.arguments(['cleanup', '--dry-run'])
            d.root = root
            d.state = root / 'state'
            d.state.mkdir(parents=True)
            (d.state / 'deployment.json').write_text(json.dumps({'phase': 'HEALTHY'}))
            releases = root / 'releases'
            releases.mkdir()
            shared = root / 'shared'
            shared.mkdir()
            logs = root / 'logs'
            logs.mkdir()
            recovery = root / 'recovery'
            recovery.mkdir()
            current = releases / 'cccccccccccc-33333333'
            older_keep = releases / 'bbbbbbbbbbbb-22222222'
            older_drop = releases / 'aaaaaaaaaaaa-11111111'
            for entry in (older_drop, older_keep, current):
                entry.mkdir()
                (entry / 'release.json').write_text('{}')
            now = time.time()
            os.utime(older_drop, (now - 300, now - 300))
            os.utime(older_keep, (now - 200, now - 200))
            os.utime(current, (now - 100, now - 100))
            (root / '.amt-owner').write_text(m.PROJECT + '\n')
            d.envfile = shared / '.env'
            d.env = m.new_env(18180)
            d.envfile.write_text(m.env_text(d.env))
            d.load_environment = Mock()
            current_link = root / 'current'
            current_link.mkdir()
            old_log = logs / 'old.log'
            old_log.write_text('x')
            os.utime(old_log, (now - 15 * 24 * 60 * 60, now - 15 * 24 * 60 * 60))
            old_backup = recovery / '20200101T000000Z-deadbeef'
            old_backup.mkdir()
            os.utime(old_backup, (now - 15 * 24 * 60 * 60, now - 15 * 24 * 60 * 60))
            output = io.StringIO()
            original_resolve = Path.resolve

            def resolve_override(path_obj, strict=False):
                if path_obj == current_link:
                    return current
                return original_resolve(path_obj, strict=strict)

            with contextlib.redirect_stdout(output), patch.object(m, 'run') as run, \
                    patch.object(Path, 'resolve', resolve_override):
                d.cleanup()
            text = output.getvalue()
            self.assertIn(current.name, text)
            self.assertIn(older_keep.name, text)
            self.assertIn(str(older_drop), text)
            self.assertIn(str(old_log), text)
            self.assertIn(str(old_backup), text)
            run.assert_not_called()
            self.assertTrue(older_drop.exists())
            self.assertTrue(old_log.exists())
            self.assertTrue(old_backup.exists())

    def test_cleanup_removes_old_artifacts_and_prunes_images(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            d = self.deployment()
            d.args = m.arguments(['cleanup', '--yes', '--access-verified'])
            d.root = root
            d.state = root / 'state'
            d.state.mkdir(parents=True)
            (d.state / 'deployment.json').write_text(json.dumps({'phase': 'HEALTHY'}))
            releases = root / 'releases'
            releases.mkdir()
            shared = root / 'shared'
            shared.mkdir()
            logs = root / 'logs'
            logs.mkdir()
            recovery = root / 'recovery'
            recovery.mkdir()
            current = releases / 'cccccccccccc-33333333'
            older_keep = releases / 'bbbbbbbbbbbb-22222222'
            older_drop = releases / 'aaaaaaaaaaaa-11111111'
            for entry in (older_drop, older_keep, current):
                entry.mkdir()
                (entry / 'release.json').write_text('{}')
            now = time.time()
            os.utime(older_drop, (now - 300, now - 300))
            os.utime(older_keep, (now - 200, now - 200))
            os.utime(current, (now - 100, now - 100))
            (root / '.amt-owner').write_text(m.PROJECT + '\n')
            d.envfile = shared / '.env'
            d.env = m.new_env(18180)
            d.envfile.write_text(m.env_text(d.env))
            d.load_environment = Mock()
            current_link = root / 'current'
            current_link.mkdir()
            old_log = logs / 'old.log'
            old_log.write_text('x')
            os.utime(old_log, (now - 15 * 24 * 60 * 60, now - 15 * 24 * 60 * 60))
            old_backup = recovery / '20200101T000000Z-deadbeef'
            old_backup.mkdir()
            os.utime(old_backup, (now - 15 * 24 * 60 * 60, now - 15 * 24 * 60 * 60))
            d.event = Mock()
            original_resolve = Path.resolve

            def resolve_override(path_obj, strict=False):
                if path_obj == current_link:
                    return current
                return original_resolve(path_obj, strict=strict)

            with patch.object(m, 'run', return_value=result()) as run, \
                    patch.object(Path, 'resolve', resolve_override):
                d.cleanup()
            self.assertFalse(older_drop.exists())
            self.assertTrue(older_keep.exists())
            self.assertTrue(current.exists())
            self.assertFalse(old_log.exists())
            self.assertFalse(old_backup.exists())
            run.assert_called_once()
            self.assertEqual(run.call_args.args[0], ['podman', 'image', 'prune', '-a', '-f'])
            d.event.assert_called_once()

    def resume_fixture(self, temp, candidate=None):
        d = self.deployment()
        d.args.resume = True
        d.root = Path(temp)
        d.state = d.root / 'state'
        d.state.mkdir()
        d.envfile = d.root / 'shared' / '.env'
        d.envfile.parent.mkdir()
        d.env = m.new_env(18188)
        d.envfile.write_text(m.env_text(d.env))
        d.load_environment = Mock()
        d.source = Mock(return_value=(ROOT, 'b' * 40))
        d.port = Mock(return_value=18188)
        (d.state / 'install.json').write_text(json.dumps({'commit': 'a' * 40, 'candidate': candidate}))
        return d

    def test_interrupted_build_retries_pinned_commit(self):
        with tempfile.TemporaryDirectory() as temp:
            d = self.resume_fixture(temp)
            d.prepare_release = Mock(side_effect=m.DeployError('build failed again'))
            d.stop = Mock()
            with self.assertRaises(m.DeployError):
                d.deploy(True)
            d.prepare_release.assert_called_once_with(ROOT, 'a' * 40)
            d.stop.assert_not_called()
            d.port.assert_called_once_with(18188)

    def test_interrupted_migration_reuses_candidate_and_credentials(self):
        with tempfile.TemporaryDirectory() as temp:
            name = 'aaaaaaaaaaaa-12345678'
            d = self.resume_fixture(temp, name)
            release = d.root / 'releases' / name
            release.mkdir(parents=True)
            (release / 'release.json').write_text(json.dumps({'commit': 'a' * 40}))
            d.prepare_release = Mock()
            d.initialize_volumes = Mock()
            d.wait_db = Mock()
            d.verify_database_runtime = Mock()
            d.verify_limits = Mock()
            d.stop = Mock()
            d.start = Mock()
            d.activate = Mock()
            d.compose = Mock(side_effect=[result(), m.DeployError('migration failed')])
            password = d.env['POSTGRES_PASSWORD']
            with self.assertRaises(m.DeployError):
                d.deploy(True)
            d.prepare_release.assert_not_called()
            d.start.assert_not_called()
            d.activate.assert_not_called()
            self.assertEqual(d.env['POSTGRES_PASSWORD'], password)
            self.assertEqual(json.loads((d.state / 'deployment.json').read_text())['phase'], 'MIGRATING')

    def test_completed_install_cannot_resume(self):
        with tempfile.TemporaryDirectory() as temp:
            d = self.resume_fixture(temp)
            (d.state / 'install.json').write_text('{"completed": true}')
            with self.assertRaisesRegex(m.DeployError, 'already complete'):
                d.deploy(True)

    def test_build_limit_guard_precedes_dependency_install(self):
        dockerfile = (ROOT / 'Dockerfile').read_text()
        self.assertLess(dockerfile.index('/sys/fs/cgroup/memory.max'), dockerfile.index('npm install'))
        self.assertIn('2147483648', dockerfile)

    def test_verbose_aliases(self):
        for flag in ('-v', '--verbose', '--v'):
            self.assertTrue(m.arguments(['install', '--resume', '--dry-run', flag]).verbose)

    def command_output(self, code, *, live=True, timeout=5, verbose=False, secret=None):
        report = m.Diagnostics(verbose=verbose, heartbeat=0.05)
        if secret:
            report.protect({'POSTGRES_PASSWORD': secret})
        output = io.StringIO()
        with contextlib.redirect_stdout(output), patch.object(m, 'REPORT', report):
            result = m.run([sys.executable, '-u', '-c', code], live=live, timeout=timeout)
        return result, output.getvalue()

    def test_build_output_visible_by_default(self):
        _, output = self.command_output("print('STEP 1: building')")
        self.assertIn('STEP 1: building', output)

    def test_chunk_split_secret_and_utf8_redacted(self):
        secret = 'sensitive-value-not-hex'
        code = "import os,time; os.write(1,b'sensitive-value-'); time.sleep(.1); os.write(1,b'not-hex\\n'); os.write(1,b'\\xd8'); time.sleep(.1); os.write(1,b'\\xa7\\n')"
        _, output = self.command_output(code, secret=secret)
        self.assertNotIn('sensitive', output)
        self.assertNotIn('not-hex', output)
        self.assertIn('[REDACTED]', output)
        self.assertIn('\u0627', output)

    def test_generic_credentials_redacted(self):
        report = m.Diagnostics()
        for line in ('POSTGRES_PASSWORD=secret-value', 'Authorization: Bearer abcdef', 'postgresql://amt:secret-value@db/x', 'a' * 64):
            safe = report.redact(line)
            self.assertIn('[REDACTED', safe)
            self.assertNotIn('secret-value', safe)
            self.assertNotIn('abcdef', safe)

    def test_private_key_block_redacted(self):
        report = m.Diagnostics()
        for line in ('-----BEGIN OPENSSH PRIVATE KEY-----', 'private-base64-payload', '-----END OPENSSH PRIVATE KEY-----'):
            self.assertEqual(report.redact(line), '[REDACTED private key]')
        self.assertEqual(report.redact('normal output'), 'normal output')

    def test_silent_command_heartbeat(self):
        _, output = self.command_output('import time; time.sleep(.2)')
        self.assertIn('still working', output)

    def test_captured_output_not_streamed_even_verbose(self):
        result, output = self.command_output("import sys; print('private-json'); print('private-error',file=sys.stderr)", live=False, verbose=True)
        self.assertIn(b'private-json', result.stdout)
        self.assertIn(b'private-error', result.stderr)
        self.assertNotIn('private-json', output)
        self.assertNotIn('private-error', output)
        self.assertIn('Starting', output)
        self.assertIn('Finished', output)

    def test_build_failure_keeps_actual_error_and_exit(self):
        report = m.Diagnostics()
        report.stage_name = 'Build app image'
        output = io.StringIO()
        with contextlib.redirect_stdout(output), patch.object(m, 'REPORT', report):
            with self.assertRaisesRegex(m.DeployError, r'Build app image.*exit 7'):
                m.run([sys.executable, '-c', "import sys; print('compiler diagnostic'); sys.exit(7)"], live=True)
        self.assertIn('compiler diagnostic', output.getvalue())

    def test_timeout_is_bounded_and_names_stage(self):
        report = m.Diagnostics()
        report.stage_name = 'Build worker image'
        with patch.object(m, 'REPORT', report):
            with self.assertRaisesRegex(m.DeployError, 'Build worker image.*timed out'):
                m.run([sys.executable, '-c', 'import time; time.sleep(10)'], live=True, timeout=.15)

    def test_binary_backup_unchanged_and_hidden(self):
        report = m.Diagnostics(verbose=True)
        output = io.StringIO()
        with tempfile.TemporaryFile() as binary, contextlib.redirect_stdout(output), patch.object(m, 'REPORT', report):
            m.run([sys.executable, '-c', "import sys; sys.stdout.buffer.write(b'\\x00private-dump\\xff')"], output=binary)
            binary.seek(0)
            self.assertEqual(binary.read(), b'\x00private-dump\xff')
        self.assertNotIn('private-dump', output.getvalue())

    def test_secret_stdin_cannot_be_streamed(self):
        with patch.object(m, 'REPORT', m.Diagnostics()):
            with self.assertRaises(m.DeployError):
                m.run(['unused'], data=b'password', live=True)

    def test_oversized_line_omitted_not_partially_leaked(self):
        _, output = self.command_output("print('x' * 70000)")
        self.assertIn('oversized line omitted', output)
        self.assertNotIn('xxx', output)

    def test_dry_run_does_not_open_logs(self):
        d = self.deployment()
        with patch.object(m, 'REPORT', m.Diagnostics()) as report:
            report.open = Mock()
            d.log_ready()
            report.open.assert_not_called()

    @unittest.skipUnless(sys.platform.startswith('linux'), 'POSIX log permissions require Linux')
    def test_private_log_and_redacted_content(self):
        with tempfile.TemporaryDirectory() as temp:
            report = m.Diagnostics()
            with contextlib.redirect_stdout(io.StringIO()):
                report.open(Path(temp))
                report.emit('SETUP_TOKEN=do-not-save')
            report.close()
            self.assertEqual(report.path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(report.path.parent.stat().st_mode & 0o777, 0o700)
            self.assertNotIn('do-not-save', report.path.read_text())

    def test_runtime_limit_verification(self):
        d = self.deployment()
        d.compose = Mock(return_value=result('container-id'))
        for limit in (0, 2 * 1024**3, None):
            d.engine = Mock(return_value=result(json.dumps([{'HostConfig': {'Memory': limit}}])))
            with self.assertRaises(m.DeployError):
                d.verify_limits('app')
        d.engine = Mock(return_value=result(json.dumps([{'HostConfig': {'Memory': 768 * 1024**2}}])))
        d.verify_limits('app')

    def test_runtime_limit_failure_stops_only_app_consumers(self):
        d = self.deployment()
        d.env = m.new_env(18188)
        d.ownership = Mock()
        d.port = Mock()
        d.compose = Mock()
        d.verify_limits = Mock(side_effect=m.DeployError('unbounded'))
        d.healthy = Mock()
        with self.assertRaises(m.DeployError):
            d.start()
        d.compose.assert_called_with('stop', '-t', '60', 'app', 'worker', 'backup')
        d.healthy.assert_not_called()

    def test_public_url_validation(self):
        target = m.parse_public_url('https://SoftwareSolver.Online/amt_price_list/')
        self.assertEqual(target['origin'], 'https://softwaresolver.online')
        self.assertEqual(target['url'], 'https://softwaresolver.online/amt_price_list')
        self.assertEqual(m.parse_public_url('http://76.13.244.160/amt_price_list')['scheme'], 'http')
        for value in ('http://softwaresolver.online/amt_price_list',
                      'https://softwaresolver.online/other',
                      'https://user:password@softwaresolver.online/amt_price_list',
                      'https://softwaresolver.online:8443/amt_price_list',
                      'https://softwaresolver.online/amt_price_list?x=1'):
            with self.subTest(value=value), self.assertRaises(m.DeployError):
                m.parse_public_url(value)

    def caddy_fixture(self):
        return '''softwaresolver.online {
    encode zstd gzip
    handle /al-ameen* {
        reverse_proxy localhost:3007
    }
    reverse_proxy localhost:3000
}

www.softwaresolver.online {
    redir https://softwaresolver.online{uri} permanent
}
'''

    def test_caddy_route_preserves_existing_apps(self):
        original = self.caddy_fixture()
        target = m.parse_public_url('https://softwaresolver.online/amt_price_list')
        candidate, created = m.caddy_candidate(original, target, '127.0.0.1:18180')
        self.assertFalse(created)
        self.assertIn('@amt_price_list path /amt_price_list /amt_price_list/*', candidate)
        self.assertIn('reverse_proxy 127.0.0.1:18180', candidate)
        self.assertEqual(candidate.count('reverse_proxy localhost:3000'), 1)
        self.assertEqual(candidate.count('reverse_proxy localhost:3007'), 1)
        self.assertEqual(candidate.count('www.softwaresolver.online'), 1)
        without_amt = candidate.replace(candidate[candidate.index('    # BEGIN AMT'):candidate.index('    # END AMT') + len('    # END AMT PRICE LIST ROUTE https://softwaresolver.online/amt_price_list\n')], '')
        self.assertEqual(re.sub(r'\n\s*\n(?=})', '\n', without_amt), original)
        repeated, _ = m.caddy_candidate(candidate, target, '127.0.0.1:18180')
        self.assertEqual(repeated, candidate)

    def test_caddy_domain_change_removes_only_owned_route(self):
        original = self.caddy_fixture()
        first, _ = m.caddy_candidate(original, m.parse_public_url('https://softwaresolver.online/amt_price_list'), '127.0.0.1:18180')
        changed, created = m.caddy_candidate(first, m.parse_public_url('https://prices.example.com/amt_price_list'), '10.89.4.148:3000')
        self.assertTrue(created)
        self.assertNotIn('reverse_proxy 127.0.0.1:18180', changed)
        self.assertIn('reverse_proxy 10.89.4.148:3000', changed)
        self.assertIn('reverse_proxy localhost:3000', changed)
        self.assertIn('reverse_proxy localhost:3007', changed)

    def test_caddy_conflict_and_import_refused(self):
        target = m.parse_public_url('https://softwaresolver.online/amt_price_list')
        with self.assertRaises(m.DeployError):
            m.caddy_candidate('import sites/*\n', target, '127.0.0.1:18180')
        with self.assertRaises(m.DeployError):
            m.caddy_candidate('softwaresolver.online {\n reverse_proxy /amt_price_list* localhost:9999\n}\n', target, '127.0.0.1:18180')

    def test_healthy_upstream_prefers_loopback_when_it_answers(self):
        d = self.deployment()
        d.env = m.new_env(18180)
        with patch.object(m, 'run', return_value=result('{"ok":true}')):
            self.assertEqual(d.healthy_upstream(), '127.0.0.1:18180')

    def test_healthy_upstream_falls_back_to_private_container_ip(self):
        d = self.deployment()
        d.env = m.new_env(18180)
        d.app_private_ipv4 = Mock(return_value='10.89.4.148')
        calls = [
            subprocess.CompletedProcess([], 28, b'', b''),
            subprocess.CompletedProcess([], 0, b'{"ok":true}', b''),
        ]
        with patch.object(m, 'run', side_effect=calls):
            self.assertEqual(d.healthy_upstream(), '10.89.4.148:3000')

    def test_healthy_upstream_errors_when_neither_route_answers(self):
        d = self.deployment()
        d.env = m.new_env(18180)
        d.app_private_ipv4 = Mock(return_value='10.89.4.148')
        with patch.object(m, 'run', return_value=subprocess.CompletedProcess([], 28, b'', b'')):
            with self.assertRaisesRegex(m.DeployError, 'did not respond'):
                d.healthy_upstream()

    def test_healthy_retries_until_upstream_is_ready(self):
        d = self.deployment()
        d.env = m.new_env(18180, runtime='pm2')
        d.database = Mock(return_value=result('1'))
        d.pm2_running = Mock(return_value={
            'amt-pricelist-app': 'online',
            'amt-pricelist-worker': 'online',
        })
        d.healthy_upstream = Mock(side_effect=[
            m.DeployError('not ready yet'),
            None,
        ])
        with patch.object(m.time, 'sleep') as sleep, \
             patch.object(m.time, 'monotonic', side_effect=[0, 1, 2]):
            d.healthy()
        self.assertEqual(d.healthy_upstream.call_count, 2)
        sleep.assert_called_once_with(3)

    def test_external_images_and_local_tags_are_qualified(self):
        dockerfile = (ROOT / 'Dockerfile').read_text()
        compose = (ROOT / 'compose.yaml').read_text()
        self.assertIn('FROM docker.io/library/node:24-bookworm-slim', dockerfile)
        self.assertIn('FROM docker.io/library/postgres:17-bookworm', dockerfile)
        self.assertIn('image: docker.io/library/postgres:17-bookworm', compose)
        for image in ('app', 'worker', 'backup'):
            self.assertIn(f'image: localhost/amt-pricelist-{image}:', compose)

    def test_runtime_database_supports_compose_socket_and_pm2_loopback(self):
        compose = (ROOT / 'compose.yaml').read_text()
        env = m.new_env(18180)
        rendered = m.env_text(env)
        self.assertIn('?host=%2Fvar%2Frun%2Fpostgresql', rendered)
        self.assertNotIn('@db:', rendered)
        pm2_rendered = m.env_text(m.new_env(18180, runtime='pm2'))
        self.assertIn('@127.0.0.1:15432/', pm2_rendered)
        pm2_socket_rendered = m.env_text(dict(m.new_env(18180, runtime='pm2'), DB_HOST='/podman/volumes/database_socket'))
        self.assertIn('?host=%2Fpodman%2Fvolumes%2Fdatabase_socket', pm2_socket_rendered)
        self.assertIn('database_socket:/var/run/postgresql', compose)
        self.assertEqual(compose.count('database_socket:/var/run/postgresql:ro'), 4)
        self.assertIn('unix_socket_permissions=0777', compose)
        self.assertIn('hba_file=/etc/postgresql/amt-pg_hba.conf', compose)
        self.assertIn('listen_addresses=*', compose)
        self.assertIn('local all all scram-sha-256', (ROOT / 'docker/pg_hba.conf').read_text())
        self.assertNotRegex(compose, r'(?m)^\s*network_mode:\s*host')
        self.assertIn('127.0.0.1:${DB_PORT:-15432}:5432', compose)

    def test_socket_precheck_requires_good_and_rejects_bad_credentials(self):
        d = self.deployment()
        d.env = m.new_env(18180)
        d.compose = Mock(return_value=result())
        d.verify_database_runtime()
        args = d.compose.call_args.args
        self.assertIn('migrate', args)
        script = args[-1]
        self.assertIn("query('SELECT 1')", script)
        self.assertIn("error.code==='28P01'", script)
        self.assertIn('deliberately-invalid', script)
        self.assertNotIn('new URL', script)
        self.assertIn('connectionParameters', script)

    def test_socket_precheck_reports_connection_and_policy_failures_separately(self):
        d = self.deployment()
        d.env = m.new_env(18180)
        d.compose = Mock(return_value=subprocess.CompletedProcess([], 20, b'', b''))
        with self.assertRaisesRegex(m.DeployError, 'socket connection failed'):
            d.verify_database_runtime()
        d.compose = Mock(return_value=subprocess.CompletedProcess([], 21, b'', b''))
        with self.assertRaisesRegex(m.DeployError, 'invalid password'):
            d.verify_database_runtime()

    def test_pm2_socket_precheck_runs_from_release_directory(self):
        d = self.deployment()
        d.env = m.new_env(18180, runtime='pm2')
        d.release = ROOT
        d.db_socket_host_path = Mock(return_value='/podman/volumes/database_socket')
        with patch.object(m, 'run', return_value=result()) as run:
            d.verify_database_runtime()
        self.assertEqual(run.call_args.kwargs['cwd'], ROOT)
        self.assertEqual(run.call_args.args[0][:2], ['node', '-e'])
        script = run.call_args.args[0][2]
        self.assertIn('connectionTimeoutMillis:5000', script)
        self.assertIn('query_timeout:5000', script)
        self.assertIn('statement_timeout:5000', script)
        self.assertEqual(run.call_args.kwargs['env']['DB_HOST'], '/podman/volumes/database_socket')

    def test_native_runtime_env_prefers_database_socket_when_available(self):
        d = self.deployment()
        d.env = m.new_env(18180, runtime='pm2')
        d.release = ROOT
        d.db_socket_host_path = Mock(return_value='/podman/volumes/database_socket')
        d.db_private_ipv4 = Mock()
        env = d.native_runtime_env()
        self.assertEqual(env['DB_HOST'], '/podman/volumes/database_socket')
        self.assertIn('?host=%2Fpodman%2Fvolumes%2Fdatabase_socket', env['DATABASE_URL'])
        d.db_private_ipv4.assert_not_called()

    def test_native_runtime_env_falls_back_to_database_private_ip_when_loopback_port_is_unreachable(self):
        d = self.deployment()
        d.env = m.new_env(18180, runtime='pm2')
        d.release = ROOT
        d.host_port_ready = Mock(return_value=False)
        d.db_socket_host_path = Mock(return_value=None)
        d.db_private_ipv4 = Mock(return_value='10.89.4.200')
        env = d.native_runtime_env()
        self.assertEqual(env['DB_HOST'], '10.89.4.200')
        self.assertEqual(env['DB_PORT'], '5432')
        self.assertIn('@10.89.4.200:5432/', env['DATABASE_URL'])

    def test_native_runtime_env_keeps_loopback_when_host_port_is_reachable(self):
        d = self.deployment()
        d.env = m.new_env(18180, runtime='pm2')
        d.release = ROOT
        d.host_port_ready = Mock(return_value=True)
        d.db_socket_host_path = Mock(return_value=None)
        d.db_private_ipv4 = Mock()
        env = d.native_runtime_env()
        self.assertEqual(env['DB_HOST'], '127.0.0.1')
        self.assertIn('@127.0.0.1:15432/', env['DATABASE_URL'])
        d.db_socket_host_path.assert_called_once()
        d.db_private_ipv4.assert_not_called()

    def replacement_guard_fixture(self, temp):
        d = self.deployment()
        d.root = Path(temp)
        d.state = d.root / 'state'
        d.state.mkdir()
        name = 'aaaaaaaaaaaa-12345678'
        release = d.root / 'releases' / name
        release.mkdir(parents=True)
        (release / 'release.json').write_text(json.dumps({'commit': 'a' * 40}))
        (d.state / 'install.json').write_text(json.dumps({'commit': 'a' * 40, 'candidate': name}))
        (d.state / 'deployment.json').write_text(json.dumps({'phase': 'MIGRATING'}))
        return d

    def test_replacement_guard_rejects_application_containers(self):
        with tempfile.TemporaryDirectory() as temp:
            d = self.replacement_guard_fixture(temp)
            d.engine = Mock(return_value=result(''))
            d.inventory = Mock(return_value=[{'Config': {'Labels': {
                'com.docker.compose.project': m.PROJECT,
                'com.docker.compose.service': 'app',
            }}, 'State': {'Running': True}}])
            with self.assertRaisesRegex(m.DeployError, 'containers'):
                d.check_replace_failed()

    def test_replacement_guard_ignores_stopped_application_containers(self):
        with tempfile.TemporaryDirectory() as temp:
            d = self.replacement_guard_fixture(temp)
            d.engine = Mock(return_value=result('amt-pricelist_database'))
            d.inventory = Mock(return_value=[
                {'Config': {'Labels': {
                    'com.docker.compose.project': m.PROJECT,
                    'com.docker.compose.service': 'db',
                }}, 'State': {'Running': True}},
                {'Config': {'Labels': {
                    'com.docker.compose.project': m.PROJECT,
                    'com.docker.compose.service': 'app',
                }}, 'State': {'Running': False}},
                {'Config': {'Labels': {
                    'com.docker.compose.project': m.PROJECT,
                    'com.docker.compose.service': 'worker',
                }}, 'State': {'Running': False}},
            ])
            d.database = Mock(return_value=result('0'))
            d.check_replace_failed()
            self.assertEqual(d.release.name, 'aaaaaaaaaaaa-12345678')

    def test_replacement_guard_allows_empty_initialized_database(self):
        with tempfile.TemporaryDirectory() as temp:
            d = self.replacement_guard_fixture(temp)
            d.engine = Mock(return_value=result('amt-pricelist_database'))
            d.inventory = Mock(return_value=[{'Config': {'Labels': {
                'com.docker.compose.project': m.PROJECT,
                'com.docker.compose.service': 'db',
            }}, 'State': {'Running': True}}])
            d.database = Mock(return_value=result('0'))
            d.check_replace_failed()
            self.assertEqual(d.release.name, 'aaaaaaaaaaaa-12345678')

    def test_replacement_guard_allows_incomplete_activated_release(self):
        with tempfile.TemporaryDirectory() as temp:
            d = self.replacement_guard_fixture(temp)
            current_release = d.root / 'releases' / 'bbbbbbbbbbbb-22222222'
            current_release.mkdir(parents=True)
            (current_release / 'release.json').write_text(json.dumps({'commit': 'b' * 40}))
            current_link = d.root / 'current'
            original_resolve = Path.resolve

            def resolve_override(path_obj, strict=False):
                if path_obj == current_link:
                    return current_release
                return original_resolve(path_obj, strict=strict)

            current_link.mkdir()
            d.engine = Mock(return_value=result('amt-pricelist_database'))
            d.inventory = Mock(return_value=[{'Config': {'Labels': {
                'com.docker.compose.project': m.PROJECT,
                'com.docker.compose.service': 'db',
            }}, 'State': {'Running': True}}])
            d.database = Mock(return_value=result('0'))
            with patch.object(Path, 'resolve', resolve_override):
                d.check_replace_failed()
            self.assertEqual(d.release.name, 'bbbbbbbbbbbb-22222222')

    def test_replacement_guard_rejects_applied_migrations(self):
        with tempfile.TemporaryDirectory() as temp:
            d = self.replacement_guard_fixture(temp)
            d.engine = Mock(return_value=result('amt-pricelist_database'))
            d.inventory = Mock(return_value=[{'Config': {'Labels': {
                'com.docker.compose.project': m.PROJECT,
                'com.docker.compose.service': 'db',
            }}, 'State': {'Running': True}}])
            d.database = Mock(side_effect=[result('1'), result('4')])
            with self.assertRaisesRegex(m.DeployError, 'migrations exist'):
                d.check_replace_failed()

    def test_replacement_archives_journal_and_uses_requested_commit(self):
        with tempfile.TemporaryDirectory() as temp:
            d = self.resume_fixture(temp)
            d.args.replace_failed_release = True
            d.args.build_network = 'host'
            d.check_replace_failed = Mock()
            d.event = Mock()
            d.prepare_release = Mock(side_effect=m.DeployError('expected build failure'))
            original_password = d.env['POSTGRES_PASSWORD']
            with self.assertRaises(m.DeployError):
                d.deploy(True)
            replacement = json.loads((d.state / 'install.json').read_text())
            self.assertEqual(replacement, {'commit': 'b' * 40, 'candidate': None})
            self.assertTrue(list(d.state.glob('install-replaced-*.json')))
            d.prepare_release.assert_called_once_with(ROOT, 'b' * 40)
            self.assertEqual(d.env['POSTGRES_PASSWORD'], original_password)

    def test_recover_install_replaces_only_when_origin_commit_changed(self):
        with tempfile.TemporaryDirectory() as temp:
            d = self.resume_fixture(temp)
            d.args.recover_install = True
            d.args.build_network = 'host'
            d.check_replace_failed = Mock()
            d.event = Mock()
            d.prepare_release = Mock(side_effect=m.DeployError('expected build failure'))
            with self.assertRaises(m.DeployError):
                d.deploy(True)
            d.check_replace_failed.assert_called_once()
            self.assertEqual(json.loads((d.state / 'install.json').read_text())['commit'], 'b' * 40)

    def test_recover_install_replaces_from_active_release_when_current_exists(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            d = self.deployment()
            d.args = m.arguments(['recover-install', '--yes', '--access-verified'])
            d.root = root
            d.state = root / 'state'
            d.state.mkdir(parents=True)
            shared = root / 'shared'
            shared.mkdir(parents=True)
            d.envfile = shared / '.env'
            d.env = m.new_env(18180, runtime='pm2')
            d.envfile.write_text(m.env_text(d.env))
            (root / '.amt-owner').write_text(m.PROJECT + '\n')
            (d.state / 'install.json').write_text(json.dumps({'commit': 'a' * 40, 'candidate': None}))
            (d.state / 'deployment.json').write_text(json.dumps({'phase': 'MIGRATING'}))
            current_release = root / 'releases' / 'aaaaaaaaaaaa-11111111'
            next_release = root / 'releases' / 'bbbbbbbbbbbb-22222222'
            current_release.mkdir(parents=True)
            next_release.mkdir(parents=True)
            (current_release / 'release.json').write_text(json.dumps({'commit': 'a' * 40}))
            (next_release / 'release.json').write_text(json.dumps({'commit': 'b' * 40}))
            for release in (current_release, next_release):
                (release / 'database').mkdir()
                (release / 'database' / '001_initial.sql').write_text('-- migration')
            current_link = root / 'current'
            original_resolve = Path.resolve

            def resolve_override(path_obj, strict=False):
                if path_obj == current_link:
                    return current_release
                return original_resolve(path_obj, strict=strict)

            current_link.mkdir()
            d.load_environment = Mock()
            d.source = Mock(return_value=(ROOT, 'b' * 40))
            d.port = Mock(return_value=18180)
            d.engine = Mock(return_value=result('amt-pricelist_database'))
            d.inventory = Mock(return_value=[{'Config': {'Labels': {
                'com.docker.compose.project': m.PROJECT,
                'com.docker.compose.service': 'db',
            }}, 'State': {'Running': True}}])
            d.database = Mock(return_value=result('0'))
            d.prepare_release = Mock(return_value=next_release)
            d.stop_runtime = Mock()
            d.snapshot = Mock()
            d.initialize_volumes = Mock()
            d.compose = Mock(return_value=result())
            d.verify_limits = Mock()
            d.wait_db = Mock()
            d.verify_database_runtime = Mock()
            d.run_native_migrate = Mock()
            d.start = Mock()
            d.activate = Mock(side_effect=lambda release: setattr(d, 'release', release))
            d._sync_startup_units = Mock()
            d.refresh_proxy = Mock()
            d.event = Mock()
            with patch.object(Path, 'resolve', resolve_override), patch.object(m, 'run', return_value=result()):
                d.deploy(True)
            self.assertEqual(d.stop_runtime.call_args_list, [unittest.mock.call('pm2'), unittest.mock.call('pm2')])
            d.snapshot.assert_called_once()
            self.assertEqual(d.compose.call_args_list[0], unittest.mock.call('rm', '-s', '-f', 'db'))
            self.assertEqual(json.loads((d.state / 'install.json').read_text())['commit'], 'b' * 40)

    def test_recover_install_reuses_same_commit_candidate(self):
        with tempfile.TemporaryDirectory() as temp:
            name = 'aaaaaaaaaaaa-12345678'
            d = self.resume_fixture(temp, name)
            d.args.recover_install = True
            d.source = Mock(return_value=(ROOT, 'a' * 40))
            release = d.root / 'releases' / name
            release.mkdir(parents=True)
            (release / 'release.json').write_text(json.dumps({'commit': 'a' * 40}))
            d.check_replace_failed = Mock()
            d.prepare_release = Mock()
            d.initialize_volumes = Mock()
            d.verify_limits = Mock()
            d.wait_db = Mock()
            d.verify_database_runtime = Mock()
            d.stop = Mock()
            d.compose = Mock(side_effect=[result(), m.DeployError('migration failed')])
            with self.assertRaises(m.DeployError):
                d.deploy(True)

    def test_upgrade_runtime_switch_stops_previous_compose_services_before_pm2(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            d = self.deployment()
            d.args = m.arguments(['upgrade', '--runtime', 'pm2', '--yes', '--access-verified'])
            d.root = root
            d.state = root / 'state'
            d.state.mkdir(parents=True)
            shared = root / 'shared'
            shared.mkdir(parents=True)
            d.envfile = shared / '.env'
            d.env = m.new_env(18180, runtime='compose')
            d.envfile.write_text(m.env_text(d.env))
            (root / '.amt-owner').write_text(m.PROJECT + '\n')
            current_release = root / 'releases' / 'aaaaaaaaaaaa-11111111'
            next_release = root / 'releases' / 'bbbbbbbbbbbb-22222222'
            current_release.mkdir(parents=True)
            next_release.mkdir(parents=True)
            (current_release / 'release.json').write_text(json.dumps({'commit': 'a' * 40}))
            (next_release / 'release.json').write_text(json.dumps({'commit': 'b' * 40}))
            for release in (current_release, next_release):
                (release / 'database').mkdir()
                (release / 'database' / '001_initial.sql').write_text('-- migration')
            d.load_environment = Mock()
            d.source = Mock(return_value=(ROOT, 'b' * 40))
            d.prepare_release = Mock(return_value=next_release)
            d.stop_runtime = Mock()
            d.snapshot = Mock()
            d.initialize_volumes = Mock()
            d.compose = Mock(return_value=result())
            d.verify_limits = Mock()
            d.wait_db = Mock()
            d.verify_database_runtime = Mock()
            d.run_native_migrate = Mock()
            d.start = Mock()
            d.activate = Mock(side_effect=lambda release: setattr(d, 'release', release))
            d._sync_startup_units = Mock()
            d.refresh_proxy = Mock()
            d.auto_cleanup_after_upgrade = Mock()
            d.event = Mock()
            original_resolve = Path.resolve

            def resolve_override(path_obj, strict=False):
                if path_obj == root / 'current':
                    return current_release
                return original_resolve(path_obj, strict=strict)

            (root / 'current').mkdir()
            with patch.object(Path, 'resolve', resolve_override), patch.object(m, 'run', return_value=result()):
                d.deploy(False)
            d.stop_runtime.assert_called_once_with('compose')
            d.snapshot.assert_called_once()
            self.assertEqual(d.env['APP_RUNTIME'], 'pm2')

    def test_status_healthy_installation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            d = self.deployment()
            d.root = root
            d.state = root / 'state'
            d.state.mkdir(parents=True)
            shared = root / 'shared'
            shared.mkdir(parents=True)
            d.envfile = shared / '.env'
            d.env = m.new_env(18180)
            d.envfile.write_text(m.env_text(d.env))
            (root / '.amt-owner').write_text(m.PROJECT + '\n')
            release = root / 'releases' / 'aaaaaaaaaaaa-11111111'
            release.mkdir(parents=True)
            current = root / 'current'
            original_resolve = Path.resolve

            def resolve_override(path_obj, strict=False):
                if path_obj == current:
                    return release
                return original_resolve(path_obj, strict=strict)

            current.mkdir()
            d.compose = Mock(return_value=result('NAME                IMAGE               COMMAND             SERVICE             CREATED             STATUS              PORTS\namt-pricelist-app   ...                 ...                 app                 ...                 Up                  127.0.0.1:18180->3000/tcp'))
            d.load_environment = Mock()
            output = io.StringIO()
            with contextlib.redirect_stdout(output), patch.object(Path, 'resolve', resolve_override), \
                    patch.object(m, 'run', side_effect=[result('enabled'), result('active')]):
                d.status()
            self.assertIn('amt-pricelist-app', output.getvalue())
            self.assertIn('Auto-start on VPS reboot: enabled. Systemd state: active.', output.getvalue())
            self.assertEqual(d.compose.call_args_list, [unittest.mock.call('ps', 'db'), unittest.mock.call('ps')])

    def test_status_incomplete_installation_reports_recovery_state(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            d = self.deployment()
            d.root = root
            d.state = root / 'state'
            d.state.mkdir(parents=True)
            shared = root / 'shared'
            shared.mkdir(parents=True)
            d.envfile = shared / '.env'
            d.env = m.new_env(18180)
            d.envfile.write_text(m.env_text(d.env))
            (root / '.amt-owner').write_text(m.PROJECT + '\n')
            (d.state / 'install.json').write_text(json.dumps({'commit': 'a' * 40, 'candidate': 'aaaaaaaaaaaa-11111111'}))
            (d.state / 'deployment.json').write_text(json.dumps({'phase': 'MIGRATING'}))
            d.load_environment = Mock()
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                d.status()
            text = output.getvalue()
            self.assertIn('Installation incomplete', text)
            self.assertIn('recovery state active', text)
            self.assertIn('phase: MIGRATING', text)
            self.assertIn('commit: ' + 'a' * 40, text)
            self.assertIn('candidate: aaaaaaaaaaaa-11111111', text)

    def test_execute_start_loads_current_release_before_boot_actions(self):
        with tempfile.TemporaryDirectory() as temp:
            args = m.arguments(['start', '--yes'])
            d = m.Deployment(args)
            d.preflight = Mock()
            d.current = Mock()
            d.port = Mock()
            d.root = Path(temp)
            d.state = d.root / 'state'
            d.state.mkdir(exist_ok=True)
            (d.state / 'deployment.json').write_text(json.dumps({'phase': 'HEALTHY'}))
            d.compose = Mock(return_value=result())
            d.wait_db = Mock()
            d.start = Mock()
            d.refresh_proxy = Mock()
            d.inventory = Mock(return_value=[])
            lock = contextlib.nullcontext()
            d.locked = Mock(return_value=lock)
            d.log_ready = Mock()
            d.owned = Mock(return_value=False)
            d.execute()
            d.current.assert_called_once()
            d.compose.assert_called_once_with('up', '-d', '--no-deps', '--no-build', 'db')
            d.wait_db.assert_called_once()
            d.start.assert_called_once()
            d.refresh_proxy.assert_called_once()

    def test_execute_backup_job_loads_current_release_before_running(self):
        with tempfile.TemporaryDirectory() as temp:
            args = m.arguments(['backup-job', '--yes'])
            d = m.Deployment(args)
            d.preflight = Mock()
            d.current = Mock()
            d.root = Path(temp)
            d.state = d.root / 'state'
            d.state.mkdir(exist_ok=True)
            d.run_backup_job = Mock()
            d.inventory = Mock(return_value=[])
            lock = contextlib.nullcontext()
            d.locked = Mock(return_value=lock)
            d.log_ready = Mock()
            d.owned = Mock(return_value=False)
            d.execute()
            d.current.assert_called_once()
            d.run_backup_job.assert_called_once()

    def test_refresh_proxy_updates_upstream_and_reloads_caddy(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            d = self.deployment()
            d.root = root
            d.state = root / 'state'
            d.state.mkdir(parents=True)
            (d.state / 'public-url.json').write_text(json.dumps({'url': 'https://softwaresolver.online/amt_price_list'}))
            caddy_file = root / 'Caddyfile'
            target = m.parse_public_url('https://softwaresolver.online/amt_price_list')
            old_caddy, _ = m.caddy_candidate(self.caddy_fixture(), target, '10.89.4.147:3000')
            caddy_file.write_text(old_caddy)
            d._caddy_context = Mock(return_value=(caddy_file, old_caddy, 0o644))
            d.stable_upstream = Mock(return_value='127.0.0.1:18180')
            d._http_status = Mock(return_value=('200', 0))
            d.event = Mock()
            with patch.object(m.Path, 'is_file', return_value=True), patch.object(m, 'run', return_value=result()) as run:
                d.refresh_proxy()
            updated_caddy = caddy_file.read_text()
            self.assertIn('reverse_proxy 127.0.0.1:18180', updated_caddy)
            self.assertNotIn('reverse_proxy 10.89.4.147:3000', updated_caddy)
            self.assertIn('reverse_proxy localhost:3000', updated_caddy)
            self.assertIn('reverse_proxy localhost:3007', updated_caddy)
            reloads = [c.args[0] for c in run.call_args_list if 'reload' in c.args[0]]
            self.assertEqual(len(reloads), 1)
            self.assertEqual(reloads[0], ['systemctl', 'reload', 'caddy'])
            saved = json.loads((d.state / 'public-url.json').read_text())
            self.assertEqual(saved['upstream'], '127.0.0.1:18180')
            d.event.assert_called_once_with('PROXY_REFRESHED', url='https://softwaresolver.online/amt_price_list', upstream='127.0.0.1:18180')

    def test_refresh_proxy_skips_when_caddy_or_url_absent(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            d = self.deployment()
            d.root = root
            d.state = root / 'state'
            d.state.mkdir(parents=True)
            d._apply_caddy = Mock()
            with patch.object(m.Path, 'is_file', return_value=False):
                d.refresh_proxy()
            d._apply_caddy.assert_not_called()

    def test_refresh_proxy_skips_reload_when_upstream_is_unchanged(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            d = self.deployment()
            d.root = root
            d.state = root / 'state'
            d.state.mkdir(parents=True)
            (d.state / 'public-url.json').write_text(json.dumps({'url': 'https://softwaresolver.online/amt_price_list'}))
            caddy_file = root / 'Caddyfile'
            target = m.parse_public_url('https://softwaresolver.online/amt_price_list')
            current_caddy, _ = m.caddy_candidate(self.caddy_fixture(), target, '127.0.0.1:18180')
            caddy_file.write_text(current_caddy)
            d._caddy_context = Mock(return_value=(caddy_file, current_caddy, 0o644))
            d.stable_upstream = Mock(return_value='127.0.0.1:18180')
            with patch.object(m.Path, 'is_file', return_value=True), patch.object(m, 'run') as run:
                d.refresh_proxy()
            run.assert_not_called()

    def test_refresh_proxy_rolls_back_caddy_on_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            d = self.deployment()
            d.root = root
            d.state = root / 'state'
            d.state.mkdir(parents=True)
            (d.state / 'public-url.json').write_text(json.dumps({'url': 'https://softwaresolver.online/amt_price_list'}))
            caddy_file = root / 'Caddyfile'
            target = m.parse_public_url('https://softwaresolver.online/amt_price_list')
            old_caddy, _ = m.caddy_candidate(self.caddy_fixture(), target, '10.89.4.147:3000')
            caddy_file.write_text(old_caddy)
            d._caddy_context = Mock(return_value=(caddy_file, old_caddy, 0o644))
            d.stable_upstream = Mock(return_value='127.0.0.1:18180')
            def mock_status(url):
                if url.endswith('/'):
                    return ('200', 0)
                return ('502', 0)
            d._http_status = Mock(side_effect=mock_status)
            with patch.object(m.Path, 'is_file', return_value=True), \
                 patch.object(m, 'run', return_value=result()), \
                 patch.object(m.time, 'sleep'), \
                 patch.object(m.time, 'monotonic', side_effect=[0, 0, 130]):
                with self.assertRaisesRegex(m.DeployError, 'Public AMT health check failed'):
                    d.refresh_proxy()
            self.assertEqual(caddy_file.read_text(), old_caddy)

    def test_refresh_proxy_does_not_recreate_containers(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            d = self.deployment()
            d.root = root
            d.state = root / 'state'
            d.state.mkdir(parents=True)
            (d.state / 'public-url.json').write_text(json.dumps({'url': 'https://softwaresolver.online/amt_price_list'}))
            caddy_file = root / 'Caddyfile'
            target = m.parse_public_url('https://softwaresolver.online/amt_price_list')
            old_caddy, _ = m.caddy_candidate(self.caddy_fixture(), target, '10.89.4.147:3000')
            caddy_file.write_text(old_caddy)
            d._caddy_context = Mock(return_value=(caddy_file, old_caddy, 0o644))
            d.stable_upstream = Mock(return_value='127.0.0.1:18180')
            d._http_status = Mock(return_value=('200', 0))
            d.compose = Mock()
            with patch.object(m.Path, 'is_file', return_value=True), patch.object(m, 'run', return_value=result()):
                d.refresh_proxy()
            d.compose.assert_not_called()

    def test_ssh_tunnel_command_prints_stable_upstream(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            d = self.deployment()
            d.root = root
            d.state = root / 'state'
            d.state.mkdir(parents=True)
            shared = root / 'shared'
            shared.mkdir(parents=True)
            d.envfile = shared / '.env'
            d.env = m.new_env(18180)
            d.envfile.write_text(m.env_text(d.env))
            d.refresh_proxy = Mock()
            d.stable_upstream = Mock(return_value='127.0.0.1:18180')
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                upstream = d.stable_upstream()
                print(f"Ready: ssh -N -L {d.env['APP_PORT']}:{upstream} root@76.13.244.160")
            self.assertIn('ssh -N -L 18180:127.0.0.1:18180 root@76.13.244.160', output.getvalue())

if __name__ == '__main__':
    unittest.main()
