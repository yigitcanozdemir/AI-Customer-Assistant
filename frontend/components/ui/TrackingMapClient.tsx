"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { PORTS } from "./ports";

function findNearestPort(lat: number, lng: number) {
  let best = null;
  let bestDist = Infinity;

  for (const port of PORTS) {
    const d =
      Math.sqrt(
        Math.pow(lat - port.lat, 2) +
        Math.pow(lng - port.lng, 2)
      );
    if (d < bestDist) {
      bestDist = d;
      best = port;
    }
  }
  return best;
}
if (typeof window !== "undefined") {
  const DefaultIcon = L.Icon.Default.prototype as L.Icon.Default & {
    _getIconUrl?: () => string;
  };
  delete DefaultIcon._getIconUrl;

  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
    iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
    shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
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

async function fetchRoute(
  start: [number, number],
  end: [number, number],
  allowPortRouting = true
): Promise<[number, number][] | null> {
  try {
    const latDiff = Math.abs(start[0] - end[0]);
    const lngDiff = Math.abs(start[1] - end[1]);
    const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);

    if (allowPortRouting && distance > 50) {
      console.log("🌍 Using port → sea → port route");

      const originPort = findNearestPort(start[0], start[1]);
      const destinationPort = findNearestPort(end[0], end[1]);

      if (!originPort || !destinationPort) {
        console.warn("⚠️ No valid ports found — using great circle fallback");
        return createGreatCircleRoute(start, end);
      }

      const land1 = await fetchRoute(start, [originPort.lat, originPort.lng], false);
      const sea = createGreatCircleRoute(
        [originPort.lat, originPort.lng],
        [destinationPort.lat, destinationPort.lng]
      );
      const land2 = await fetchRoute([destinationPort.lat, destinationPort.lng], end, false);

      return [
        ...(land1 ?? []),
        ...sea,
        ...(land2 ?? []),
      ];
    }

    const url = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.code === "Ok" && data.routes && data.routes[0]) {
      return data.routes[0].geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]]);
    }

    return null;
  } catch (error) {
    console.error("Routing failed:", error);
    return null;
  }
}


function createGreatCircleRoute(start: [number, number], end: [number, number]): [number, number][] {
  const points: [number, number][] = [];
  const steps = 100;
  
  const lat1 = (start[0] * Math.PI) / 180;
  const lng1 = (start[1] * Math.PI) / 180;
  const lat2 = (end[0] * Math.PI) / 180;
  const lng2 = (end[1] * Math.PI) / 180;
  
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    
    const a = Math.sin((1 - f) * distance(lat1, lng1, lat2, lng2)) / Math.sin(distance(lat1, lng1, lat2, lng2));
    const b = Math.sin(f * distance(lat1, lng1, lat2, lng2)) / Math.sin(distance(lat1, lng1, lat2, lng2));
    
    const x = a * Math.cos(lat1) * Math.cos(lng1) + b * Math.cos(lat2) * Math.cos(lng2);
    const y = a * Math.cos(lat1) * Math.sin(lng1) + b * Math.cos(lat2) * Math.sin(lng2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);
    
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lng = Math.atan2(y, x);
    
    points.push([(lat * 180) / Math.PI, (lng * 180) / Math.PI]);
  }
  
  console.log("Using great circle route (transoceanic)");
  return points;
}

function distance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return Math.acos(
    Math.sin(lat1) * Math.sin(lat2) + 
    Math.cos(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1)
  );
}

function createCurvedPath(start: [number, number], end: [number, number]): [number, number][] {
  const points: [number, number][] = [];
  const steps = 100;
  
  const midLat = (start[0] + end[0]) / 2;
  const midLng = (start[1] + end[1]) / 2;
  
  const dx = end[1] - start[1];
  const dy = end[0] - start[0];
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  const curveOffset = distance * 0.2;
  const offsetLat = -dx / distance * curveOffset;
  const offsetLng = dy / distance * curveOffset;
  
  const controlLat = midLat + offsetLat;
  const controlLng = midLng + offsetLng;
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const t2 = t * t;
    const mt = 1 - t;
    const mt2 = mt * mt;
    
    const lat = mt2 * start[0] + 2 * mt * t * controlLat + t2 * end[0];
    const lng = mt2 * start[1] + 2 * mt * t * controlLng + t2 * end[1];
    
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
    if (!mapRef.current) return;
    if (mapInstanceRef.current) return;

    const hasCurrentLocation = currentLocation && currentLocation.lat && currentLocation.lng;
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

      if (maxDiff < 0.01) zoom = 13;
      else if (maxDiff < 0.05) zoom = 11;
      else if (maxDiff < 0.1) zoom = 10;
      else if (maxDiff < 0.5) zoom = 8;
      else if (maxDiff < 2) zoom = 6;
      else if (maxDiff < 5) zoom = 5;
      else if (maxDiff < 10) zoom = 4;
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
      doubleClickZoom: true,
      touchZoom: true,
      dragging: true,
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true,
    });

    mapInstanceRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const currentLocationIcon = L.divIcon({
      html: `
        <div style="position: relative;">
          <div style="position: absolute; top: -20px; left: -15px; width: 30px; height: 30px; background: #3b82f6; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px rgba(0,0,0,0.3); border: 3px solid white;">
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

    const deliveryLocationIcon = L.divIcon({
      html: `
        <div style="position: relative;">
          <div style="position: absolute; top: -20px; left: -15px; width: 30px; height: 30px; background: #22c55e; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px rgba(0,0,0,0.3); border: 3px solid white;">
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

    if (hasCurrentLocation) {
      L.marker([currentLocation.lat, currentLocation.lng], { icon: currentLocationIcon })
        .addTo(map)
        .bindPopup(`
          <div style="padding: 4px;">
            <strong>Current Location</strong><br/>
            ${currentLocation.city}, ${currentLocation.region}<br/>
            ${currentLocation.country}
          </div>
        `);
    }

    if (hasDeliveryLocation) {
      L.marker([deliveryCoords.lat, deliveryCoords.lng], { icon: deliveryLocationIcon })
        .addTo(map)
        .bindPopup(`
          <div style="padding: 4px;">
            <strong>Delivery Address</strong><br/>
            ${deliveryAddress?.full_name || ""}<br/>
            ${deliveryAddress?.address_line1 || ""}${deliveryAddress?.address_line2 ? ", " + deliveryAddress.address_line2 : ""}<br/>
            ${deliveryAddress?.city}, ${deliveryAddress?.state} ${deliveryAddress?.postal_code || ""}<br/>
            ${deliveryAddress?.country}
          </div>
        `);
    }

    if (hasCurrentLocation && hasDeliveryLocation) {
      const start: [number, number] = [currentLocation.lat, currentLocation.lng];
      const end: [number, number] = [deliveryCoords.lat, deliveryCoords.lng];
      
      fetchRoute(start, end).then((routePoints) => {
        if (!isMounted || !mapInstanceRef.current) {
          console.log("Component unmounted, skipping route rendering");
          return;
        }

        let pathToDisplay: [number, number][];
        let isGreatCircle = false;
        
        if (routePoints && routePoints.length > 0) {
          pathToDisplay = routePoints;
          const lngDiff = Math.abs(start[1] - end[1]);
          isGreatCircle = lngDiff > 50;
        } else {
          pathToDisplay = createCurvedPath(start, end);
          console.log("Using curved fallback route");
        }
        
        setTimeout(() => {
        if (mapInstanceRef.current) {
            L.polyline(pathToDisplay, {
            color: isGreatCircle ? "#8b5cf6" : "#3b82f6",
            weight: isGreatCircle ? 2 : 3,
            opacity: 0.85
            }).addTo(mapInstanceRef.current);
        }
        }, 50);
      }).catch((error) => {
        console.error("Route fetch error:", error);
      });

      const bounds = L.latLngBounds(start, end);
      map.fitBounds(bounds, { padding: [50, 50] });
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
    <div className="relative w-full h-48 rounded-lg overflow-hidden border border-border/50 shadow-sm">
      <div ref={mapRef} className="w-full h-full" />
      
      <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1 rounded-full backdrop-blur-sm pointer-events-none opacity-80 hidden md:block">
        Scroll to zoom • Drag to move
      </div>
    </div>
  );
}