export interface SuburbData {
  name: string;
  summary: string;
  fun_facts: string[];
  local_attractions: string[];
  name_etymology: string;
  cuisine_types: string[];
  restaurant_recommendations: { name: string; description: string; lat?: number; lng?: number }[];
  key_events: { year: string; event: string }[];
  notable_people: { name: string; role: string }[];
  heritage_sites: string[];
  demographics?: {
    data_year: string;
    data_source: string;
    population: string;
    top_ancestries: { name: string; percentage: number }[];
    top_languages: { name: string; percentage: number }[];
  } | null;
  venuesAvailable: boolean;
  image_url?: string;
  rawVenues?: { name: string; category: string; cuisine?: string; lat: number; lng: number }[];
  geo?: SuburbGeo;
  transport?: TransportSnapshot;
}

export type TransportType = "train" | "tram" | "ferry" | "bus";

export interface TransportStop {
  id: string;
  name: string;
  type: TransportType;
  lat: number;
  lng: number;
  distanceMetres?: number;
  isInsideBoundary: boolean;
  routes?: string[];
}

export interface TransitLineFeature {
  type: "Feature";
  geometry: {
    type: "LineString" | "MultiLineString";
    coordinates: number[][] | number[][][];
  };
  properties: {
    id: string;
    type: "rail" | "light_rail" | "bus";
    name?: string;
    ref?: string;
    colour?: string;
  };
}

export interface TransportSnapshot {
  summary: string;
  trainCount: number;
  tramCount: number;
  ferryCount: number;
  busCount: number;
  busRouteCount: number;
  stops: TransportStop[];
  lines?: {
    type: "FeatureCollection";
    features: TransitLineFeature[];
  };
}

export interface SuburbGeo {
  lat: number;
  lng: number;
  bbox?: [number, number, number, number];
  polygon?: {
    type: "Polygon" | "MultiPolygon";
    coordinates: any;
  };
}

export type PanelView = "suburb" | "food" | "history" | "demographics";

export interface CityMeta {
  name: string;
  state: string;
  lat: number;
  lng: number;
  zoom: number;
}

export const CITIES = [
  { name: "Sydney", state: "NSW", lat: -33.8688, lng: 151.2093, zoom: 12 },
  { name: "Melbourne", state: "VIC", lat: -37.8136, lng: 144.9631, zoom: 12 },
  { name: "Brisbane", state: "QLD", lat: -27.4698, lng: 153.0251, zoom: 12 },
  { name: "Perth", state: "WA", lat: -31.9505, lng: 115.8605, zoom: 12 },
  { name: "Adelaide", state: "SA", lat: -34.9285, lng: 138.6007, zoom: 12 },
  { name: "Canberra", state: "ACT", lat: -35.2809, lng: 149.1300, zoom: 12 },
  { name: "Hobart", state: "TAS", lat: -42.8821, lng: 147.3272, zoom: 12 },
  { name: "Darwin", state: "NT", lat: -12.4634, lng: 130.8456, zoom: 12 },
] as const;

export type CityName = (typeof CITIES)[number]["name"];

export const TABS: { id: PanelView; label: string; icon: string }[] = [
  { id: "suburb", label: "Overview", icon: "📋" },
  { id: "food", label: "Food", icon: "🍴" },
  { id: "history", label: "History", icon: "📜" },
  { id: "demographics", label: "Community", icon: "👥" },
];

export const LOADING_MESSAGES: { after: number; text: string }[] = [
  { after: 0,     text: "Hitting the pavement…" },
  { after: 2500,  text: "Checking out the local scene…" },
  { after: 5000,  text: "Digging through the council records…" },
  { after: 8000,  text: "Negotiating with the restaurant database…" },
  { after: 11500, text: "The food directory seems to have gone for lunch." },
  { after: 17000, text: "Still here. This suburb really values its privacy." },
  { after: 24000, text: "Contemplating a tree change instead…" },
];

export const COLORS_ANCESTRY = ['#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#f43f5e', '#84cc16', '#6366f1', '#d946ef', '#cbd5e1'];
export const COLORS_LANGUAGE = ['#3b82f6', '#ef4444', '#8b5cf6', '#f97316', '#14b8a6', '#eab308', '#a855f7', '#0ea5e9', '#ec4899', '#cbd5e1'];
