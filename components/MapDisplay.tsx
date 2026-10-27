"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { Map as MapLibreMap, Marker, Popup, AttributionControl, setWorkerUrl } from "maplibre-gl";
import { SuburbData, CityName, CITIES } from "../lib/types";

// Configure Web Worker path to avoid Turbopack / bundler chunking worker load failures
if (typeof window !== "undefined") {
  try {
    setWorkerUrl(`${window.location.origin}/maplibre-gl-worker.js`);
  } catch {
    setWorkerUrl("/maplibre-gl-worker.js");
  }
}

interface MapDisplayProps {
  city: CityName;
  suburb: SuburbData | null;
  pendingSuburb?: string | null;
  selectedVenue: { lat: number; lng: number; name?: string } | null;
  onVenueClick?: (venue: { lat: number; lng: number; name: string }) => void;
  onDismissVenue?: () => void;
}

type MapStyleKey = "voyager" | "positron" | "dark";

const MAP_STYLES: Record<MapStyleKey, { name: string; url: string; icon: string }> = {
  voyager: {
    name: "Detailed",
    url: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
    icon: "🗺️",
  },
  positron: {
    name: "Light",
    url: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    icon: "☀️",
  },
  dark: {
    name: "Dark",
    url: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    icon: "🌙",
  },
};

function getCategoryMeta(category?: string) {
  const cat = (category || "").toLowerCase();
  if (cat.includes("cafe") || cat.includes("café") || cat.includes("coffee")) {
    return { icon: "☕", bg: "bg-amber-500", text: "text-amber-700", ring: "ring-amber-300" };
  }
  if (cat.includes("bar") || cat.includes("pub") || cat.includes("brewery")) {
    return { icon: "🍺", bg: "bg-emerald-500", text: "text-emerald-700", ring: "ring-emerald-300" };
  }
  if (cat.includes("fast food") || cat.includes("burger") || cat.includes("pizza")) {
    return { icon: "🍟", bg: "bg-rose-500", text: "text-rose-700", ring: "ring-rose-300" };
  }
  return { icon: "🍽️", bg: "bg-indigo-600", text: "text-indigo-700", ring: "ring-indigo-300" };
}

export function MapDisplay({
  city,
  suburb,
  pendingSuburb,
  selectedVenue,
  onVenueClick,
  onDismissVenue,
}: MapDisplayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<
    {
      marker: Marker;
      lat: number;
      lng: number;
      name: string;
      popup: Popup;
      el: HTMLElement;
      category?: string;
      cuisine?: string;
      description?: string;
    }[]
  >([]);
  const suburbMarkerRef = useRef<Marker | null>(null);
  const dynamicSelectedMarkerRef = useRef<Marker | null>(null);
  const transitMarkersRef = useRef<Marker[]>([]);
  const renderedSuburbRef = useRef<{ name: string; city: string; hasTransport: boolean } | null>(null);
  const onVenueClickRef = useRef(onVenueClick);
  onVenueClickRef.current = onVenueClick;

  const [mapLoaded, setMapLoaded] = useState(false);
  const [currentStyle, setCurrentStyle] = useState<MapStyleKey>("voyager");
  const [styleReloadKey, setStyleReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);

  // Transit layer toggles (focusing purely on rail & stations)
  const [showRailLines, setShowRailLines] = useState(true);
  const [showTransitStops, setShowTransitStops] = useState(true);

  // Retrieve current city coordinate bounds
  const cityMeta = useMemo(() => {
    return CITIES.find((c) => c.name === city) || CITIES[0];
  }, [city]);

  // Handle share link copy
  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 1. Initialise the MapLibre instance
  useEffect(() => {
    if (!containerRef.current) return;

    try {
      setWorkerUrl(`${window.location.origin}/maplibre-gl-worker.js`);
    } catch {
      setWorkerUrl("/maplibre-gl-worker.js");
    }

    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLES[currentStyle].url,
      center: [cityMeta.lng, cityMeta.lat],
      zoom: cityMeta.zoom,
      pitch: 0,
      attributionControl: false,
    });

    map.addControl(new AttributionControl({ compact: true }), "bottom-left");

    map.on("load", () => {
      setMapLoaded(true);
    });

    mapRef.current = map;

    const handleResize = () => map.resize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      markersRef.current.forEach(({ marker }) => marker.remove());
      markersRef.current = [];
      if (suburbMarkerRef.current) {
        suburbMarkerRef.current.remove();
        suburbMarkerRef.current = null;
      }
      if (dynamicSelectedMarkerRef.current) {
        dynamicSelectedMarkerRef.current.remove();
        dynamicSelectedMarkerRef.current = null;
      }
      transitMarkersRef.current.forEach((m) => m.remove());
      transitMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, []);

  // 2. Change style dynamically when user clicks style toggle
  const handleStyleChange = (styleKey: MapStyleKey) => {
    if (styleKey === currentStyle || !mapRef.current) return;
    setCurrentStyle(styleKey);
    const map = mapRef.current;
    map.setStyle(MAP_STYLES[styleKey].url);
    map.once("style.load", () => {
      // Re-apply boundary and markers after style reloads
      renderedSuburbRef.current = null;
      setStyleReloadKey((prev) => prev + 1);
    });
  };

  // 3. React to city changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Fly to city centre if no suburb is currently loaded
    if (!suburb) {
      map.flyTo({
        center: [cityMeta.lng, cityMeta.lat],
        zoom: cityMeta.zoom,
        pitch: 0,
        bearing: 0,
        duration: 1600,
        essential: true,
      });
    }
  }, [city, cityMeta, mapLoaded, suburb]);

  // 4. Update suburb boundary polygon and venue pins
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Check if the suburb has actually changed to prevent boundary flashing
    const isSameSuburb =
      renderedSuburbRef.current &&
      suburb &&
      renderedSuburbRef.current.name === suburb.name &&
      renderedSuburbRef.current.city === city &&
      renderedSuburbRef.current.hasTransport === Boolean(suburb.transport);

    if (isSameSuburb) {
      return;
    }

    if (!suburb && !renderedSuburbRef.current) {
      return;
    }

    renderedSuburbRef.current = suburb
      ? { name: suburb.name, city, hasTransport: Boolean(suburb.transport) }
      : null;

    // Clear existing venue markers
    markersRef.current.forEach(({ marker }) => marker.remove());
    markersRef.current = [];

    if (suburbMarkerRef.current) {
      suburbMarkerRef.current.remove();
      suburbMarkerRef.current = null;
    }

    if (dynamicSelectedMarkerRef.current) {
      dynamicSelectedMarkerRef.current.remove();
      dynamicSelectedMarkerRef.current = null;
    }

    // Suburb boundary source & layers
    const sourceId = "suburb-boundary-source";
    const fillLayerId = "suburb-boundary-fill";
    const strokeLayerId = "suburb-boundary-stroke";

    // Transit line layers
    const transitSourceId = "transit-lines-source";
    const railCasingLayerId = "transit-rail-casing";
    const railLayerId = "transit-rail-line";
    const lightRailLayerId = "transit-lightrail-line";

    // Clean up existing boundary & transit layers if present
    if (map.getLayer(lightRailLayerId)) map.removeLayer(lightRailLayerId);
    if (map.getLayer(railLayerId)) map.removeLayer(railLayerId);
    if (map.getLayer(railCasingLayerId)) map.removeLayer(railCasingLayerId);
    if (map.getSource(transitSourceId)) map.removeSource(transitSourceId);

    transitMarkersRef.current.forEach((m) => m.remove());
    transitMarkersRef.current = [];

    if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId);
    if (map.getLayer(strokeLayerId)) map.removeLayer(strokeLayerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    if (!suburb) return;

    // Render polygon boundary if returned by OSM geocoder
    if (suburb.geo?.polygon) {
      try {
        map.addSource(sourceId, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: { name: suburb.name },
            geometry: suburb.geo.polygon,
          },
        });

        map.addLayer({
          id: fillLayerId,
          type: "fill",
          source: sourceId,
          paint: {
            "fill-color": "#6366f1",
            "fill-opacity": 0.12,
          },
        });

        map.addLayer({
          id: strokeLayerId,
          type: "line",
          source: sourceId,
          paint: {
            "line-color": "#4f46e5",
            "line-width": 2.5,
            "line-opacity": 0.85,
          },
        });
      } catch (err) {
        console.warn("[map] failed to add boundary polygon:", err);
      }
    }

    // Render transit line geometries if returned by Overpass
    if (suburb.transport?.lines?.features && suburb.transport.lines.features.length > 0) {
      try {
        map.addSource(transitSourceId, {
          type: "geojson",
          data: suburb.transport.lines as any,
        });

        // 1. Heavy Rail outer casing (for track visibility against basemaps)
        map.addLayer({
          id: railCasingLayerId,
          type: "line",
          source: transitSourceId,
          filter: ["==", ["get", "type"], "rail"],
          layout: {
            visibility: showRailLines ? "visible" : "none",
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": "#ffffff",
            "line-width": 5,
            "line-opacity": 0.6,
          },
        });

        // 2. Heavy Rail track
        map.addLayer({
          id: railLayerId,
          type: "line",
          source: transitSourceId,
          filter: ["==", ["get", "type"], "rail"],
          layout: {
            visibility: showRailLines ? "visible" : "none",
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": "#4338ca",
            "line-width": 3,
            "line-opacity": 0.9,
          },
        });

        // 3. Light Rail / Tram
        map.addLayer({
          id: lightRailLayerId,
          type: "line",
          source: transitSourceId,
          filter: ["==", ["get", "type"], "light_rail"],
          layout: {
            visibility: showRailLines ? "visible" : "none",
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": "#0891b2",
            "line-width": 2.5,
            "line-dasharray": [2, 2],
          },
        });
      } catch (err) {
        console.warn("[map] failed to add transit line layers:", err);
      }
    }

    // Compile unique venues from rawVenues & recommendations
    const venueMap = new Map<
      string,
      { name: string; category?: string; cuisine?: string; lat: number; lng: number }
    >();

    (suburb.rawVenues || []).forEach((v) => {
      if (v.lat && v.lng) {
        venueMap.set(`${v.name.toLowerCase()}-${v.lat.toFixed(4)}`, {
          name: v.name,
          category: v.category,
          cuisine: v.cuisine,
          lat: v.lat,
          lng: v.lng,
        });
      }
    });

    (suburb.restaurant_recommendations || []).forEach((r) => {
      if (r.lat && r.lng) {
        const key = `${r.name.toLowerCase()}-${r.lat.toFixed(4)}`;
        const existing = venueMap.get(key);
        venueMap.set(key, {
          name: r.name,
          category: existing?.category || "Restaurant",
          cuisine: existing?.cuisine,
          lat: r.lat,
          lng: r.lng,
        });
      }
    });

    const venueList = Array.from(venueMap.values());

    // Create custom DOM markers for all verified dining venues
    venueList.forEach((venue) => {
      const meta = getCategoryMeta(venue.category);

      const el = document.createElement("div");
      el.className = "group relative cursor-pointer flex items-center justify-center transition-transform";
      el.innerHTML = `
        <div class="marker-badge flex items-center justify-center w-8 h-8 rounded-full ${meta.bg} text-white shadow-md shadow-slate-900/20 border-2 border-white transition-all duration-300 group-hover:scale-125 group-hover:shadow-lg">
          <span class="text-xs select-none">${meta.icon}</span>
        </div>
      `;

      // Build compact modern glassmorphic popup without overlapping description
      const popupHtml = document.createElement("div");
      popupHtml.className = "p-2.5 pr-6 select-none text-slate-800";
      popupHtml.innerHTML = `
        <h4 class="font-extrabold text-sm text-slate-900 leading-tight">${venue.name}</h4>
        <div class="flex flex-wrap gap-1 mt-1.5">
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">${venue.category || "Dining"}</span>
          ${venue.cuisine ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">${venue.cuisine}</span>` : ""}
        </div>
        <div class="mt-2 pt-2 border-t border-slate-100 flex justify-end">
          <a
            href="https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-700 transition-colors"
          >
            🚗 Directions ➔
          </a>
        </div>
      `;

      const popup = new Popup({
        offset: 16,
        closeButton: true,
        closeOnClick: false,
        maxWidth: "220px",
      })
        .setLngLat([venue.lng, venue.lat])
        .setDOMContent(popupHtml);

      const marker = new Marker({ element: el })
        .setLngLat([venue.lng, venue.lat])
        .setPopup(popup)
        .addTo(map);

      el.addEventListener("click", () => {
        if (onVenueClickRef.current) {
          onVenueClickRef.current({ lat: venue.lat, lng: venue.lng, name: venue.name });
        }
      });

      markersRef.current.push({
        marker,
        lat: venue.lat,
        lng: venue.lng,
        name: venue.name,
        category: venue.category,
        cuisine: venue.cuisine,
        popup,
        el,
      });
    });

    // Suburb centre hero marker
    if (suburb.geo?.lat && suburb.geo?.lng) {
      const heroEl = document.createElement("div");
      heroEl.className = "cursor-pointer";
      heroEl.innerHTML = `
        <div class="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-full shadow-lg border-2 border-white text-xs font-black select-none transition-transform hover:scale-110">
          <span>📍</span>
          <span>${suburb.name}</span>
        </div>
      `;
      const suburbMarker = new Marker({ element: heroEl })
        .setLngLat([suburb.geo.lng, suburb.geo.lat])
        .addTo(map);
      suburbMarkerRef.current = suburbMarker;
    }

    // Transit stop markers (Train, Tram, Ferry)
    if (suburb.transport?.stops && suburb.transport.stops.length > 0) {
      suburb.transport.stops.forEach((stop) => {
        const icon = stop.type === "train" ? "🚆" : stop.type === "tram" ? "🚊" : stop.type === "ferry" ? "⛴️" : "🚌";
        const bg =
          stop.type === "train"
            ? "bg-indigo-600 ring-indigo-300"
            : stop.type === "tram"
            ? "bg-cyan-600 ring-cyan-300"
            : stop.type === "ferry"
            ? "bg-sky-500 ring-sky-300"
            : "bg-amber-600 ring-amber-300";

        const el = document.createElement("div");
        el.className = "transit-stop-marker cursor-pointer select-none group relative";
        el.style.zIndex = "40";
        if (!showTransitStops) {
          el.style.display = "none";
        }
        el.innerHTML = `
          <div class="w-8 h-8 rounded-full ${bg} text-white shadow-xl flex items-center justify-center text-sm border-2 border-white ring-2 transition-transform duration-150 group-hover:scale-125">
            ${icon}
          </div>
        `;

        const distInfo =
          !stop.isInsideBoundary && stop.distanceMetres
            ? `<span class="text-[10px] text-slate-500 block mt-0.5">Approx. ${stop.distanceMetres}m from suburb</span>`
            : `<span class="text-[10px] text-emerald-600 font-semibold block mt-0.5">Within suburb</span>`;

        const popup = new Popup({ offset: 16, closeButton: false }).setHTML(`
          <div class="p-2 text-center min-w-[130px] select-none">
            <p class="font-extrabold text-xs text-slate-900">${stop.name}</p>
            <span class="inline-block text-[10px] uppercase tracking-wider font-bold text-indigo-600 mt-0.5">${stop.type}</span>
            ${distInfo}
          </div>
        `);

        const marker = new Marker({ element: el })
          .setLngLat([stop.lng, stop.lat])
          .setPopup(popup)
          .addTo(map);

        transitMarkersRef.current.push(marker);
      });
    }

    // Smoothly fly camera to fit suburb boundary or coordinates
    if (suburb.geo?.bbox) {
      const [minLat, maxLat, minLon, maxLon] = suburb.geo.bbox;
      map.fitBounds(
        [
          [minLon, minLat],
          [maxLon, maxLat],
        ],
        {
          padding: { top: 70, bottom: 70, left: 70, right: 70 },
          maxZoom: 15,
          duration: 1600,
          essential: true,
        }
      );
    } else if (suburb.geo?.lat && suburb.geo?.lng) {
      map.flyTo({
        center: [suburb.geo.lng, suburb.geo.lat],
        zoom: 14,
        duration: 1600,
        essential: true,
      });
    } else if (venueList.length > 0) {
      const avgLat = venueList.reduce((acc, v) => acc + v.lat, 0) / venueList.length;
      const avgLng = venueList.reduce((acc, v) => acc + v.lng, 0) / venueList.length;
      map.flyTo({
        center: [avgLng, avgLat],
        zoom: 14.5,
        duration: 1600,
        essential: true,
      });
    }
  }, [suburb, city, mapLoaded, styleReloadKey]);

  // Dynamically react to transit toggles without reloading the entire map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (map.getLayer("transit-rail-casing")) {
      map.setLayoutProperty("transit-rail-casing", "visibility", showRailLines ? "visible" : "none");
    }
    if (map.getLayer("transit-rail-line")) {
      map.setLayoutProperty("transit-rail-line", "visibility", showRailLines ? "visible" : "none");
    }
    if (map.getLayer("transit-lightrail-line")) {
      map.setLayoutProperty("transit-lightrail-line", "visibility", showRailLines ? "visible" : "none");
    }

    transitMarkersRef.current.forEach((m) => {
      m.getElement().style.display = showTransitStops ? "" : "none";
    });
  }, [showRailLines, showTransitStops, mapLoaded]);

  // 5. Handle selected venue focus, pulsing beacon ring, and popup activation
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (dynamicSelectedMarkerRef.current) {
      dynamicSelectedMarkerRef.current.remove();
      dynamicSelectedMarkerRef.current = null;
    }

    if (!selectedVenue) {
      // Clear visual active rings and popups from all markers
      markersRef.current.forEach(({ el, popup }) => {
        popup.remove();
        el.style.zIndex = "1";
        const beacon = el.querySelector(".venue-beacon-ping");
        if (beacon) beacon.remove();
        const badge = el.querySelector(".marker-badge") as HTMLElement;
        if (badge) {
          badge.classList.remove("ring-4", "ring-indigo-500", "ring-offset-2", "scale-125", "shadow-xl");
        }
      });
      return;
    }

    // Smoothly fly camera to venue coordinates with slight perspective pitch
    map.flyTo({
      center: [selectedVenue.lng, selectedVenue.lat],
      zoom: 16.5,
      pitch: 20,
      duration: 1000,
      essential: true,
    });

    // Locate the single target venue marker to avoid opening multiple nearby pins
    const targetName = selectedVenue.name ? selectedVenue.name.trim().toLowerCase() : "";

    // 1. Prioritise exact name match
    let targetItem = targetName
      ? markersRef.current.find((m) => m.name.trim().toLowerCase() === targetName) || null
      : null;

    // 2. Fall back to exact coordinate match (within ~5 metres)
    if (!targetItem && selectedVenue.lat && selectedVenue.lng) {
      targetItem =
        markersRef.current.find(
          (m) =>
            Math.abs(m.lat - selectedVenue.lat) < 0.00005 &&
            Math.abs(m.lng - selectedVenue.lng) < 0.00005
        ) || null;
    }

    // 3. Fall back to single closest marker (within ~80 metres)
    if (!targetItem && selectedVenue.lat && selectedVenue.lng) {
      let minDistance = Infinity;
      let closestMarker: (typeof markersRef.current)[0] | null = null;
      for (const m of markersRef.current) {
        const dist = Math.hypot(m.lat - selectedVenue.lat, m.lng - selectedVenue.lng);
        if (dist < 0.0008 && dist < minDistance) {
          minDistance = dist;
          closestMarker = m;
        }
      }
      targetItem = closestMarker;
    }

    let foundMatch = false;

    markersRef.current.forEach((item) => {
      const isMatch = targetItem !== null && item === targetItem;

      if (isMatch) {
        foundMatch = true;
        // Anchor and open popup directly above only this pin
        item.popup.setLngLat([item.lng, item.lat]).addTo(map);

        // Bring element to the front
        item.el.style.zIndex = "999";

        // Add prominent pulsing beacon ring if not already present
        if (!item.el.querySelector(".venue-beacon-ping")) {
          const beacon = document.createElement("span");
          beacon.className =
            "venue-beacon-ping absolute -inset-3 rounded-full bg-indigo-500/50 animate-ping pointer-events-none";
          item.el.appendChild(beacon);
        }

        // Apply active scale and glowing ring to the marker badge
        const badge = item.el.querySelector(".marker-badge") as HTMLElement;
        if (badge) {
          badge.classList.add("ring-4", "ring-indigo-500", "ring-offset-2", "scale-125", "shadow-xl");
        }
      } else {
        item.popup.remove();
        item.el.style.zIndex = "1";
        const beacon = item.el.querySelector(".venue-beacon-ping");
        if (beacon) beacon.remove();
        const badge = item.el.querySelector(".marker-badge") as HTMLElement;
        if (badge) {
          badge.classList.remove("ring-4", "ring-indigo-500", "ring-offset-2", "scale-125", "shadow-xl");
        }
      }
    });

    // Fallback: If no pre-existing marker matched, dynamically drop a prominent pinpoint
    if (!foundMatch && selectedVenue.lat && selectedVenue.lng) {
      const dynamicEl = document.createElement("div");
      dynamicEl.className = "relative flex items-center justify-center cursor-pointer";
      dynamicEl.innerHTML = `
        <span class="absolute -inset-3 rounded-full bg-indigo-500/50 animate-ping pointer-events-none"></span>
        <div class="flex items-center justify-center w-9 h-9 rounded-full bg-indigo-600 text-white shadow-xl ring-4 ring-indigo-400 ring-offset-2 border-2 border-white scale-125">
          <span class="text-sm">📍</span>
        </div>
      `;

      const dynamicPopupHtml = document.createElement("div");
      dynamicPopupHtml.className = "p-2.5 pr-6 select-none text-slate-800";
      dynamicPopupHtml.innerHTML = `
        <h4 class="font-extrabold text-sm text-slate-900 leading-tight">${selectedVenue.name || "Pinned Venue"}</h4>
        <div class="mt-2 pt-2 border-t border-slate-100 flex justify-end">
          <a
            href="https://www.google.com/maps/dir/?api=1&destination=${selectedVenue.lat},${selectedVenue.lng}"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-700"
          >
            🚗 Directions ➔
          </a>
        </div>
      `;

      const dynamicPopup = new Popup({
        offset: 16,
        closeButton: true,
        closeOnClick: false,
        maxWidth: "220px",
      })
        .setLngLat([selectedVenue.lng, selectedVenue.lat])
        .setDOMContent(dynamicPopupHtml)
        .addTo(map);

      const dynamicMarker = new Marker({ element: dynamicEl })
        .setLngLat([selectedVenue.lng, selectedVenue.lat])
        .setPopup(dynamicPopup)
        .addTo(map);

      dynamicSelectedMarkerRef.current = dynamicMarker;
    }
  }, [selectedVenue, mapLoaded]);

  // Zoom controls
  const handleZoomIn = () => mapRef.current?.zoomIn({ duration: 300 });
  const handleZoomOut = () => mapRef.current?.zoomOut({ duration: 300 });
  const handleResetView = () => {
    if (!mapRef.current) return;
    if (suburb?.geo?.bbox) {
      const [minLat, maxLat, minLon, maxLon] = suburb.geo.bbox;
      mapRef.current.fitBounds(
        [
          [minLon, minLat],
          [maxLon, maxLat],
        ],
        { padding: 70, duration: 1000 }
      );
    } else if (suburb?.geo?.lat && suburb?.geo?.lng) {
      mapRef.current.flyTo({ center: [suburb.geo.lng, suburb.geo.lat], zoom: 14, pitch: 0, duration: 1000 });
    } else {
      mapRef.current.flyTo({ center: [cityMeta.lng, cityMeta.lat], zoom: cityMeta.zoom, pitch: 0, duration: 1000 });
    }
  };

  return (
    <div className="relative flex-1 w-full h-[45%] md:h-full overflow-hidden bg-slate-100">
      {/* MapLibre WebGL Canvas Container */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Top Left: Suburb / City Indicator */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2 pointer-events-none">
        <div className="pointer-events-auto px-3.5 py-1.5 rounded-full bg-white/90 backdrop-blur-md border border-white/60 shadow-md text-xs font-bold text-slate-700 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>
            {suburb ? suburb.name : pendingSuburb ? `Locating ${pendingSuburb}…` : city}
          </span>
          {suburb && (
            <span className="text-slate-400 font-medium">
              • {markersRef.current.length > 0 ? `${markersRef.current.length} venues` : `${cityMeta.state}`}
            </span>
          )}
        </div>
      </div>

      {/* Top Right: Map Style Switcher */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-1 bg-white/90 backdrop-blur-md p-1 rounded-full border border-white/60 shadow-md">
        {(Object.keys(MAP_STYLES) as MapStyleKey[]).map((key) => {
          const item = MAP_STYLES[key];
          const active = currentStyle === key;
          return (
            <button
              key={key}
              onClick={() => handleStyleChange(key)}
              title={`${item.name} basemap`}
              className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all duration-150 flex items-center gap-1 cursor-pointer ${
                active
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <span>{item.icon}</span>
              <span className="hidden sm:inline">{item.name}</span>
            </button>
          );
        })}
      </div>

      {/* Top Right: Transit Overlay Toggles (displayed when suburb has transport data) */}
      {suburb?.transport && (
        <div className="absolute top-15 right-4 z-10 flex items-center gap-1 bg-white/90 backdrop-blur-md p-1 rounded-full border border-white/60 shadow-md">
          <button
            onClick={() => setShowRailLines((prev) => !prev)}
            title="Toggle Train & Light Rail Lines"
            className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all duration-150 flex items-center gap-1 cursor-pointer ${
              showRailLines
                ? "bg-indigo-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <span>🚆</span>
            <span className="hidden sm:inline">Rail Lines</span>
          </button>
          <button
            onClick={() => setShowTransitStops((prev) => !prev)}
            title="Toggle Stations & Stops (Train, Tram, Ferry)"
            className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all duration-150 flex items-center gap-1 cursor-pointer ${
              showTransitStops
                ? "bg-emerald-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <span>📍</span>
            <span className="hidden sm:inline">Stations</span>
          </button>
        </div>
      )}

      {/* Right Middle: Modern Zoom & Reset Controls */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-1 bg-white/90 backdrop-blur-md p-1 rounded-2xl border border-white/60 shadow-lg">
        <button
          onClick={handleZoomIn}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-700 hover:bg-slate-100 font-black text-sm active:scale-95 transition-all cursor-pointer"
          title="Zoom In"
        >
          ＋
        </button>
        <button
          onClick={handleZoomOut}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-700 hover:bg-slate-100 font-black text-sm active:scale-95 transition-all cursor-pointer"
          title="Zoom Out"
        >
          －
        </button>
        <div className="h-px bg-slate-200 my-0.5" />
        <button
          onClick={handleResetView}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-600 hover:bg-slate-100 text-xs active:scale-95 transition-all cursor-pointer"
          title="Recentre Suburb"
        >
          🎯
        </button>
      </div>

      {/* Floating Active Pinned Venue Card */}
      {selectedVenue && (
        <div className="absolute bottom-5 left-4 right-4 sm:right-auto sm:max-w-xs z-20 bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-white/80 p-3.5 animate-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping shrink-0" />
              <span className="text-[10px] font-black uppercase tracking-wider text-indigo-600">
                Pinned Venue
              </span>
            </div>
            {onDismissVenue && (
              <button
                onClick={onDismissVenue}
                className="w-5 h-5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 text-xs flex items-center justify-center cursor-pointer transition-colors"
                title="Dismiss"
              >
                ✕
              </button>
            )}
          </div>
          <h4 className="font-extrabold text-sm text-slate-900 mt-1 truncate">
            {selectedVenue.name || "Selected Venue"}
          </h4>
          <div className="mt-2.5 flex items-center gap-2">
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${selectedVenue.lat},${selectedVenue.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl text-center shadow-xs transition-colors"
            >
              🚗 Directions
            </a>
            <button
              onClick={() => {
                mapRef.current?.flyTo({
                  center: [selectedVenue.lng, selectedVenue.lat],
                  zoom: 17,
                  pitch: 25,
                  duration: 600,
                });
              }}
              className="py-1.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-colors cursor-pointer"
              title="Focus Pin"
            >
              🎯 Focus
            </button>
          </div>
        </div>
      )}

      {/* Bottom Right: Floating Action Buttons (Share & Buy Me a Coffee) */}
      <div className="absolute bottom-5 right-5 z-10 flex flex-col gap-2.5 items-end pointer-events-none">
        <button
          onClick={handleShare}
          className="pointer-events-auto flex items-center gap-2 px-4 py-2 bg-white/95 backdrop-blur-md text-slate-700 font-bold text-xs rounded-full shadow-lg border border-white/60 hover:bg-white hover:text-indigo-600 transition-all active:scale-95 cursor-pointer"
        >
          <span>{copied ? "✅ Copied Link!" : "📤 Share Suburb"}</span>
        </button>

        <a
          href="https://buymeacoffee.com/sunnymug"
          target="_blank"
          rel="noopener noreferrer"
          className="pointer-events-auto flex items-center gap-1.5 px-3.5 py-1.5 bg-[#FFDD00] text-black font-extrabold text-xs rounded-full shadow-lg border border-yellow-400 hover:bg-[#FFEA00] transition-all active:scale-95 cursor-pointer"
        >
          <span>☕ Buy me a coffee</span>
        </a>
      </div>
    </div>
  );
}
