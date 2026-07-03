"""Region labels drawn on the map (country / state names) for orientation.

This is plain reference data — a flat list of anchor points. The rendering code
in the card is region-agnostic: it draws whatever falls in view and clears the
storm data. To cover more of the world, just append rows here; no code changes.

Each entry:
    name : label text (kept short; the card uppercases it)
    lng  : anchor longitude (approx region centroid, decimal degrees, E positive)
    lat  : anchor latitude
    tier : 0 = country / major (shown even when zoomed out)
           1 = state / province (shown only when zoomed in enough)

Coverage today: NHC basins (Atlantic + East/Central Pacific) — countries and
U.S. coastal states. Extend outward from here.
"""
from __future__ import annotations

REGION_LABELS = [
    # --- Countries / territories (tier 0) ---
    {"name": "United States", "lng": -98.5, "lat": 39.5, "tier": 0},
    {"name": "Mexico", "lng": -102.5, "lat": 23.6, "tier": 0},
    {"name": "Canada", "lng": -95.0, "lat": 56.0, "tier": 0},
    {"name": "Cuba", "lng": -79.0, "lat": 21.6, "tier": 0},
    {"name": "Bahamas", "lng": -76.6, "lat": 24.3, "tier": 0},
    {"name": "Jamaica", "lng": -77.3, "lat": 18.1, "tier": 0},
    {"name": "Haiti", "lng": -72.5, "lat": 19.1, "tier": 0},
    {"name": "Dominican Rep.", "lng": -70.5, "lat": 18.9, "tier": 0},
    {"name": "Puerto Rico", "lng": -66.5, "lat": 18.2, "tier": 0},
    {"name": "Belize", "lng": -88.7, "lat": 17.2, "tier": 0},
    {"name": "Guatemala", "lng": -90.4, "lat": 15.6, "tier": 0},
    {"name": "Honduras", "lng": -86.6, "lat": 14.8, "tier": 0},
    {"name": "El Salvador", "lng": -88.9, "lat": 13.7, "tier": 0},
    {"name": "Nicaragua", "lng": -85.2, "lat": 12.9, "tier": 0},
    {"name": "Costa Rica", "lng": -84.1, "lat": 9.9, "tier": 0},
    {"name": "Panama", "lng": -80.1, "lat": 8.6, "tier": 0},
    {"name": "Colombia", "lng": -73.5, "lat": 4.6, "tier": 0},
    {"name": "Venezuela", "lng": -66.5, "lat": 7.5, "tier": 0},

    # --- U.S. coastal states (tier 1) ---
    {"name": "Texas", "lng": -99.3, "lat": 31.3, "tier": 1},
    {"name": "Louisiana", "lng": -92.0, "lat": 31.0, "tier": 1},
    {"name": "Mississippi", "lng": -89.7, "lat": 32.6, "tier": 1},
    {"name": "Alabama", "lng": -86.8, "lat": 32.8, "tier": 1},
    {"name": "Florida", "lng": -81.6, "lat": 28.3, "tier": 1},
    {"name": "Georgia", "lng": -83.4, "lat": 32.7, "tier": 1},
    {"name": "South Carolina", "lng": -80.9, "lat": 33.9, "tier": 1},
    {"name": "North Carolina", "lng": -79.4, "lat": 35.6, "tier": 1},
    {"name": "Virginia", "lng": -78.7, "lat": 37.5, "tier": 1},
    {"name": "Maryland", "lng": -76.8, "lat": 39.0, "tier": 1},
    {"name": "Delaware", "lng": -75.5, "lat": 39.0, "tier": 1},
    {"name": "New Jersey", "lng": -74.5, "lat": 40.1, "tier": 1},
    {"name": "New York", "lng": -75.5, "lat": 42.9, "tier": 1},
    {"name": "Connecticut", "lng": -72.7, "lat": 41.6, "tier": 1},
    {"name": "Rhode Island", "lng": -71.5, "lat": 41.7, "tier": 1},
    {"name": "Massachusetts", "lng": -71.8, "lat": 42.3, "tier": 1},
    {"name": "Maine", "lng": -69.2, "lat": 45.3, "tier": 1},
    {"name": "California", "lng": -119.6, "lat": 36.5, "tier": 1},
    {"name": "Hawaii", "lng": -156.3, "lat": 20.3, "tier": 1},
]
