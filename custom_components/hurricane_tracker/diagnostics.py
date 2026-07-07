"""Diagnostics for the Hurricane Tracker integration.

Home Assistant offers a "Download diagnostics" button per config entry. Users
paste the result into PUBLIC GitHub issues, so this must never leak the user's
location: home lat/lon are redacted. We also deliberately DON'T dump the full
baked geometry (cone polygons + clipped coastline) -- it's large, uninteresting
for debugging, and would bury the useful signal. What we do surface is the shape
of the current result (ok/reason/counts, staleness, failed sources) and the
state of the bake cache (ids + ages, no payloads), which is what actually matters
when someone reports "storm vanished" or "stuck on stale".
"""
from __future__ import annotations

import time

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import CONF_LATITUDE, CONF_LONGITUDE, DOMAIN

# Home location is the one privacy-sensitive field; redact in both data and
# options (the options flow can override the configured home).
TO_REDACT = {CONF_LATITUDE, CONF_LONGITUDE, "latitude", "longitude"}


def _result_summary(data) -> dict:
    """Shape of the coordinator's current result WITHOUT the heavy geometry.
    Mirrors the two result shapes _build returns (ok / not-ok) and pulls only
    scalars + per-storm meta useful for triage."""
    if not isinstance(data, dict):
        return {"present": False}
    out = {
        "ok": data.get("ok"),
        "reason": data.get("reason"),
        "ts": data.get("ts"),
        "off_season": data.get("off_season"),
    }
    if data.get("ok"):
        storms = data.get("storms") or []
        out["count"] = data.get("count")
        out["anyStale"] = data.get("anyStale")
        out["anyFresh"] = data.get("anyFresh")
        # per-storm: id + staleness only, never the payload geometry
        out["storms"] = [
            {"id": s.get("id"), "stale": s.get("stale"),
             "bakedTs": s.get("bakedTs")}
            for s in storms
        ]
    else:
        out["activeAnywhere"] = data.get("activeAnywhere")
        out["failedSources"] = data.get("failedSources")
    return out


def _cache_summary(coordinator) -> list:
    """Bake-cache entries as {id, ageMinutes} -- no payloads. Tells us at a
    glance whether a stale render is backed by a recent bake or a near-expiry one."""
    cache = getattr(coordinator, "_bake_cache", None) or {}
    now_ms = int(time.time() * 1000)
    out = []
    for sid, ent in cache.items():
        ts = ent.get("ts") if isinstance(ent, dict) else None
        age_min = round((now_ms - ts) / 60000.0, 1) if ts else None
        out.append({"id": sid, "ageMinutes": age_min})
    return out


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry
) -> dict:
    store = (hass.data.get(DOMAIN) or {}).get(entry.entry_id)
    diag = {
        "entry": {
            "data": async_redact_data(dict(entry.data), TO_REDACT),
            "options": async_redact_data(dict(entry.options), TO_REDACT),
        },
    }
    if store is not None:
        diag["result"] = _result_summary(store.data)
        diag["last_update_success"] = store.last_update_success
        diag["bake_cache"] = _cache_summary(store)
    else:
        diag["result"] = {"present": False}
    return diag
