# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import re


def test_user_agent_schema():
    from rtclient.util.user_agent import get_user_agent

    user_agent = get_user_agent()
    regex = re.compile("ms-rtclient/\d+\.\d+\.\d+ Python/\d+\.\d+\.\d+")
    assert regex.match(user_agent) is not None
