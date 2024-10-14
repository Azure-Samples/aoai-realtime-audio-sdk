# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

from id_generator import generate_id


def test_id_schema():
    prefixes = ["test", "sh", "longer_prefix"]
    for prefix in prefixes:
        id = generate_id(prefix)
        assert len(id) == 32
