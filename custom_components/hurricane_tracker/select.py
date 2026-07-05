"""Select entities for Hurricane Tracker -- the config options as entities.

These expose the integration's own settings as HA entities so any dashboard,
automation, or card can read the current value and change it with a plain
`select.select_option`, no custom service needed. Each entity's current option
IS the live config option, so it's self-documenting: the entity is the
"current setting" readout, and setting it writes entry.options + reloads
(the same path as the set_options service). This is the primary control API;
set_options remains for one-shot scripting.

All three describe the single integration instance and live under the one
"Hurricane Tracker" device alongside the sensors.
"""
from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import async_apply_options
from .const import (
    BASIN_ATLANTIC,
    BASIN_AUSTRALIAN,
    BASIN_AUTO,
    BASIN_CENTRAL_PACIFIC,
    BASIN_EAST_PACIFIC,
    BASIN_GLOBAL,
    BASIN_NORTH_INDIAN,
    BASIN_NW_PACIFIC,
    BASIN_RANGE,
    BASIN_SOUTH_PACIFIC,
    BASIN_SW_INDIAN,
    CONF_BASIN,
    CONF_FILTER,
    CONF_UNITS,
    DEFAULT_BASIN,
    DEFAULT_FILTER,
    DOMAIN,
    FILTER_ALL,
    FILTER_THREAT,
    UNIT_KM,
    UNIT_MI,
)

# option value -> human label. The card/UI shows the label; the stored option is
# the value. Keys mirror the config_flow dropdowns exactly (one source of truth
# would be nice, but these are stable and duplicated only here).
_BASIN_LABELS = {
    BASIN_AUTO: "My region (home basin only)",
    BASIN_RANGE: "Within range of home",
    BASIN_GLOBAL: "Anywhere in the world",
    BASIN_ATLANTIC: "Atlantic",
    BASIN_EAST_PACIFIC: "East Pacific",
    BASIN_CENTRAL_PACIFIC: "Central Pacific",
    BASIN_NW_PACIFIC: "Northwest Pacific",
    BASIN_NORTH_INDIAN: "North Indian",
    BASIN_SW_INDIAN: "Southwest Indian",
    BASIN_AUSTRALIAN: "Australian region",
    BASIN_SOUTH_PACIFIC: "South Pacific",
}
_FILTER_LABELS = {
    FILTER_THREAT: "Storm threatening / closest to home",
    FILTER_ALL: "All active systems",
}
_UNIT_LABELS = {
    UNIT_MI: "Miles / mph",
    UNIT_KM: "Kilometers / km/h",
}


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    async_add_entities([
        HurricaneBasinSelect(entry),
        HurricaneFilterSelect(entry),
        HurricaneUnitsSelect(entry),
    ])


class _HurricaneSelect(SelectEntity):
    """A config option surfaced as a select.

    Subclasses set `_conf_key`, `_labels` (value->label), and `_default`. The
    current option is read live off entry.options/data every access, so it always
    reflects the real setting even after a change from the options flow or the
    service. Choosing an option writes it back and reloads.
    """

    _attr_has_entity_name = True
    _conf_key: str = ""
    _labels: dict[str, str] = {}
    _default: str = ""

    def __init__(self, entry: ConfigEntry) -> None:
        self._entry = entry
        self._value_by_label = {v: k for k, v in self._labels.items()}
        self._attr_options = list(self._labels.values())
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="Hurricane Tracker",
            manufacturer="NHC/NOAA + GDACS (JRC)",
            entry_type=None,
        )

    def _current_value(self) -> str:
        merged = {**self._entry.data, **self._entry.options}
        return merged.get(self._conf_key, self._default)

    @property
    def current_option(self):
        return self._labels.get(self._current_value())

    async def async_select_option(self, option: str) -> None:
        value = self._value_by_label.get(option)
        if value is None:
            return
        async_apply_options(self.hass, self._entry, {self._conf_key: value})


class HurricaneBasinSelect(_HurricaneSelect):
    """Storms to show: the 3 scope modes + 8 explicit basins (mirrors CONF_BASIN)."""

    _attr_name = "Storms to show"
    _attr_icon = "mdi:map-search"
    _conf_key = CONF_BASIN
    _labels = _BASIN_LABELS
    _default = DEFAULT_BASIN

    def __init__(self, entry: ConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{entry.entry_id}_basin"


class HurricaneFilterSelect(_HurricaneSelect):
    """Which storms to show: closest threat only, or cycle all active systems."""

    _attr_name = "Which storms"
    _attr_icon = "mdi:filter-variant"
    _conf_key = CONF_FILTER
    _labels = _FILTER_LABELS
    _default = DEFAULT_FILTER

    def __init__(self, entry: ConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{entry.entry_id}_filter"


class HurricaneUnitsSelect(_HurricaneSelect):
    """Distance/speed units (miles or kilometers)."""

    _attr_name = "Units"
    _attr_icon = "mdi:ruler"
    _conf_key = CONF_UNITS
    _labels = _UNIT_LABELS
    # No static default constant -- units default to the HA system's unit. Read
    # the coordinator's resolved unit so the entity shows the true active value
    # even when the option was never explicitly set.
    _default = UNIT_MI

    def __init__(self, entry: ConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{entry.entry_id}_units"

    def _current_value(self) -> str:
        merged = {**self._entry.data, **self._entry.options}
        val = merged.get(CONF_UNITS)
        if val:
            return val
        # Fall back to whatever the coordinator resolved from the HA unit system.
        coordinator = (self.hass.data.get(DOMAIN) or {}).get(self._entry.entry_id)
        if coordinator is not None:
            return coordinator._cfg()["units"]
        return self._default
