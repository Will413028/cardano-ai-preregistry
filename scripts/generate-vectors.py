"""Generate v1 fixtures independently using RFC 8785's Python implementation.

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
vectors = []
for name, value, network in cases:
    canonical = rfc8785.dumps(value)
    encoded = frame(DOMAIN) + (1).to_bytes(2, 'big') + frame(network.encode()) + SALT + frame(canonical)
    vectors.append({'id': name, 'manifest': value, 'domain_tag': DOMAIN.decode(), 'format_version': 1,
                    'network_id': network, 'salt_hex': SALT.hex(), 'canonical_hex': canonical.hex(),
                    'encoded_hex': encoded.hex(), 'expected_hash': hashlib.sha256(encoded).hexdigest()})
(ROOT / 'tests/fixtures/commitment-v1.json').write_text(json.dumps(vectors, ensure_ascii=False, indent=2) + '\n')
print(f'Generated {len(vectors)} Python JCS/SHA-256 v1 vectors.')
