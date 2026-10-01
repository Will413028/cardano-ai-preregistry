"""Disposable cross-language experiment; not the product format specification."""
import hashlib
import hmac
import json
import math
import subprocess
from pathlib import Path

import cbor2
import rfc8785

ROOT = Path(__file__).resolve().parent
NODE = ROOT / 'node_modules/node/bin/node'
ATTACHMENTS = ROOT.parents[1] / 'docs/plans/2026-10-01-preregistry-mvp'
DOMAIN = b'cardano-ai-preregistry:spike'
SALT = bytes(range(32))  # Public test vector, never a production salt.
VERSION = 0
NETWORK = 'devnet'


def normalize(value):
    # The experiment deliberately uses the common JSON safe-number subset.
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, (int, float)):
        if not math.isfinite(value) or (value == int(value) and abs(value) > 2**53 - 1):
            raise ValueError('unsafe-number: use a decimal string')
        return int(value) if value == int(value) else value
    if isinstance(value, str):
        value.encode('utf-8', errors='strict')
        return value
    if isinstance(value, list):
        return [normalize(x) for x in value]
    if isinstance(value, dict):
        return {normalize(k): normalize(v) for k, v in value.items()}
    raise ValueError('unsupported value')


def frame(data):
    return len(data).to_bytes(4, 'big') + data


def digest(data, fmt):
    return hashlib.sha256(data).digest() if fmt == 'jcs-sha256' else hashlib.blake2b(data, digest_size=32).digest()


def canonical(value, fmt):
    value = normalize(value)
    return rfc8785.dumps(value) if fmt == 'jcs-sha256' else cbor2.dumps(value, canonical=True)


def encode(value, fmt, construction):
    raw = canonical(value, fmt)
    prefix = frame(DOMAIN) + VERSION.to_bytes(2, 'big') + frame(NETWORK.encode())
    if construction == 'concat':
        hashed = digest(prefix + SALT + frame(raw), fmt)
    elif construction == 'hmac':
        if fmt == 'jcs-sha256':
            hashed = hmac.digest(SALT, prefix + frame(raw), 'sha256')
        else:
            hashed = hmac.new(SALT, prefix + frame(raw), lambda d=b'': hashlib.blake2b(d, digest_size=32)).digest()
    else:
        # One leaf per top-level field, independent derived salt per leaf.
        fields = sorted(value, key=lambda k: k.encode('utf-16-be'))
        level = []
        for key in fields:
            keybytes = key.encode()
            leaf_salt = hmac.digest(SALT, b'leaf-salt' + frame(keybytes), 'sha256')
            level.append(digest(b'\x00' + prefix + leaf_salt + frame(keybytes) + frame(canonical(value[key], fmt)), fmt))
        if not level:
            level = [digest(b'\x02' + prefix + SALT, fmt)]
        while len(level) > 1:
            if len(level) % 2:
                level.append(level[-1])
            level = [digest(b'\x01' + level[i] + level[i+1], fmt) for i in range(0, len(level), 2)]
        hashed = digest(b'\x03' + prefix + len(fields).to_bytes(4, 'big') + level[0], fmt)
    return {'canonical_hex': raw.hex(), 'expected_hash': hashed.hex()}


CASES = [
    ('key-order-a', {'z': 2, 'a': 1}),
    ('key-order-b', {'a': 1, 'z': 2}),
    ('changed-value', {'a': 1, 'z': 3}),
    ('unicode', {'\ue000': '繁體中文', '😀': 'é', 'é': 'e\u0301'}),
    ('float', {'temperature': 0.1, 'epsilon': 1e-7, 'integral': 1.0, 'negative_zero': -0.0}),
    ('safe-integer', {'seed': 9007199254740991}),
    ('large-integer', {'seed': 9007199254740993}),
    ('large-integer-string', {'seed': '9007199254740993'}),
    ('empty-array', {'runs': []}),
    ('nested', {'experiments': [{'config': {'top_k': 5, 'temperature': 0.7}, 'planned_runs': 3}], 'ok': True, 'nil': None}),
    ('empty-object', {}),
]


def main():
    vectors = []
    for fmt in ['jcs-sha256', 'cbor-length-first-blake2b256']:
        for construction in ['concat', 'hmac', 'merkle']:
            for name, value in CASES:
                item = {'id': f'{fmt}/{construction}/{name}', 'format': fmt, 'construction': construction,
                        'domain_tag': DOMAIN.decode(), 'format_version': VERSION, 'network': NETWORK,
                        'salt_hex': SALT.hex(), 'input': value}
                try:
                    item.update(encode(value, fmt, construction))
                except ValueError:
                    item['expected_error'] = 'unsafe-number: use a decimal string'
                vectors.append(item)
    target = ATTACHMENTS / 'test-vectors.json'
    target.write_text(json.dumps(vectors, ensure_ascii=False, indent=2) + '\n')
    # Pin the runtime used by the experiment; Node runs TypeScript directly.
    proc = subprocess.run([str(NODE), str(ROOT / 'compare.ts'), str(target)], text=True, capture_output=True, check=True)
    actual = json.loads(proc.stdout)
    assert len(actual) == len(vectors)
    for item, result in zip(vectors, actual, strict=True):
        expected = {k: item[k] for k in ['canonical_hex', 'expected_hash', 'expected_error'] if k in item}
        assert result == expected, (item['id'], expected, result)
    for fmt in ['jcs-sha256', 'cbor-length-first-blake2b256']:
        for construction in ['concat', 'hmac', 'merkle']:
            a = encode(CASES[0][1], fmt, construction)
            assert a == encode(CASES[1][1], fmt, construction)
            assert a['expected_hash'] != encode(CASES[2][1], fmt, construction)['expected_hash']
    result = {'vectors': len(vectors), 'matched': sum('expected_hash' in v for v in vectors),
              'rejected_in_both': sum('expected_error' in v for v in vectors),
              'key_order_checks': 6, 'changed_value_checks': 6,
              'python': __import__('sys').version.split()[0],
              'node': subprocess.check_output([str(NODE), '--version'], text=True).strip()}
    (ATTACHMENTS / 'canonical-results.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
