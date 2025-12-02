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
  isReturnRoute?: boolean;
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

function normalizeLng(lng: number): number {
  while (lng > 180) lng -= 360;
  while (lng < -180) lng += 360;
  return lng;
}

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
  const flightRoute = getFlightRoute(startLat, startLng, endLat, endLng);

  return flightRoute.length > 0;
}

function addMarkerWithDuplicates(
  map: L.Map,
  lat: number,
  lng: number,
  icon: L.DivIcon,
  popupContent: string
) {
  const normalizedLng = normalizeLng(lng);

  L.marker([lat, normalizedLng], { icon }).addTo(map).bindPopup(popupContent);

  L.marker([lat, normalizedLng - 360], { icon })
    .addTo(map)
    .bindPopup(popupContent);

  L.marker([lat, normalizedLng + 360], { icon })
    .addTo(map)
    .bindPopup(popupContent);
}

function unwrapCoordinates(points: [number, number][]): [number, number][] {
  if (!points || points.length === 0) return [];

  const unwrapped: [number, number][] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const [, prevLng] = unwrapped[i - 1];
    const [currLat, currLngRaw] = points[i];
    let currLng = currLngRaw;

    const diff = currLng - prevLng;

    if (diff > 180) {
      currLng -= 360;
    } else if (diff < -180) {
      currLng += 360;
    }

    unwrapped.push([currLat, currLng]);
  }

  return unwrapped;
}

function addWrappedPolyline(
  map: L.Map,
  points: [number, number][],
  options: L.PolylineOptions
) {
  L.polyline(points, options).addTo(map);

  const pointsWest = points.map(([lat, lng]): [number, number] => [
    lat,
    lng - 360,
  ]);
  L.polyline(pointsWest, options).addTo(map);

  const pointsEast = points.map(([lat, lng]): [number, number] => [
    lat,
    lng + 360,
  ]);
  L.polyline(pointsEast, options).addTo(map);
}

export default function TrackingMapClient({
  currentLocation,
  deliveryCoords,
  deliveryAddress,
  isReturnRoute = false,
}: TrackingMapClientProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    const hasCurrentLocation =
      currentLocation && currentLocation.lat && currentLocation.lng;
    const hasDeliveryLocation = deliveryCoords;

    const currentMarkerCoords = isReturnRoute
      ? deliveryCoords
        ? {
            lat: deliveryCoords.lat,
            lng: deliveryCoords.lng,
          }
        : hasCurrentLocation
        ? {
            lat: currentLocation.lat,
            lng: currentLocation.lng,
          }
        : null
      : hasCurrentLocation
      ? {
          lat: currentLocation.lat,
          lng: currentLocation.lng,
        }
      : null;

    const deliveryMarkerCoords = isReturnRoute
      ? hasCurrentLocation
        ? {
            lat: currentLocation.lat,
            lng: currentLocation.lng,
          }
        : null
      : hasDeliveryLocation
      ? {
          lat: deliveryCoords.lat,
          lng: deliveryCoords.lng,
        }
      : null;

    if (!currentMarkerCoords && !deliveryMarkerCoords) {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      return;
    }

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    let isMounted = true;

    let center: [number, number];
    let zoom: number;
    const hasCurrentMarker = Boolean(currentMarkerCoords);
    const hasDeliveryMarker = Boolean(deliveryMarkerCoords);

    if (hasCurrentMarker && hasDeliveryMarker) {
      const normalizedCurrentLng = normalizeLng(currentMarkerCoords!.lng);
      const normalizedDeliveryLng = normalizeLng(deliveryMarkerCoords!.lng);

      center = [
        (currentMarkerCoords!.lat + deliveryMarkerCoords!.lat) / 2,
        (normalizedCurrentLng + normalizedDeliveryLng) / 2,
      ];

      const latDiff = Math.abs(
        currentMarkerCoords!.lat - deliveryMarkerCoords!.lat
      );
      const lngDiff = Math.abs(
        currentMarkerCoords!.lng - deliveryMarkerCoords!.lng
      );
      const maxDiff = Math.max(latDiff, lngDiff);

      if (maxDiff < 1) zoom = 8;
      else if (maxDiff < 5) zoom = 6;
      else if (maxDiff < 15) zoom = 5;
      else if (maxDiff < 40) zoom = 4;
      else zoom = 3;
    } else if (hasCurrentMarker) {
      center = [
        currentMarkerCoords!.lat,
        normalizeLng(currentMarkerCoords!.lng),
      ];
      zoom = 10;
    } else {
      center = [
        deliveryMarkerCoords!.lat,
        normalizeLng(deliveryMarkerCoords!.lng),
      ];
      zoom = 10;
    }

    const map = L.map(mapRef.current, {
      center,
      zoom,
      scrollWheelZoom: true,
      zoomControl: true,
      minZoom: 2,
      maxZoom: 18,
      worldCopyJump: true,
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2">
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

    const currentPopupCity = isReturnRoute
      ? deliveryAddress?.city || deliveryAddress?.state || "Customer"
      : currentLocation?.city || "Transit hub";
    const currentPopupCountry = isReturnRoute
      ? deliveryAddress?.country || ""
      : currentLocation?.country || "";
    const deliveryPopupCity = isReturnRoute
      ? currentLocation?.city || "Warehouse"
      : deliveryAddress?.city || deliveryAddress?.state || "";
    const deliveryPopupCountry = isReturnRoute
      ? currentLocation?.country || ""
      : deliveryAddress?.country || "";

    if (hasCurrentMarker)
      addMarkerWithDuplicates(
        map,
        currentMarkerCoords!.lat,
        currentMarkerCoords!.lng,
        currentIcon,
        `<strong>Current</strong><br/>${currentPopupCity}, ${currentPopupCountry}`
      );
    if (hasDeliveryMarker)
      addMarkerWithDuplicates(
        map,
        deliveryMarkerCoords!.lat,
        deliveryMarkerCoords!.lng,
        deliveryIcon,
        `<strong>Delivery</strong><br/>${deliveryPopupCity}, ${deliveryPopupCountry}`
      );

    if (hasCurrentMarker && hasDeliveryMarker) {
      const start: [number, number] = [
        currentMarkerCoords!.lat,
        normalizeLng(currentMarkerCoords!.lng),
      ];
      const end: [number, number] = [
        deliveryMarkerCoords!.lat,
        normalizeLng(deliveryMarkerCoords!.lng),
      ];

      const usesAir = needsAirFreight(start[0], start[1], end[0], end[1]);

      const allRoutePoints: [number, number][] = [start, end];

      if (usesAir) {
        const flightRoute = getFlightRoute(start[0], start[1], end[0], end[1]);

        const originAirport = flightRoute[0];
        const destAirport = flightRoute[flightRoute.length - 1];

        flightRoute.forEach((airport) => {
          allRoutePoints.push([airport.lat, normalizeLng(airport.lng)]);
        });

        fetchRoadRoute(start, [
          originAirport.lat,
          normalizeLng(originAirport.lng),
        ]).then((road) => {
          if (!isMounted || !mapInstanceRef.current) return;
          if (road) {
            const unwrapped = unwrapCoordinates(road);

            addWrappedPolyline(map, unwrapped, {
              color: "#1a73e8",
              weight: 6,
              opacity: 1,
              lineCap: "round",
              lineJoin: "round",
            });

            addWrappedPolyline(map, unwrapped, {
              color: "#4285f4",
              weight: 4,
              opacity: 1,
              lineCap: "round",
              lineJoin: "round",
            });
          }
        });

        for (let i = 0; i < flightRoute.length - 1; i++) {
          const airportA = flightRoute[i];
          const airportB = flightRoute[i + 1];

          const airportLat = airportA.lat;
          const airportLng = normalizeLng(airportA.lng);

          L.circleMarker([airportLat, airportLng], {
            radius: 4,
            color: "#0891b2",
            fillColor: "#fff",
            fillOpacity: 1,
            weight: 2,
          })
            .bindPopup(`✈️ ${airportA.name} (${airportA.code})`)
            .addTo(map);

          L.circleMarker([airportLat, airportLng - 360], {
            radius: 4,
            color: "#0891b2",
            fillColor: "#fff",
            fillOpacity: 1,
            weight: 2,
          })
            .bindPopup(`✈️ ${airportA.name} (${airportA.code})`)
            .addTo(map);

          L.circleMarker([airportLat, airportLng + 360], {
            radius: 4,
            color: "#0891b2",
            fillColor: "#fff",
            fillOpacity: 1,
            weight: 2,
          })
            .bindPopup(`✈️ ${airportA.name} (${airportA.code})`)
            .addTo(map);

          const flightPath = createFlightPath(
            [airportA.lat, normalizeLng(airportA.lng)],
            [airportB.lat, normalizeLng(airportB.lng)],
            100
          );

          addWrappedPolyline(map, flightPath, {
            color: "#0891b2",
            weight: 3,
            opacity: 0.85,
            lineCap: "round",
            lineJoin: "round",
          });
        }

        const lastAirport = flightRoute[flightRoute.length - 1];
        const lastAirportLat = lastAirport.lat;
        const lastAirportLng = normalizeLng(lastAirport.lng);

        L.circleMarker([lastAirportLat, lastAirportLng], {
          radius: 4,
          color: "#0891b2",
          fillColor: "#fff",
          fillOpacity: 1,
          weight: 2,
        })
          .bindPopup(`✈️ ${lastAirport.name} (${lastAirport.code})`)
          .addTo(map);

        L.circleMarker([lastAirportLat, lastAirportLng - 360], {
          radius: 4,
          color: "#0891b2",
          fillColor: "#fff",
          fillOpacity: 1,
          weight: 2,
        })
          .bindPopup(`✈️ ${lastAirport.name} (${lastAirport.code})`)
          .addTo(map);

        L.circleMarker([lastAirportLat, lastAirportLng + 360], {
          radius: 4,
          color: "#0891b2",
          fillColor: "#fff",
          fillOpacity: 1,
          weight: 2,
        })
          .bindPopup(`✈️ ${lastAirport.name} (${lastAirport.code})`)
          .addTo(map);

        fetchRoadRoute(
          [destAirport.lat, normalizeLng(destAirport.lng)],
          end
        ).then((road) => {
          if (!isMounted || !mapInstanceRef.current) return;
          if (road) {
            const unwrapped = unwrapCoordinates(road);

            addWrappedPolyline(map, unwrapped, {
              color: "#1a73e8",
              weight: 6,
              opacity: 1,
              lineCap: "round",
              lineJoin: "round",
            });

            addWrappedPolyline(map, unwrapped, {
              color: "#4285f4",
              weight: 4,
              opacity: 1,
              lineCap: "round",
              lineJoin: "round",
            });
          }
        });
      } else {
        fetchRoadRoute(start, end).then((road) => {
          if (!isMounted || !mapInstanceRef.current) return;
          if (road) {
            const unwrapped = unwrapCoordinates(road);

            addWrappedPolyline(map, unwrapped, {
              color: "#1a73e8",
              weight: 6,
              opacity: 1,
              lineCap: "round",
              lineJoin: "round",
            });

            addWrappedPolyline(map, unwrapped, {
              color: "#4285f4",
              weight: 4,
              opacity: 1,
              lineCap: "round",
              lineJoin: "round",
            });
          }
        });
      }

      if (allRoutePoints.length >= 2) {
        const bounds = L.latLngBounds(allRoutePoints);
        map.fitBounds(bounds, {
          padding: [50, 50],
          maxZoom: 10,
        });
      }
    }

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [currentLocation, deliveryCoords, deliveryAddress, isReturnRoute]);

  return (
    <div className="relative w-full h-48 rounded-lg overflow-visible border border-border/50">
      <div ref={mapRef} className="w-full h-full rounded-lg" />
    </div>
  );
}
