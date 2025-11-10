"use client";

import { useEffect, useRef } from "react";
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

function createFlightPath(
  start: [number, number],
  end: [number, number],
  steps = 100
): [number, number][] {
  const points: [number, number][] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;

    const lat = start[0] + (end[0] - start[0]) * t;
    const lng = start[1] + (end[1] - start[1]) * t;

    const arc = Math.sin(t * Math.PI) * 3;

    points.push([lat + arc, lng]);
  }

  return points;
}

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
function needsAirFreight(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): boolean {
  const distance = distanceKm(startLat, startLng, endLat, endLng);
  return distance > 600;
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

      const latDiff = Math.abs(currentLocation.lat - deliveryCoords.lat);
      const lngDiff = Math.abs(currentLocation.lng - deliveryCoords.lng);
      const maxDiff = Math.max(latDiff, lngDiff);

      if (maxDiff < 1) zoom = 8;
      else if (maxDiff < 5) zoom = 6;
      else if (maxDiff < 15) zoom = 5;
      else if (maxDiff < 40) zoom = 4;
      else zoom = 3;
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
      minZoom: 2,
      maxZoom: 18,
    });
    mapInstanceRef.current = map;

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 20,
      }
    ).addTo(map);

    const currentIcon = L.divIcon({
      html: `
        <div style="position: relative;">
          <div style="position: absolute; top: -20px; left: -15px; width: 30px; height: 30px; background: #4285f4; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
              <rect x="1" y="3" width="15" height="13"></rect>
              <path d="M16 8h5l3 3v5h-2"></path>
              <circle cx="5.5" cy="18.5" r="2.5"></circle>
              <circle cx="18.5" cy="18.5" r="2.5"></circle>
            </svg>
          </div>
          <div style="position: absolute; top: 12px; left: -20px; background: #4285f4; color: white; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: bold; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">Current</div>
        </div>
      `,
      className: "",
      iconSize: [30, 30],
      iconAnchor: [15, 20],
    });

    const deliveryIcon = L.divIcon({
      html: `
        <div style="position: relative;">
          <div style="position: absolute; top: -20px; left: -15px; width: 30px; height: 30px; background: #34a853; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3" fill="#34a853"></circle>
            </svg>
          </div>
          <div style="position: absolute; top: 12px; left: -22px; background: #34a853; color: white; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: bold; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">Delivery</div>
        </div>
      `,
      className: "",
      iconSize: [30, 30],
      iconAnchor: [15, 20],
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

      const usesAir = needsAirFreight(start[0], start[1], end[0], end[1]);

      if (usesAir) {
        console.log("✈️ Using air freight routing");

        const flightRoute = getFlightRoute(start[0], start[1], end[0], end[1]);

        console.log(
          `✈️ Flight route: ${flightRoute.map((a) => a.code).join(" → ")}`
        );

        const originAirport = flightRoute[0];
        const destAirport = flightRoute[flightRoute.length - 1];

        fetchRoadRoute(start, [originAirport.lat, originAirport.lng]).then(
          (road) => {
            if (!isMounted || !mapInstanceRef.current) return;
            if (road) {
              L.polyline(road, {
                color: "#1a73e8",
                weight: 6,
                opacity: 1,
                lineCap: "round",
                lineJoin: "round",
              }).addTo(map);

              L.polyline(road, {
                color: "#4285f4",
                weight: 4,
                opacity: 1,
                lineCap: "round",
                lineJoin: "round",
              }).addTo(map);

              console.log(`🚗 Ground to ${originAirport.code}`);
            }
          }
        );

        for (let i = 0; i < flightRoute.length - 1; i++) {
          const airportA = flightRoute[i];
          const airportB = flightRoute[i + 1];

          L.circleMarker([airportA.lat, airportA.lng], {
            radius: 4,
            color: "#0891b2",
            fillColor: "#fff",
            fillOpacity: 1,
            weight: 2,
          })
            .bindPopup(`✈️ ${airportA.name} (${airportA.code})`)
            .addTo(map);

          const flightPath = createFlightPath(
            [airportA.lat, airportA.lng],
            [airportB.lat, airportB.lng],
            100
          );

          L.polyline(flightPath, {
            color: "#0891b2",
            weight: 3,
            opacity: 0.85,
            lineCap: "round",
            lineJoin: "round",
          }).addTo(map);

          console.log(`✈️ Flight: ${airportA.code} → ${airportB.code}`);
        }

        const lastAirport = flightRoute[flightRoute.length - 1];
        L.circleMarker([lastAirport.lat, lastAirport.lng], {
          radius: 4,
          color: "#0891b2",
          fillColor: "#fff",
          fillOpacity: 1,
          weight: 2,
        })
          .bindPopup(`✈️ ${lastAirport.name} (${lastAirport.code})`)
          .addTo(map);

        fetchRoadRoute([destAirport.lat, destAirport.lng], end).then((road) => {
          if (!isMounted || !mapInstanceRef.current) return;
          if (road) {
            L.polyline(road, {
              color: "#1a73e8",
              weight: 6,
              opacity: 1,
              lineCap: "round",
              lineJoin: "round",
            }).addTo(map);

            L.polyline(road, {
              color: "#4285f4",
              weight: 4,
              opacity: 1,
              lineCap: "round",
              lineJoin: "round",
            }).addTo(map);

            console.log(`🚗 Ground from ${destAirport.code}`);
          }
        });
      } else {
        console.log("🚗 Using ground transport only");

        fetchRoadRoute(start, end).then((road) => {
          if (!isMounted || !mapInstanceRef.current) return;
          if (road) {
            L.polyline(road, {
              color: "#1a73e8",
              weight: 6,
              opacity: 1,
              lineCap: "round",
              lineJoin: "round",
            }).addTo(map);

            L.polyline(road, {
              color: "#4285f4",
              weight: 4,
              opacity: 1,
              lineCap: "round",
              lineJoin: "round",
            }).addTo(map);
          }
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
