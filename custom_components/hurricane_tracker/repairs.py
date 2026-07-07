"""Repairs issues for the Hurricane Tracker integration.

ONE issue: raised when we are genuinely BLIND to a known-active storm -- a feed
outage that has outlived the bake cache, so we can neither bake fresh nor serve a
stale-but-recent payload. That's the dangerous state: a storm exists somewhere and
the card can show nothing about it.

What must NOT raise an issue: a transient timeout that still serves a cached
(stale) cone. That path returns ok=True with a stale flag and the card shows a
"last updated" note -- the user is informed, not blind. Raising a Repairs issue
there would be noise, and every timeout would spam the Repairs dashboard. The
whole point of the bake cache is to make transient timeouts a non-event; the issue
fires only once the cache can no longer cover the gap.

Signal used: the coordinator result dict. `reason == "unavailable"` with
`activeAnywhere > 0` means storms ARE active but nothing baked and nothing was
cacheable -- blind. Anything else (ok result, clear ocean, none_matched) clears
the issue. Recovery auto-deletes on the next result that isn't blind.
"""
from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir

from .const import DOMAIN

ISSUE_BLIND_OUTAGE = "blind_outage"


def _is_blind(result) -> bool:
    """True only when a storm is known active but we can show nothing about it."""
    if not isinstance(result, dict):
        return False
    return (
        result.get("reason") == "unavailable"
        and (result.get("activeAnywhere") or 0) > 0
    )


def sync_blind_outage_issue(hass: HomeAssistant, result) -> None:
    """Create or clear the blind-outage issue to match the current result.

    Called every poll from the coordinator. Idempotent: create/delete are no-ops
    when the state already matches, so re-asserting each poll is cheap and the
    issue auto-clears the first poll we're no longer blind.
    """
    if _is_blind(result):
        sources = result.get("failedSources") or ["the storm feed"]
        ir.async_create_issue(
            hass,
            DOMAIN,
            ISSUE_BLIND_OUTAGE,
            is_fixable=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key=ISSUE_BLIND_OUTAGE,
            translation_placeholders={"sources": ", ".join(sources)},
        )
    else:
        ir.async_delete_issue(hass, DOMAIN, ISSUE_BLIND_OUTAGE)
