# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

from pydantic import BaseModel, model_validator


class ModelWithDefaults(BaseModel):
    @model_validator(mode="after")
    def _add_defaults(self):
        model_fields = self.__class__.model_fields
        for field in model_fields:
            if model_fields[field].default is not None:
                if not hasattr(self, field) or getattr(self, field) == model_fields[field].default:
                    setattr(self, field, model_fields[field].default)
        return self