from typing import Literal

from model_helpers import ModelWithType


class ModelWithType(ModelWithType):
    type: Literal["object_type"] = "object_type"


def test_with_type_field():
    instance = ModelWithType()
    assert instance.type == "object_type"


def test_serialize_with_type_field():
    instance = ModelWithType()
    assert instance.model_dump() == {"type": "object_type"}
