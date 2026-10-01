"""Send one metadata-only transaction to the authorized local devnet."""
import hashlib
import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

import cbor2

ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / 'spikes/chain/local/work'
ATTACHMENTS = ROOT / 'docs/plans/2026-10-01-preregistry-mvp'
CONTAINER = 'codex-cardano-preregistry-stable'
SOCKET = '/clusters/nodes/default/node/node.sock'
LABEL = 123456789  # Temporary local label, not a registration or product choice.
STORE = 'http://127.0.0.1:18080/api/v1'
ADMIN = 'http://127.0.0.1:19000/local-cluster/api'


def cli(*args):
    cmd = ['docker', 'exec', '-e', f'CARDANO_NODE_SOCKET_PATH={SOCKET}', CONTAINER, 'cardano-cli', *args]
    return subprocess.check_output(cmd, text=True, stderr=subprocess.PIPE).strip()


def api(url, data=None):
    body = json.dumps(data).encode() if data is not None else None
    request = urllib.request.Request(url, body, {'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def wait_for(fetch, ready, timeout=120):
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        try:
            result = fetch()
            if ready(result):
                return result
        except (urllib.error.URLError, OSError, ValueError, subprocess.CalledProcessError) as err:
            last_error = type(err).__name__
        time.sleep(2)
    raise TimeoutError(f'Local devnet did not become ready: {last_error}')


def query_utxos(address):
    cli('conway', 'query', 'utxo', '--testnet-magic', '42', '--address', address, '--out-file', '/work/utxos.json')
    return json.loads((LOCAL / 'utxos.json').read_text())


def main():
    LOCAL.mkdir(parents=True, exist_ok=True)
    keys = LOCAL / 'keys'
    keys.mkdir(exist_ok=True)
    keypaths = [keys / 'payment.skey', keys / 'payment.vkey']
    for path in keypaths:
        subprocess.run(['git', '-C', str(ROOT), 'check-ignore', '-q', str(path)], check=True)
    if not keypaths[0].exists():
        cli('conway', 'address', 'key-gen', '--signing-key-file', '/work/keys/payment.skey', '--verification-key-file', '/work/keys/payment.vkey')
    for path in keypaths:
        path.chmod(0o600)
    address = cli('conway', 'address', 'build', '--payment-verification-key-file', '/work/keys/payment.vkey', '--testnet-magic', '42')
    wait_for(lambda: json.loads(cli('conway', 'query', 'tip', '--testnet-magic', '42')), lambda t: float(t.get('syncProgress', 0)) >= 99.9, timeout=600)
    funded = query_utxos(address)
    if not funded:
        topup = api(ADMIN + '/addresses/topup', {'address': address, 'adaAmount': 100})
        assert topup['status'] is True
        funded = wait_for(lambda: query_utxos(address), bool)
    # A spike-only hash does not imply a formal format is selected or frozen.
    committed_hash = hashlib.sha256(b'cardano-ai-preregistry local metadata cost spike v0').hexdigest()
    fields = [('app', {'string': 'cardano-ai-preregistry:spike'}),
              ('hash', {'bytes': committed_hash}), ('version', {'int': 0}),
              ('network', {'string': 'devnet'}), ('magic', {'int': 42})]
    detailed = {str(LABEL): {'map': [{'k': {'string': k}, 'v': v} for k, v in fields]}}
    (LOCAL / 'metadata.json').write_text(json.dumps(detailed, indent=2) + '\n')
    tip_before = json.loads(cli('conway', 'query', 'tip', '--testnet-magic', '42'))
    cli('conway', 'query', 'protocol-parameters', '--testnet-magic', '42', '--out-file', '/work/protocol.json')
    parameters = json.loads((LOCAL / 'protocol.json').read_text())
    tx_in = next(iter(funded))
    build_output = cli('conway', 'transaction', 'build', '--testnet-magic', '42', '--tx-in', tx_in,
                       '--change-address', address, '--metadata-json-file', '/work/metadata.json',
                       '--json-metadata-detailed-schema', '--out-file', '/work/tx.body')
    cli('conway', 'transaction', 'sign', '--testnet-magic', '42', '--tx-body-file', '/work/tx.body',
        '--signing-key-file', '/work/keys/payment.skey', '--out-file', '/work/tx.signed')
    envelope = json.loads((LOCAL / 'tx.signed').read_text())
    signed_cbor = bytes.fromhex(envelope['cborHex'])
    decoded = cbor2.loads(signed_cbor)
    body = decoded[0]
    fee = body[2]
    tx_id = cli('conway', 'transaction', 'txid', '--tx-file', '/work/tx.signed')
    submitted = time.monotonic()
    cli('conway', 'transaction', 'submit', '--testnet-magic', '42', '--tx-file', '/work/tx.signed')
    # UTxO query confirms local node inclusion independently of the indexer.
    included_utxos = wait_for(lambda: query_utxos(address), lambda xs: any(k.startswith(tx_id + '#') for k in xs))
    inclusion_seconds = time.monotonic() - submitted
    tip_after = json.loads(cli('conway', 'query', 'tip', '--testnet-magic', '42'))
    readback = wait_for(lambda: api(STORE + '/txs/' + tx_id + '/metadata'),
                        lambda xs: isinstance(xs, list) and any(str(x.get('label')) == str(LABEL) for x in xs), timeout=180)
    indexed_seconds = time.monotonic() - submitted
    entry = next(x for x in readback if str(x['label']) == str(LABEL))
    value = entry['json_metadata']
    # The provider represents CBOR byte strings as 0x-prefixed hex.
    raw_hash = value['hash']
    readback_hash = bytes.fromhex(raw_hash.removeprefix('0x')).hex()
    assert len(bytes.fromhex(readback_hash)) == 32
    assert readback_hash == committed_hash, (value, committed_hash)
    tx_info = api(STORE + '/txs/' + tx_id)
    size = len(signed_cbor)
    linear = parameters['txFeePerByte'] * size + parameters['txFeeFixed']
    # Exact minimum fee for this signed transaction (one key witness, no scripts).
    min_fee_output = cli('conway', 'transaction', 'calculate-min-fee', '--tx-body-file', '/work/tx.body',
                         '--protocol-params-file', '/work/protocol.json', '--witness-count', '1')
    result = {'network': 'devnet', 'network_magic': 42, 'label': LABEL, 'format_version': 0,
              'tx_id': tx_id, 'commitment_hash': committed_hash, 'readback_hash': readback_hash,
              'readback_equal': True, 'signed_size_bytes': size, 'actual_fee_lovelace': fee,
              'min_fee_a': parameters['txFeePerByte'], 'min_fee_b': parameters['txFeeFixed'],
              'linear_fee_lovelace': linear, 'fee_minus_linear_lovelace': fee - linear,
              'calculate_min_fee_output': min_fee_output, 'build_output': build_output,
              'local_inclusion_seconds': round(inclusion_seconds, 3),
              'indexer_readback_seconds': round(indexed_seconds, 3),
              'tip_before': tip_before, 'tip_after': tip_after, 'metadata_readback': readback,
              'tx_info': tx_info, 'included_output_count': sum(k.startswith(tx_id + '#') for k in included_utxos),
              'cardano_cli_version': cli('--version')}
    (ATTACHMENTS / 'chain-results.json').write_text(json.dumps(result, indent=2) + '\n')
    (ATTACHMENTS / 'chain-protocol-parameters.json').write_text(json.dumps(parameters, indent=2) + '\n')
    print(json.dumps({k: result[k] for k in ['tx_id', 'signed_size_bytes', 'actual_fee_lovelace', 'linear_fee_lovelace', 'local_inclusion_seconds', 'indexer_readback_seconds', 'readback_equal']}))


if __name__ == '__main__':
    main()
