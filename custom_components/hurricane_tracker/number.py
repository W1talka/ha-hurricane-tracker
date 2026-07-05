"""Number entity for Hurricane Tracker -- the "within range" radius as an entity.

Surfaces CONF_RANGE as an HA number so any dashboard/automation can read the
current radius and change it with a plain `number.set_value`. The entity's value
IS the live config option (self-documenting current-setting readout); setting it
writes entry.options + reloads, the same path as the set_options service. Bounds
mirror the config flow (100-6000, step 50). The displayed unit follows the
configured distance unit (mi/km), matching how range is interpreted downstream.
"""
from __future__ import annotations

from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfLength
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import async_apply_options
from .const import CONF_RANGE, DEFAULT_RANGE, DOMAIN, UNIT_KM


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator = hass.data[DOMAIN][entry.entry_id]
    units = coordinator._cfg()["units"]
    length_unit = UnitOfLength.KILOMETERS if units == UNIT_KM else UnitOfLength.MILES
    async_add_entities([HurricaneRangeNumber(entry, length_unit)])


class HurricaneRangeNumber(NumberEntity):
    """The "within range" radius, in the configured distance unit."""

    _attr_has_entity_name = True
    _attr_name = "Range"
    _attr_icon = "mdi:radius-outline"
    _attr_mode = NumberMode.BOX
    _attr_native_min_value = 100
    _attr_native_max_value = 6000
    _attr_native_step = 50

    def __init__(self, entry: ConfigEntry, length_unit) -> None:
        self._entry = entry
        self._attr_native_unit_of_measurement = length_unit
        self._attr_unique_id = f"{entry.entry_id}_range"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="Hurricane Tracker",
            manufacturer="NHC/NOAA + GDACS (JRC)",
            entry_type=None,
        )

    @property
    def native_value(self):
        merged = {**self._entry.data, **self._entry.options}
        return merged.get(CONF_RANGE, DEFAULT_RANGE)

    async def async_set_native_value(self, value: float) -> None:
        async_apply_options(self.hass, self._entry, {CONF_RANGE: value})
