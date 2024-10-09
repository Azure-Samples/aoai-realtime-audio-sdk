# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import secrets


def generate_id(prefix: str) -> str:
    suffix = secrets.token_urlsafe(24)
    return f"{prefix}-{suffix[len(prefix) + 1:]}"
