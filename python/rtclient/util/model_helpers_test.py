# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

from typing import Optional

from model_helpers import ModelWithDefaults


class Bar(ModelWithDefaults):
    foo: Optional[int] = None
    bar: Optional[float] = 3.14
    baz: int = 42


def test_with_defaults():
    instance = Bar()
    assert instance.foo is None
    assert instance.baz == 42


def test_serialize_with_defaults():
    instance = Bar()
    assert instance.model_dump(exclude_unset=True) == {"bar": 3.14, "baz": 42}
