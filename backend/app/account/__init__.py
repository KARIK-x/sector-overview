"""Personal account, SMS ledger, fee and cash-flow domain.

The module is deliberately isolated from the market-analytics modules.  It
owns its tables (all prefixed ``account_``) and exposes a small FastAPI router
under ``/api/account``.  Nothing in this package is imported by the public
market-data endpoints.
"""

from __future__ import annotations

ACCOUNT_PARSER_VERSION = "nepse-sms-parser/1"
