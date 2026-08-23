const DEG = Math.PI / 180;

export type CityId = "sf" | "nyc";

export type City = {
  id: CityId;
  name: string;
  /** Spawn latitude, radians. */
  lat: number;
  /** Spawn longitude, radians. */
  lon: number;
  /** Height above ellipsoid, meters. */
  height: number;
  /** Compass azimuth clockwise from north, radians. */
  az: number;
  /** Pitch above horizon, radians. */
  el: number;
  hint: string;
};

export const CITIES: Record<CityId, City> = {
  sf: {
    id: "sf",
    name: "San Francisco",
    // ~1 km east of the Embarcadero, inbound to the Financial District.
    lat: 37.7932 * DEG,
    lon: -122.3822 * DEG,
    height: 310,
    az: 252 * DEG,
    el: -0.02,
    hint: "Downtown skyline inbound",
  },
  nyc: {
    id: "nyc",
    name: "New York",
    // Hudson, looking east into Midtown.
    lat: 40.7512 * DEG,
    lon: -74.0228 * DEG,
    height: 430,
    az: 92 * DEG,
    el: -0.04,
    hint: "Hudson into Midtown",
  },
};

export const CITY_ORDER: CityId[] = ["sf", "nyc"];

/** CesiumJS evaluation token — public, expires 1 Oct 2026. */
export const ION_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJkYjZkM2MyOS1mODRiLTRlMGQtYTYzMy0xNWYyYmNiZjE1NGUiLCJpZCI6MjU5LCJzdWIiOiJDZXNpdW1KUyIsImlzcyI6Imh0dHBzOi8vYXBpLmNlc2l1bS5jb20iLCJhdWQiOiIxLjE0NCBSZWxlYXNlIC0gRGVsZXRlIG9uIE9jdG9iZXIgMSwgMjAyNiIsImlhdCI6MTc4NDk1ODg5MH0.x3Ra1-m0GEx7jwv8wnz-bAt4SSG3_ZCC9zU_MwzfjA4";

/** Google Photorealistic 3D Tiles on Cesium ion. */
export const ION_GOOGLE_TILES = "2275207";
