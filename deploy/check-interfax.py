#!/usr/bin/env python3
"""Inspect private saved InterFAX configuration without restarting or sending."""
import json
import os
from interfax_access import AccessError, read_runtime, check

if __name__ == '__main__':
    try:
        if os.geteuid() != 0:
            raise AccessError('FAX_ROOT_REQUIRED')
        result = check(read_runtime())
    except AccessError as error:
        result = {'check': 'INTERFAX_ACCESS', 'code': str(error),
                  'accountVerified': False, 'faxSent': False}
    except Exception:
        result = {'check': 'INTERFAX_ACCESS', 'code': 'FAX_ACCOUNT_CHECK_FAILED',
                  'accountVerified': False, 'faxSent': False}
    print(json.dumps(result))
    raise SystemExit(0 if result['accountVerified'] else 1)
