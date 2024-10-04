# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

from pydantic import BaseModel, model_validator


class ModelWithDefaults(BaseModel):
    @model_validator(mode="after")
    def _add_defaults(self):
        for field in self.model_fields:
            if self.model_fields[field].default is not None:
                if not hasattr(self, field) or getattr(self, field) == self.model_fields[field].default:
                    setattr(self, field, self.model_fields[field].default)
        return self
