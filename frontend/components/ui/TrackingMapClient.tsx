"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getFlightRoute } from "./airports";

if (typeof window !== "undefined") {
  const DefaultIcon = L.Icon.Default.prototype as L.Icon.Default & {
    _getIconUrl?: () => string;
  };
  delete DefaultIcon._getIconUrl;

  L.Icon.Default.mergeOptions({
    iconRetinaUrl:
      "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
    iconUrl:
      "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
    shadowUrl:
      "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
  });
}

type LatLng = { lat: number; lng: number };

interface TrackingMapClientProps {
  currentLocation?: (LatLng & {
    city: string;
    region: string;
    country: string;
  }) | null;
  deliveryCoords: LatLng | null;
  deliveryAddress?: {
    city: string;
    state: string;
    country: string;
    full_name: string;
    address_line1?: string;
    address_line2?: string;
    postal_code?: string;
  } | null;
  isReturnRoute?: boolean;
}

/* -------------------------------------------------------------------------
   Geometry helpers (pure — no Leaflet, no side effects)
   ---------------------------------------------------------------------- */

function normalizeLng(lng: number): number {
  while (lng > 180) lng -= 360;
  while (lng < -180) lng += 360;
  return lng;
}

/** Great-circle-ish arc between two airports, bowed for a flight-path look. */
function createFlightPath(
  start: [number, number],
  end: [number, number],
  steps = 100
): [number, number][] {
  const points: [number, number][] = [];

  const [endLat, endLngRaw] = end;
  let endLng = endLngRaw;
  const diff = endLng - start[1];
  if (diff > 180) endLng -= 360;
  else if (diff < -180) endLng += 360;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lat = start[0] + (endLat - start[0]) * t;
    const lng = start[1] + (endLng - start[1]) * t;
    const arc = Math.sin(t * Math.PI) * 3;
    points.push([lat + arc, lng]);
  }

  return points;
}

function needsAirFreight(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): boolean {
  return getFlightRoute(startLat, startLng, endLat, endLng).length > 0;
}

/** Remove antimeridian jumps so a polyline doesn't streak across the world. */
function unwrapCoordinates(points: [number, number][]): [number, number][] {
  if (!points || points.length === 0) return [];

  const unwrapped: [number, number][] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const [, prevLng] = unwrapped[i - 1];
    const [currLat, currLngRaw] = points[i];
    let currLng = currLngRaw;

    const diff = currLng - prevLng;
    if (diff > 180) currLng -= 360;
    else if (diff < -180) currLng += 360;

    unwrapped.push([currLat, currLng]);
  }

  return unwrapped;
}

async function fetchRoadRoute(
  start: [number, number],
  end: [number, number],
  signal?: AbortSignal
): Promise<[number, number][] | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;
    const response = await fetch(url, { signal });
    const data = await response.json();
    if (data.code === "Ok" && data.routes?.[0]) {
      return data.routes[0].geometry.coordinates.map((c: number[]) => [
        c[1],
        c[0],
      ]);
    }
    return null;
  } catch {
    // Includes AbortError — the caller is gone, so there is nothing to report.
    return null;
  }
}

/* -------------------------------------------------------------------------
   Layer builders — every one takes the target group, never the map itself,
   so a stale async callback can only ever draw into a detached group.
   ---------------------------------------------------------------------- */

/** World copies at ±360° keep markers visible when panning past the seam. */
const WORLD_COPIES = [-360, 0, 360];

function addMarkerCopies(
  group: L.LayerGroup,
  lat: number,
  lng: number,
  icon: L.DivIcon,
  popupContent: string
) {
  const normalizedLng = normalizeLng(lng);
  for (const offset of WORLD_COPIES) {
    L.marker([lat, normalizedLng + offset], { icon })
      .bindPopup(popupContent)
      .addTo(group);
  }
}

function addCircleMarkerCopies(
  group: L.LayerGroup,
  lat: number,
  lng: number,
  popupContent: string
) {
  const normalizedLng = normalizeLng(lng);
  for (const offset of WORLD_COPIES) {
    L.circleMarker([lat, normalizedLng + offset], {
      radius: 4,
      color: "#0891b2",
      fillColor: "#fff",
      fillOpacity: 1,
      weight: 2,
    })
      .bindPopup(popupContent)
      .addTo(group);
  }
}

function addPolylineCopies(
  group: L.LayerGroup,
  points: [number, number][],
  options: L.PolylineOptions
) {
  for (const offset of WORLD_COPIES) {
    const shifted = points.map(([lat, lng]): [number, number] => [
      lat,
      lng + offset,
    ]);
    L.polyline(shifted, options).addTo(group);
  }
}

/** Road routes are drawn twice: a wide casing under a narrower core. */
const ROAD_CASING: L.PolylineOptions = {
  color: "#1a73e8",
  weight: 6,
  opacity: 1,
  lineCap: "round",
  lineJoin: "round",
};
const ROAD_CORE: L.PolylineOptions = {
  color: "#4285f4",
  weight: 4,
  opacity: 1,
  lineCap: "round",
  lineJoin: "round",
};

function addRoadRoute(group: L.LayerGroup, road: [number, number][]) {
  const unwrapped = unwrapCoordinates(road);
  addPolylineCopies(group, unwrapped, ROAD_CASING);
  addPolylineCopies(group, unwrapped, ROAD_CORE);
}

function buildIcon(
  background: string,
  label: string,
  svg: string,
  labelOffset: number
): L.DivIcon {
  return L.divIcon({
    html: `
      <div style="position: relative;">
        <div style="position: absolute; top: -20px; left: -15px; width: 30px; height: 30px; background: ${background}; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
          ${svg}
        </div>
        <div style="position: absolute; top: 12px; left: ${labelOffset}px; background: ${background}; color: white; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: bold; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">${label}</div>
      </div>
    `,
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 20],
  });
}

const CURRENT_ICON_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
    <rect x="1" y="3" width="15" height="13"></rect>
    <path d="M16 8h5l3 3v5h-2"></path>
    <circle cx="5.5" cy="18.5" r="2.5"></circle>
    <circle cx="18.5" cy="18.5" r="2.5"></circle>
  </svg>`;

const DELIVERY_ICON_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
    <circle cx="12" cy="10" r="3" fill="#34a853"></circle>
  </svg>`;

/** Zoom that comfortably frames two points this far apart (in degrees). */
function zoomForSpread(maxDiff: number): number {
  if (maxDiff < 1) return 8;
  if (maxDiff < 5) return 6;
  if (maxDiff < 15) return 5;
  if (maxDiff < 40) return 4;
  return 3;
}

/* -------------------------------------------------------------------------
   Component
   ---------------------------------------------------------------------- */

export default function TrackingMapClient({
  currentLocation,
  deliveryCoords,
  deliveryAddress,
  isReturnRoute = false,
}: TrackingMapClientProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  // All markers and routes live here. Redrawing clears this group instead of
  // destroying the map, which is what makes the map instance stable.
  const layersRef = useRef<L.LayerGroup | null>(null);

  // On a return the parcel travels customer → warehouse, so the two endpoints
  // swap. Resolved once here rather than re-branching at every use site.
  const { origin, destination, originPopup, destinationPopup } = useMemo(() => {
    const live =
      currentLocation && currentLocation.lat && currentLocation.lng
        ? { lat: currentLocation.lat, lng: currentLocation.lng }
        : null;

    const from = isReturnRoute ? deliveryCoords ?? live : live;
    const to = isReturnRoute ? (deliveryCoords ? live : null) : deliveryCoords;

    const fromCity = isReturnRoute
      ? deliveryAddress?.city || deliveryAddress?.state || "Customer"
      : currentLocation?.city || "Transit hub";
    const fromCountry = isReturnRoute
      ? deliveryAddress?.country || ""
      : currentLocation?.country || "";
    const toCity = isReturnRoute
      ? currentLocation?.city || "Warehouse"
      : deliveryAddress?.city || deliveryAddress?.state || "";
    const toCountry = isReturnRoute
      ? currentLocation?.country || ""
      : deliveryAddress?.country || "";

    return {
      origin: from,
      destination: to,
      originPopup: `<strong>Current</strong><br/>${fromCity}, ${fromCountry}`,
      destinationPopup: `<strong>Delivery</strong><br/>${toCity}, ${toCountry}`,
    };
    // Depend on the primitive values, not the object identities: the parent
    // rebuilds these props on every render, so object deps would recompute the
    // memo each time and drive the redraw effect below into a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentLocation?.lat,
    currentLocation?.lng,
    currentLocation?.city,
    currentLocation?.country,
    deliveryCoords?.lat,
    deliveryCoords?.lng,
    deliveryAddress?.city,
    deliveryAddress?.state,
    deliveryAddress?.country,
    isReturnRoute,
  ]);

  // 1. Create the map exactly once, and destroy it only on unmount.
  //
  //    The previous version rebuilt the whole map inside the data effect, so
  //    any prop change removed the instance while in-flight route fetches were
  //    still holding a reference to it. Those callbacks then added layers to a
  //    map whose container was already detached, which is what produced
  //    "Cannot read properties of undefined (reading '_leaflet_pos')".
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [20, 0],
      zoom: 2,
      scrollWheelZoom: true,
      zoomControl: true,
      minZoom: 2,
      maxZoom: 18,
      worldCopyJump: true,
    });

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 20,
      }
    ).addTo(map);

    layersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // The map is often mounted inside a collapsed/animating chat panel, so it
    // measures 0px and renders grey tiles until told to re-measure.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, []);

  // 2. Redraw contents whenever the data changes. The map instance survives.
  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;

    layers.clearLayers();

    if (!origin && !destination) return;

    // Aborts in-flight OSRM requests from a previous render; combined with the
    // `layers` capture below, a late response can never touch the live map.
    const controller = new AbortController();
    // Captured deliberately: if this effect re-runs, `layersRef.current` is the
    // same group but has been cleared, so drawing into `layers` after the guard
    // is a no-op rather than a crash or a ghost route.
    const isStale = () =>
      controller.signal.aborted || layersRef.current !== layers;

    if (origin) {
      addMarkerCopies(
        layers,
        origin.lat,
        origin.lng,
        buildIcon("#4285f4", "Current", CURRENT_ICON_SVG, -20),
        originPopup
      );
    }
    if (destination) {
      addMarkerCopies(
        layers,
        destination.lat,
        destination.lng,
        buildIcon("#34a853", "Delivery", DELIVERY_ICON_SVG, -22),
        destinationPopup
      );
    }

    // A single endpoint: centre on it, nothing to route.
    if (!origin || !destination) {
      const only = (origin ?? destination)!;
      map.setView([only.lat, normalizeLng(only.lng)], 10);
      return;
    }

    const start: [number, number] = [origin.lat, normalizeLng(origin.lng)];
    const end: [number, number] = [
      destination.lat,
      normalizeLng(destination.lng),
    ];
    const routePoints: [number, number][] = [start, end];

    if (needsAirFreight(start[0], start[1], end[0], end[1])) {
      const flightRoute = getFlightRoute(start[0], start[1], end[0], end[1]);
      const originAirport = flightRoute[0];
      const destAirport = flightRoute[flightRoute.length - 1];

      for (const airport of flightRoute) {
        routePoints.push([airport.lat, normalizeLng(airport.lng)]);
      }

      // Every airport hop, plus the arcs between them.
      for (let i = 0; i < flightRoute.length; i++) {
        const airport = flightRoute[i];
        addCircleMarkerCopies(
          layers,
          airport.lat,
          airport.lng,
          `✈️ ${airport.name} (${airport.code})`
        );

        const next = flightRoute[i + 1];
        if (next) {
          addPolylineCopies(
            layers,
            createFlightPath(
              [airport.lat, normalizeLng(airport.lng)],
              [next.lat, normalizeLng(next.lng)],
              100
            ),
            {
              color: "#0891b2",
              weight: 3,
              opacity: 0.85,
              lineCap: "round",
              lineJoin: "round",
            }
          );
        }
      }

      // Road legs at each end: pickup → departure airport, arrival → doorstep.
      void fetchRoadRoute(
        start,
        [originAirport.lat, normalizeLng(originAirport.lng)],
        controller.signal
      ).then((road) => {
        if (road && !isStale()) addRoadRoute(layers, road);
      });

      void fetchRoadRoute(
        [destAirport.lat, normalizeLng(destAirport.lng)],
        end,
        controller.signal
      ).then((road) => {
        if (road && !isStale()) addRoadRoute(layers, road);
      });
    } else {
      void fetchRoadRoute(start, end, controller.signal).then((road) => {
        if (road && !isStale()) addRoadRoute(layers, road);
      });
    }

    if (routePoints.length >= 2) {
      map.fitBounds(L.latLngBounds(routePoints), {
        padding: [50, 50],
        maxZoom: 10,
      });
    } else {
      const spread = Math.max(
        Math.abs(start[0] - end[0]),
        Math.abs(start[1] - end[1])
      );
      map.setView(
        [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
        zoomForSpread(spread)
      );
    }

    return () => {
      controller.abort();
    };
  }, [origin, destination, originPopup, destinationPopup]);

  return (
    <div className="relative w-full h-48 rounded-lg overflow-visible border border-border/50">
      <div ref={containerRef} className="w-full h-full rounded-lg" />
    </div>
  );
}
