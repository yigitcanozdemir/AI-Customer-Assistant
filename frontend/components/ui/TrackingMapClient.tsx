"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

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

interface TrackingMapClientProps {
  currentLocation?: {
    lat: number;
    lng: number;
    city: string;
    region: string;
    country: string;
  } | null;
  deliveryCoords: { lat: number; lng: number } | null;
  deliveryAddress?: {
    city: string;
    state: string;
    country: string;
    full_name: string;
    address_line1?: string;
    address_line2?: string;
    postal_code?: string;
  } | null;
}

const PORTS = {
  NEW_YORK: { coords: [40.6925, -74.0446], name: "New York Port" },
  BALTIMORE: { coords: [39.2654, -76.5783], name: "Baltimore" },
  MIAMI: { coords: [25.7739, -80.1869], name: "Miami Port" },

  LOS_ANGELES: { coords: [33.7405, -118.2713], name: "Los Angeles" },
  SEATTLE: { coords: [47.6176, -122.3509], name: "Seattle" },

  ROTTERDAM: { coords: [51.9225, 4.4792], name: "Rotterdam" },
  HAMBURG: { coords: [53.5511, 9.9937], name: "Hamburg" },
  LE_HAVRE: { coords: [49.4944, 0.1079], name: "Le Havre" },
  FELIXSTOWE: { coords: [51.9543, 1.2963], name: "Felixstowe" },

  BARCELONA: { coords: [41.3208, 2.0406], name: "Barcelona" },
  PIRAEUS: { coords: [37.9386, 23.6375], name: "Piraeus" },
  ISTANBUL: { coords: [41.0201, 28.9869], name: "Istanbul" },
  IZMIR: { coords: [38.4189, 27.1287], name: "Izmir" },

  DUBAI: { coords: [25.2048, 55.2708], name: "Dubai" },
  SINGAPORE: { coords: [1.2897, 103.8501], name: "Singapore" },
  HONG_KONG: { coords: [22.302, 114.1724], name: "Hong Kong" },

  GIBRALTAR: { coords: [36.1408, -5.3536], name: "Gibraltar" },
  SUEZ_NORTH: { coords: [31.2653, 32.3019], name: "Suez (North)" },
  SUEZ_SOUTH: { coords: [29.9668, 32.5498], name: "Suez (South)" },
  AZORES: { coords: [38.6613, -27.2208], name: "Azores" },
  BERMUDA: { coords: [32.2949, -64.7813], name: "Bermuda" },
};

type Port = (typeof PORTS)[keyof typeof PORTS];

function getRegion(lat: number, lng: number): string {
  if (lat > 30 && lat < 60 && lng > -130 && lng < -110) return "NA_WEST";
  if (lat > 25 && lat < 50 && lng > -85 && lng < -65) return "NA_EAST";
  if (lat > 35 && lat < 70 && lng > -10 && lng < 40) return "EUROPE";
  if (lat > 10 && lat < 40 && lng > 25 && lng < 45) return "TURKEY_ME";
  if (lat > 10 && lat < 40 && lng > 45 && lng < 65) return "MIDDLE_EAST";
  if (lat > -10 && lat < 50 && lng > 95 && lng < 145) return "ASIA";
  return "OTHER";
}

function findNearestPort(lat: number, lng: number, region: string): Port {
  const portsByRegion: Record<string, Port[]> = {
    NA_WEST: [PORTS.LOS_ANGELES, PORTS.SEATTLE],
    NA_EAST: [PORTS.NEW_YORK, PORTS.BALTIMORE, PORTS.MIAMI],
    EUROPE: [PORTS.ROTTERDAM, PORTS.HAMBURG, PORTS.LE_HAVRE, PORTS.FELIXSTOWE],
    TURKEY_ME: [PORTS.ISTANBUL, PORTS.IZMIR, PORTS.PIRAEUS],
    MIDDLE_EAST: [PORTS.DUBAI],
    ASIA: [PORTS.SINGAPORE, PORTS.HONG_KONG],
  };

  const ports = portsByRegion[region] || [PORTS.ROTTERDAM];
  let nearest = ports[0];
  let minDist = Infinity;

  for (const port of ports) {
    const dist = Math.sqrt(
      Math.pow(port.coords[0] - lat, 2) + Math.pow(port.coords[1] - lng, 2)
    );
    if (dist < minDist) {
      minDist = dist;
      nearest = port;
    }
  }

  return nearest;
}

function getShippingRoute(
  startRegion: string,
  endRegion: string,
  originPort: Port,
  destPort: Port
): Port[] {
  const route: Port[] = [originPort];

  if (
    (startRegion.startsWith("NA_") && endRegion === "EUROPE") ||
    (startRegion === "EUROPE" && endRegion.startsWith("NA_"))
  ) {
    if (startRegion === "EUROPE") {
      route.push(PORTS.AZORES);
      route.push(PORTS.BERMUDA);
    } else {
      route.push(PORTS.BERMUDA);
      route.push(PORTS.AZORES);
    }
  } else if (
    (startRegion === "EUROPE" &&
      (endRegion === "TURKEY_ME" ||
        endRegion === "MIDDLE_EAST" ||
        endRegion === "ASIA")) ||
    ((startRegion === "TURKEY_ME" ||
      startRegion === "MIDDLE_EAST" ||
      startRegion === "ASIA") &&
      endRegion === "EUROPE")
  ) {
    if (startRegion === "EUROPE") {
      route.push(PORTS.GIBRALTAR);
      route.push(PORTS.SUEZ_NORTH);
      route.push(PORTS.SUEZ_SOUTH);
      if (endRegion === "ASIA" || endRegion === "MIDDLE_EAST") {
        route.push(PORTS.DUBAI);
      }
      if (endRegion === "ASIA") {
        route.push(PORTS.SINGAPORE);
      }
    } else {
      if (startRegion === "ASIA") {
        route.push(PORTS.SINGAPORE);
      }
      if (startRegion === "ASIA" || startRegion === "MIDDLE_EAST") {
        route.push(PORTS.DUBAI);
      }
      route.push(PORTS.SUEZ_SOUTH);
      route.push(PORTS.SUEZ_NORTH);
      route.push(PORTS.GIBRALTAR);
    }
  } else if (
    (startRegion.startsWith("NA_") && endRegion === "ASIA") ||
    (startRegion === "ASIA" && endRegion.startsWith("NA_"))
  ) {
  }

  route.push(destPort);

  return route;
}

async function fetchRoadRoute(
  start: [number, number],
  end: [number, number]
): Promise<[number, number][] | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.code === "Ok" && data.routes && data.routes[0]) {
      return data.routes[0].geometry.coordinates.map((c: number[]) => [
        c[1],
        c[0],
      ]);
    }
    return null;
  } catch {
    return null;
  }
}

function generateGreatCircle(
  start: [number, number],
  end: [number, number],
  steps = 50
): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const lat = start[0] + ((end[0] - start[0]) * i) / steps;
    const lng = start[1] + ((end[1] - start[1]) * i) / steps;
    points.push([lat, lng]);
  }
  return points;
}

export default function TrackingMapClient({
  currentLocation,
  deliveryCoords,
  deliveryAddress,
}: TrackingMapClientProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const hasCurrentLocation =
      currentLocation && currentLocation.lat && currentLocation.lng;
    const hasDeliveryLocation = deliveryCoords;
    if (!hasCurrentLocation && !hasDeliveryLocation) return;

    let isMounted = true;

    let center: [number, number];
    let zoom: number;
    if (hasCurrentLocation && hasDeliveryLocation) {
      center = [
        (currentLocation.lat + deliveryCoords.lat) / 2,
        (currentLocation.lng + deliveryCoords.lng) / 2,
      ];
      zoom = 4;
    } else if (hasCurrentLocation) {
      center = [currentLocation.lat, currentLocation.lng];
      zoom = 10;
    } else {
      center = [deliveryCoords!.lat, deliveryCoords!.lng];
      zoom = 10;
    }

    const map = L.map(mapRef.current, {
      center,
      zoom,
      scrollWheelZoom: true,
      zoomControl: true,
    });
    mapInstanceRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    const currentIcon = L.divIcon({
      html: `
        <div style="position: relative;">
          <div style="position: absolute; top: -20px; left: -15px; width: 30px; height: 30px; background: #3b82f6; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
              <rect x="1" y="3" width="15" height="13"></rect>
              <path d="M16 8h5l3 3v5h-2"></path>
              <circle cx="5.5" cy="18.5" r="2.5"></circle>
              <circle cx="18.5" cy="18.5" r="2.5"></circle>
            </svg>
          </div>
          <div style="position: absolute; top: 12px; left: -20px; background: #3b82f6; color: white; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: bold; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">Current</div>
        </div>
      `,
      className: "",
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });

    const deliveryIcon = L.divIcon({
      html: `
        <div style="position: relative;">
          <div style="position: absolute; top: -20px; left: -15px; width: 30px; height: 30px; background: #22c55e; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3" fill="#22c55e"></circle>
            </svg>
          </div>
          <div style="position: absolute; top: 12px; left: -22px; background: #22c55e; color: white; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: bold; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">Delivery</div>
        </div>
      `,
      className: "",
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });

    if (hasCurrentLocation)
      L.marker([currentLocation.lat, currentLocation.lng], {
        icon: currentIcon,
      })
        .addTo(map)
        .bindPopup(
          `<strong>Current</strong><br/>${currentLocation.city}, ${currentLocation.country}`
        );
    if (hasDeliveryLocation)
      L.marker([deliveryCoords.lat, deliveryCoords.lng], { icon: deliveryIcon })
        .addTo(map)
        .bindPopup(
          `<strong>Delivery</strong><br/>${deliveryAddress?.city}, ${deliveryAddress?.country}`
        );

    if (hasCurrentLocation && hasDeliveryLocation) {
      const start: [number, number] = [
        currentLocation.lat,
        currentLocation.lng,
      ];
      const end: [number, number] = [deliveryCoords.lat, deliveryCoords.lng];
      const startRegion = getRegion(start[0], start[1]);
      const endRegion = getRegion(end[0], end[1]);

      const needsOcean =
        (startRegion.startsWith("NA_") &&
          ["EUROPE", "TURKEY_ME", "MIDDLE_EAST", "ASIA"].includes(endRegion)) ||
        (["EUROPE", "TURKEY_ME"].includes(startRegion) &&
          endRegion.startsWith("NA_")) ||
        (startRegion === "EUROPE" &&
          ["MIDDLE_EAST", "ASIA"].includes(endRegion)) ||
        (["MIDDLE_EAST", "ASIA"].includes(startRegion) &&
          endRegion === "EUROPE");

      if (needsOcean) {
        const originPort = findNearestPort(start[0], start[1], startRegion);
        const destPort = findNearestPort(end[0], end[1], endRegion);
        const shippingRoute = getShippingRoute(
          startRegion,
          endRegion,
          originPort,
          destPort
        );

        fetchRoadRoute(start, originPort.coords as [number, number]).then(
          (road) => {
            if (!isMounted || !mapInstanceRef.current) return;
            if (road)
              L.polyline(road, {
                color: "#2563eb",
                weight: 5,
                opacity: 0.9,
                lineJoin: "round",
              }).addTo(map);
          }
        );

        for (let i = 0; i < shippingRoute.length - 1; i++) {
          const portA = shippingRoute[i];
          const portB = shippingRoute[i + 1];
          const seaLine = generateGreatCircle(
            portA.coords as [number, number],
            portB.coords as [number, number],
            100
          );
          L.polyline(seaLine, {
            color: "#0ea5e9",
            weight: 4,
            opacity: 0.7,
            dashArray: "0",
            lineJoin: "round",
          }).addTo(map);
          L.circleMarker(portA.coords as [number, number], {
            radius: 4,
            color: "#0ea5e9",
            fillColor: "#fff",
            fillOpacity: 1,
            weight: 2,
          })
            .bindPopup(`⚓ ${portA.name}`)
            .addTo(map);
        }

        const lastPort = shippingRoute[shippingRoute.length - 1];
        L.circleMarker(lastPort.coords as [number, number], {
          radius: 4,
          color: "#0ea5e9",
          fillColor: "#fff",
          fillOpacity: 1,
          weight: 2,
        })
          .bindPopup(`⚓ ${lastPort.name}`)
          .addTo(map);

        fetchRoadRoute(destPort.coords as [number, number], end).then(
          (road) => {
            if (!isMounted || !mapInstanceRef.current) return;
            if (road)
              L.polyline(road, {
                color: "#2563eb",
                weight: 5,
                opacity: 0.9,
                lineJoin: "round",
              }).addTo(map);
          }
        );
      } else {
        fetchRoadRoute(start, end).then((road) => {
          if (!isMounted || !mapInstanceRef.current) return;
          if (road)
            L.polyline(road, {
              color: "#3b82f6",
              weight: 3,
              opacity: 0.7,
              dashArray: "10,10",
            }).addTo(map);
        });
      }

      map.fitBounds(L.latLngBounds(start, end), { padding: [50, 50] });
    }

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [currentLocation, deliveryCoords, deliveryAddress]);

  return (
    <div className="relative w-full h-48 rounded-lg overflow-visible border border-border/50">
      <div ref={mapRef} className="w-full h-full rounded-lg" />
    </div>
  );
}
