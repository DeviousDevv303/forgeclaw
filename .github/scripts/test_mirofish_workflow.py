"""mirofish-sim.yml structure checks. Text only (no YAML dependency needed), plus a real YAML parse when PyYAML is present.

These cannot run the workflow: that needs live Moonshot and Zep keys and spends money. They pin the properties that make a
run safe to dispatch: only manual dispatch, pinned and hash-verified installs, the provider key reachable only by the meter,
no user input interpolated into a shell script, and no drift between the workflow's allowlists and the code it calls."""
import importlib.util
import os
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
import mirofish_meter as mm  # noqa: E402
import mirofish_runner as mr  # noqa: E402

WORKFLOW = Path(__file__).resolve().parents[1] / 'workflows' / 'mirofish-sim.yml'
TEXT = WORKFLOW.read_text()


def step_text(name_prefix: str) -> str:
    parts = re.split(r'^      - (?:name|uses): ', TEXT, flags=re.MULTILINE)[1:]
    for part in parts:
        if part.startswith(name_prefix):
            return part
    raise AssertionError(f'no step starting with {name_prefix!r}')


def run_blocks() -> list[str]:
    """Every `run: |` script body, found by indentation."""
    blocks, lines, i = [], TEXT.split('\n'), 0
    while i < len(lines):
        m = re.match(r'^(\s+)run: \|\s*$', lines[i])
        if m:
            base, body = len(m.group(1)), []
            i += 1
            while i < len(lines) and (lines[i].strip() == '' or len(lines[i]) - len(lines[i].lstrip()) > base):
                body.append(lines[i])
                i += 1
            blocks.append('\n'.join(body))
        else:
            i += 1
    return blocks


class TriggerAndPermissions(unittest.TestCase):
    def test_only_manual_dispatch_can_start_it(self):
        triggers = re.search(r'^on:\n((?:  .*\n|\n)+?)^\S', TEXT, flags=re.MULTILINE).group(1)
        self.assertIn('workflow_dispatch:', triggers)
        for other in ('pull_request', 'push:', 'schedule:', 'issue_comment', 'issues:', 'workflow_run', 'repository_dispatch'):
            self.assertNotIn(other, triggers, f'{other} must not start a workflow that spends money')

    def test_runner_image_permissions_and_limits(self):
        self.assertIn('runs-on: ubuntu-24.04', TEXT)
        self.assertNotIn('ubuntu-latest', TEXT)
        self.assertRegex(TEXT, r'permissions:\n  contents: write\n\n')
        self.assertNotRegex(TEXT, r'(?m)^\s+(id-token|pull-requests|issues|actions|packages|statuses|checks|deployments):')
        self.assertRegex(TEXT, r'timeout-minutes: \d+')

    def test_the_same_card_and_market_never_run_at_once(self):
        self.assertIn('group: mirofish-sim-${{ inputs.card_id }}-${{ inputs.market_ticker }}', TEXT)
        self.assertIn('cancel-in-progress: false', TEXT)


class Pins(unittest.TestCase):
    def pin(self, name):
        return re.search(rf'^\s+{name}: (\S+)$', TEXT, flags=re.MULTILINE).group(1)

    def test_the_pins_are_the_ones_the_runner_will_accept(self):
        self.assertRegex(self.pin('MIROFISH_COMMIT'), mr.HEX40)
        self.assertRegex(self.pin('UV_LOCK_SHA256'), mr.HEX64)
        self.assertRegex(self.pin('TORCH_CPU_SHA256'), mr.HEX64)
        self.assertEqual(self.pin('MIROFISH_COMMIT'), '7657031ac01184afe2cb220f5ee3545573b5e843')  # measured 2026-10-24
        self.assertEqual(self.pin('UV_VERSION'), "'0.9.26'")

    def test_the_checkout_is_verified_against_the_pins_not_trusted(self):
        install = step_text('Install MiroFish')
        self.assertIn('rev-parse HEAD', install)
        self.assertIn('"$MIROFISH_COMMIT" ]', install)
        self.assertIn('sha256sum', install)
        self.assertIn('"$UV_LOCK_SHA256" ]', install)

    def test_every_install_is_hash_verified_and_never_resolves_dependencies(self):
        install = step_text('Install MiroFish')
        self.assertEqual(install.count('--require-hashes'), 2)
        self.assertEqual(install.count('--no-deps'), 2)
        self.assertIn('uv pip check', install)
        self.assertIn('--index-url https://download.pytorch.org/whl/cpu', install)
        self.assertIn('a GPU package was installed', install)
        self.assertNotIn('pip install -r', install.replace('uv pip install', ''))

    def test_the_cache_key_is_the_pins_so_a_changed_pin_cannot_reuse_a_stale_cache(self):
        cache = step_text('Cache the pinned')
        self.assertIn('${{ env.UV_LOCK_SHA256 }}', cache)
        self.assertIn('${{ env.TORCH_CPU_SHA256 }}', cache)


class SecretsAndInputs(unittest.TestCase):
    def test_each_secret_is_named_only_where_it_is_needed(self):
        self.assertEqual(TEXT.count('secrets.MOONSHOT_API_KEY'), 2)  # validate + run
        self.assertEqual(TEXT.count('secrets.ZEP_API_KEY'), 2)
        for name in ('Install MiroFish', 'Open the sim-results', 'Publish the record'):
            self.assertNotIn('secrets.MOONSHOT', step_text(name))
            self.assertNotIn('secrets.ZEP', step_text(name))

    def test_mirofish_never_sees_the_provider_key_and_the_meter_never_sees_the_zep_key(self):
        run = step_text('Run the simulation')
        meter = run.split('# 1. The meter')[1].split('# 2. MiroFish')[0]
        miro = run.split('# 2. MiroFish')[1].split('# 3. The runner')[0]
        self.assertIn('API_KEY="$MOONSHOT_API_KEY"', meter)
        self.assertNotIn('ZEP', meter)
        self.assertNotIn('MOONSHOT', miro)
        self.assertIn('ZEP_API_KEY="$ZEP_API_KEY"', miro)
        self.assertIn('LLM_API_KEY=local-meter-dummy', miro)
        self.assertIn('LLM_BASE_URL="http://127.0.0.1:${METER_PORT}/v1"', miro)
        self.assertEqual(run.count('env -i'), 2)  # both processes get a minimal environment, not the job's

    def test_mirofish_listens_on_localhost_only(self):
        run = step_text('Run the simulation')
        self.assertIn('FLASK_HOST=127.0.0.1', run)
        self.assertNotIn('0.0.0.0', run)

    def test_no_user_input_is_ever_interpolated_into_a_shell_script(self):
        blocks = run_blocks()
        self.assertGreaterEqual(len(blocks), 5)
        for block in blocks:
            self.assertNotIn('${{', block, 'a ${{ }} expression inside a run: script is script injection; pass it through env: instead')

    def test_inputs_reach_scripts_only_through_env(self):
        for name in ('Validate inputs', 'Run the simulation'):
            self.assertRegex(step_text(name), r'env:\n')
        self.assertIn('PACKET: ${{ inputs.packet }}', step_text('Run the simulation'))
        self.assertIn("printf '%s' \"$PACKET\"", step_text('Run the simulation'))

    def test_it_refuses_to_start_without_both_secrets_before_installing_anything(self):
        validate = step_text('Validate inputs')
        self.assertIn('MOONSHOT_API_KEY is not set; nothing was started and nothing was spent', validate)
        self.assertIn('ZEP_API_KEY is not set; nothing was started and nothing was spent', validate)
        self.assertLess(TEXT.index('Validate inputs'), TEXT.index('actions/checkout'))

    def test_the_dollar_ceiling_has_a_hard_maximum_in_the_workflow(self):
        validate = step_text('Validate inputs')
        self.assertIn('<= 1.00', validate)
        self.assertIn('0 < float', validate)


class NoDriftFromTheCodeItCalls(unittest.TestCase):
    def test_the_model_allowlist_is_exactly_what_the_meter_can_price(self):
        allow = re.search(r'case "\$MODEL" in ([^)]+)\)', TEXT).group(1).split('|')
        self.assertEqual(sorted(allow), sorted(mm.PRICES['moonshot']))

    def test_the_preset_allowlist_is_exactly_the_runners_presets(self):
        allow = re.search(r'case "\$PRESET" in ([^)]+)\)', TEXT).group(1).split('|')
        self.assertEqual(sorted(allow), sorted(mr.PRESETS))

    def test_the_provider_is_one_the_meter_prices(self):
        self.assertIn('LLM_PROVIDER: moonshot', TEXT)
        self.assertIn('moonshot', mm.PRICES)
        self.assertIn('UPSTREAM_BASE: https://api.moonshot.ai/v1', TEXT)

    def test_the_runner_is_called_with_every_flag_it_requires(self):
        run = step_text('Run the simulation')
        for flag in ('--packet', '--card-id', '--market-ticker', '--sides', '--yes-side', '--preset', '--provider', '--model', '--meter-url',
                     '--results-dir', '--out-dir', '--pins', '--provenance', '--rerun-reason', '--invocation-id', '--run-url', '--mirofish-dir',
                     '--position-ref', '--repo'):
            self.assertIn(flag, run)
        self.assertEqual(sorted(re.findall(r'--(?:results|out)-dir "\$SIM_RESULTS"', run)), ['--out-dir "$SIM_RESULTS"', '--results-dir "$SIM_RESULTS"'])

    def test_the_pins_passed_to_the_runner_carry_everything_the_environment_digest_needs(self):
        run = step_text('Run the simulation')
        for key in ('repo_commit', 'uv_lock_sha256', 'python', 'torch', 'torch_cpu_sha256', 'uv_version', 'runner_image'):
            self.assertIn(f'"{key}"', run)
        needed = {'repo_commit', 'uv_lock_sha256', 'torch_cpu_sha256', 'python', 'uv_version', 'runner_image'}
        pins = {k: 'x' for k in needed}
        self.assertIsNotNone(mr.environment_digest(pins), 'the workflow must pin every piece environment_digest reads')

    def test_the_thinking_choices_are_ones_the_meter_accepts_and_default_to_disabled(self):
        allow = re.search(r'case "\$THINKING" in ([^)]+)\)', TEXT).group(1).split('|')
        self.assertEqual(sorted(allow), ['disabled', 'enabled'])
        self.assertTrue(set(allow) <= set(mm.THINKING_CHOICES))
        self.assertRegex(TEXT, r"thinking:\n(?:.*\n)*?\s+default: 'disabled'")

    def test_the_thinking_mode_reaches_the_meter_through_env_and_falls_back_where_the_toggle_is_undocumented(self):
        run = step_text('Run the simulation')
        meter = run.split('# 1. The meter')[1].split('# 2. MiroFish')[0]
        self.assertIn('THINKING="$THINKING"', meter)
        self.assertIn('THINKING: ${{ inputs.thinking }}', run)
        self.assertIn('THINKING: ${{ inputs.thinking }}', step_text('Validate inputs'))
        undocumented = sorted(m for m, (_, toggle) in mm.REQUEST_POLICY['moonshot'].items() if not toggle)
        self.assertEqual(undocumented, ['kimi-k2.7-code'])
        fallback = re.search(r'if \[ "\$MODEL" = "kimi-k2\.7-code" \]; then\n(.*?)\n\s*fi\n', run, re.S).group(1)
        self.assertIn('THINKING=provider-default', fallback)
        self.assertLess(run.index('THINKING=provider-default'), run.index('# 1. The meter'))  # decided before the meter starts

    def test_the_runner_deadline_sits_inside_the_job_timeout_with_room_for_install_and_publish(self):
        job_minutes = int(re.search(r'timeout-minutes: (\d+)', TEXT).group(1))
        deadline = int(re.search(r'--deadline-s (\d+)', step_text('Run the simulation')).group(1))
        self.assertEqual(deadline, mr.DEFAULT_DEADLINE_S)
        self.assertLessEqual(deadline + 600, job_minutes * 60)

    def test_a_failed_run_prints_the_simulations_own_log_and_mirofish_log_without_the_status_polls(self):
        run = step_text('Run the simulation')
        failure = run.split('if [ "$RC" -ne 0 ]; then')[1].split('exit "$RC"')[0]
        self.assertIn('uploads/simulations/*/simulation.log', failure)
        self.assertIn("grep -v '/run-status HTTP'", failure)

    def test_the_failure_block_keeps_the_runners_exit_code_whether_or_not_any_log_exists(self):
        # Run for real under the step's own `set -euo pipefail`: a missing log must not end the step early with another code.
        import subprocess
        import tempfile
        failure = step_text('Run the simulation').split('if [ "$RC" -ne 0 ]; then')[1].split('exit "$RC"')[0]
        for rc, make_logs in ((1, False), (2, False), (1, True)):
            with tempfile.TemporaryDirectory() as temp:
                if make_logs:
                    Path(temp, 'mirofish.log').write_text('x /run-status HTTP/1.1" 200\nERROR: provider said no\n')
                    sim = Path(temp, 'mirofish', 'backend', 'uploads', 'simulations', 'sim_1')
                    sim.mkdir(parents=True)
                    (sim / 'simulation.log').write_text('Traceback: camel\n')
                script = f'set -euo pipefail\nRC={rc}\nif [ "$RC" -ne 0 ]; then{failure}exit "$RC"\n'
                result = subprocess.run(['bash', '-c', script], env={**os.environ, 'RUNNER_TEMP': temp}, capture_output=True, text=True)
                self.assertEqual(result.returncode, rc, result.stderr)
                if make_logs:
                    self.assertIn('ERROR: provider said no', result.stdout)
                    self.assertNotIn('/run-status HTTP', result.stdout)
                    self.assertIn('Traceback: camel', result.stdout)

    def test_the_whole_meter_log_tail_is_printed_so_a_provider_error_is_visible_in_the_job(self):
        self.assertIn('meter.log" 2>/dev/null | tail -n 40', step_text('Run the simulation'))

    def test_the_default_ceiling_matches_the_spec_and_the_meter(self):
        self.assertRegex(TEXT, r"ceiling_usd:\n(?:.*\n)*?\s+default: '0\.40'")


class PublishingAndCleanup(unittest.TestCase):
    def test_the_record_is_published_even_when_the_run_fails_but_never_when_nothing_was_written(self):
        publish = step_text('Publish the record')
        self.assertIn("always() && env.SIM_RESULTS != ''", publish)
        self.assertIn('git -C "$WT" status --porcelain', publish)
        self.assertIn('git -C "$WT" push origin HEAD:sim-results', publish)
        self.assertIn('git -C "$WT" rebase origin/sim-results', publish)
        self.assertNotIn('--force', publish)

    def test_the_push_authenticates_with_the_job_token_not_a_stored_credential(self):
        self.assertIn('persist-credentials: false', TEXT)
        self.assertIn('GH_TOKEN: ${{ github.token }}', step_text('Publish the record'))

    def test_processes_are_stopped_on_every_exit_path(self):
        run = step_text('Run the simulation')
        self.assertIn('trap cleanup EXIT', run)
        self.assertIn('kill -TERM "$METER_PID"', run)

    def test_artifacts_are_uploaded_even_on_failure_with_a_bounded_retention(self):
        upload = step_text('Upload the record')
        self.assertIn('if: always()', upload)
        self.assertRegex(upload, r'retention-days: \d+')


@unittest.skipUnless(importlib.util.find_spec('yaml'), 'PyYAML not installed')
class RealYaml(unittest.TestCase):
    def test_it_parses_and_has_the_shape_the_text_checks_assume(self):
        import yaml
        doc = yaml.safe_load(TEXT)
        self.assertEqual(list(doc[True]), ['workflow_dispatch'])  # YAML 1.1 reads the key `on` as True
        self.assertEqual(sorted(doc['jobs']), ['sim'])
        names = [s.get('name') or s.get('uses') for s in doc['jobs']['sim']['steps']]
        self.assertEqual(len(names), 9)
        required = [k for k, v in doc[True]['workflow_dispatch']['inputs'].items() if v.get('required')]
        self.assertEqual(sorted(required), ['card_id', 'invocation_id', 'market_ticker', 'packet', 'sides'])


if __name__ == '__main__':
    unittest.main()
