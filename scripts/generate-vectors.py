"""Generate v1 and v2 fixtures independently using RFC 8785's Python implementation.

Run with a Python environment containing rfc8785==0.1.4. Generation is optional;
the saved fixtures are consumed by the offline TypeScript/browser test suite.
"""
import hashlib
import json
from pathlib import Path

import rfc8785

ROOT = Path(__file__).resolve().parents[1]
DOMAIN = b'cardano-ai-preregistry'
SALT = bytes(range(32))  # Public deterministic test input, never a private salt.
REGISTRANT = bytes(range(100, 128))  # Public 28-byte test key hash, not a real wallet.
OTHER_REGISTRANT = bytes(range(200, 228))


def frame(value):
    return len(value).to_bytes(4, 'big') + value


manifest = {
    'schema_version': 1,
    'title': 'Example: retrieval baseline',
    'reveal_deadline': '2030-01-01T00:00:00Z',
    'datasets': [{'id': 'example-evaluation', 'role': 'evaluation', 'version': 'v1', 'sha256': 'a' * 64}],
    'experiments': [{
        'id': 'baseline', 'model': {'id': 'example-model', 'version': 'v1'},
        'settings': {'temperature': 0.2, 'top_k': 5},
        'metrics': [{'id': 'accuracy', 'method': 'Exact match, fraction of correct answers.'}],
        'planned_runs': 3,
    }],
}
unicode_manifest = json.loads(json.dumps(manifest))
unicode_manifest['title'] = '繁體中文 😀 é e\u0301'
unicode_manifest['experiments'][0]['settings'] = {'\ue000': '一', '😀': '二', '2': 2, '10': 10, 'epsilon': 1e-7}
cases = [('baseline', manifest, 'preprod:1'),
         ('reversed-keys', dict(reversed(list(manifest.items()))), 'preprod:1'),
         ('network-separation', manifest, 'devnet:42'),
         ('unicode-and-numbers', unicode_manifest, 'preprod:1')]


def vector(name, value, network, version, registrant=None):
    canonical = rfc8785.dumps(value)
    bound = frame(registrant) if version == 2 else b''
    encoded = frame(DOMAIN) + version.to_bytes(2, 'big') + frame(network.encode()) + bound + SALT + frame(canonical)
    item = {'id': name, 'manifest': value, 'domain_tag': DOMAIN.decode(), 'format_version': version,
            'network_id': network, 'salt_hex': SALT.hex()}
    if version == 2:
        item['registrant_hex'] = registrant.hex()
    item.update({'canonical_hex': canonical.hex(), 'encoded_hex': encoded.hex(), 'expected_hash': hashlib.sha256(encoded).hexdigest()})
    return item


# v1 is used by existing devnet transactions; its fixture must stay byte-identical.
v1 = [vector(name, value, network, 1) for name, value, network in cases]
v2 = [vector(name, value, network, 2, REGISTRANT) for name, value, network in cases]
v2.append(vector('registrant-separation', manifest, 'preprod:1', 2, OTHER_REGISTRANT))
for version, vectors in ((1, v1), (2, v2)):
    (ROOT / f'tests/fixtures/commitment-v{version}.json').write_text(json.dumps(vectors, ensure_ascii=False, indent=2) + '\n')
print(f'Generated {len(v1)} v1 and {len(v2)} v2 Python JCS/SHA-256 vectors.')
