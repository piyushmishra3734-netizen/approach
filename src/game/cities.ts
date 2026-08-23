const DEG = Math.PI / 180;

export type CityId = "sf" | "nyc" | "london" | "tokyo";

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
  /**
   * Where the car starts. The flight spawn is a kilometre out over water, which
   * is no use to a road vehicle, so driving gets its own point on a real
   * street. `height` only has to be near enough that the camera starts among
   * the buildings and the tiles refine — the wheel probes settle the car onto
   * the actual surface within a second or two.
   */
  drive: { lat: number; lon: number; az: number; height: number };
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
    // The Embarcadero, running north up the waterfront — wide, open, and the
    // skyline stays on your left the whole way.
    drive: { lat: 37.7955 * DEG, lon: -122.3925 * DEG, az: 325 * DEG, height: -28 },
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
    // West Side Highway along the Hudson, running downtown with the water on
    // your right and Midtown on your left.
    drive: { lat: 40.7605 * DEG, lon: -74.0035 * DEG, az: 197 * DEG, height: -25 },
  },
  london: {
    id: "london",
    name: "London",
    // Over the Thames at Waterloo, looking upriver to Westminster.
    lat: 51.5045 * DEG,
    lon: -0.1195 * DEG,
    height: 300,
    az: 250 * DEG,
    el: -0.03,
    hint: "Thames into Westminster",
    // Westminster Bridge Road, pointing at Parliament.
    drive: { lat: 51.5008 * DEG, lon: -0.1178 * DEG, az: 285 * DEG, height: 51 },
  },
  tokyo: {
    id: "tokyo",
    name: "Tokyo",
    // Above Shibuya, inbound over the crossing.
    lat: 35.6555 * DEG,
    lon: 139.7035 * DEG,
    height: 320,
    az: 20 * DEG,
    el: -0.03,
    hint: "Shibuya after dark",
    // Aoyama-dori, the wide route running west into the Shibuya scramble.
    drive: { lat: 35.6595 * DEG, lon: 139.7060 * DEG, az: 115 * DEG, height: 66 },
  },
};

export const CITY_ORDER: CityId[] = ["sf", "nyc", "london", "tokyo"];

/** CesiumJS evaluation token — public, expires 1 Oct 2026. */
export const ION_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJkYjZkM2MyOS1mODRiLTRlMGQtYTYzMy0xNWYyYmNiZjE1NGUiLCJpZCI6MjU5LCJzdWIiOiJDZXNpdW1KUyIsImlzcyI6Imh0dHBzOi8vYXBpLmNlc2l1bS5jb20iLCJhdWQiOiIxLjE0NCBSZWxlYXNlIC0gRGVsZXRlIG9uIE9jdG9iZXIgMSwgMjAyNiIsImlhdCI6MTc4NDk1ODg5MH0.x3Ra1-m0GEx7jwv8wnz-bAt4SSG3_ZCC9zU_MwzfjA4";

/** Google Photorealistic 3D Tiles on Cesium ion. */
export const ION_GOOGLE_TILES = "2275207";
