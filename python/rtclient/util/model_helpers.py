# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

from pydantic import BaseModel, model_validator


class WithType(BaseModel):
    @model_validator(mode="after")
    def _add_type(self):
        if "type" in self.model_fields:
            self.type = self.model_fields["type"].default
        return self
