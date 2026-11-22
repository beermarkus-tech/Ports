// Types shared by the world map (map-gl.ts) and the view that feeds it (main.ts).

export type LonLat = [number, number];

export interface PortMarker {
  id: string;
  name: string;
  fuelPrice: number;
  /** Visual role, drives styling. */
  role: 'here' | 'dest' | 'cargo' | 'via' | 'normal';
  /** World events at this port. */
  strike?: boolean;
  boom?: boolean;
}

export interface ShipMarker {
  id: number;
  name: string;
  at: LonLat;
  angle: number;
  /** Screen offset, to fan out several ships in one port. */
  offset?: [number, number];
  state: 'sea' | 'ready' | 'busy';
  selected: boolean;
  /** Ship family (drives colour) and its top-down icon. */
  family: string;
  icon: { hull: string; deck: string; length: number };
  /** Points behind the ship, for its wake. */
  wake?: LonLat[];
}

export interface WeatherCell {
  id: string;
  kind: 'cloud' | 'storm';
  at: LonLat;
  scale: number;
  opacity: number;
  /** Stable 0..1 number that shapes the puffs. */
  seed: number;
}
