"""Local safety tests: no VPS, Docker engine, credentials or network required."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
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

    def test_install_and_upgrade_memory_threshold(self):
        for command in ('install', 'upgrade'):
            m.check_memory(int(3.8 * 1024**2), command)
            m.check_memory(3 * 1024**2, command)
            with self.assertRaises(m.DeployError):
                m.check_memory(3 * 1024**2 - 1, command)

    def test_runtime_and_diagnostics_memory(self):
        m.check_memory(512 * 1024, 'start')
        with self.assertRaises(m.DeployError):
            m.check_memory(511 * 1024, 'start')
        for command in ('status', 'stop', 'backup', 'rotate-secrets'):
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
            for flag in ('--jobs=1', '--memory=2g', '--memory-swap=2g', 'AMT_VERIFY_BUILD_LIMIT=1'):
                self.assertIn(flag, args)
            targets.append(args[args.index('--target') + 1])
        self.assertEqual(targets, ['app', 'worker', 'backup'])

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
        self.assertEqual(len(creates), 3)
        for args in creates:
            self.assertIn('com.docker.compose.project=amt-pricelist', args)
        self.assertEqual(d.ownership.call_count, 2)
        helpers = [c.args for c in d.engine.call_args_list if c.args[0] == 'run']
        self.assertEqual(len(helpers), 2)
        self.assertTrue(all('none' in c and 'chown' in c for c in helpers))

    def test_ownership_failure_prevents_volume_writes(self):
        d = self.deployment()
        d.ownership = Mock(side_effect=m.DeployError('foreign volume'))
        d.engine = Mock()
        with self.assertRaises(m.DeployError):
            d.initialize_volumes()
        d.engine.assert_not_called()

    def test_port_recheck_prevents_start(self):
        d = self.deployment()
        d.env = m.new_env(18188)
        d.ownership = Mock()
        d.port = Mock(side_effect=m.DeployError('occupied'))
        d.compose = Mock()
        with self.assertRaises(m.DeployError):
            d.start()
        d.compose.assert_not_called()

    def test_dry_run_no_fetch_or_deployment(self):
        d = self.deployment()
        with tempfile.TemporaryDirectory() as temp:
            d.root = Path(temp) / 'absent'
            d.preflight = Mock()
            d.port = Mock(return_value=18180)
            d.source = Mock()
            d.deploy = Mock()
            d.execute()
            d.source.assert_called_once_with(fetch=False)
            d.deploy.assert_not_called()
            self.assertFalse(d.root.exists())

    def resume_fixture(self, temp, candidate=None):
        d = self.deployment()
        d.args.resume = True
        d.root = Path(temp)
        d.state = d.root / 'state'
        d.state.mkdir()
        d.env = m.new_env(18188)
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

if __name__ == '__main__':
    unittest.main()
