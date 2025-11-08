"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

interface TrackingMapProps {
  currentLocation?: {
    lat: number;
    lng: number;
    city: string;
    region: string;
    country: string;
  } | null;
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

const MapComponent = dynamic(
  () => import("./TrackingMapClient").then((mod) => ({ default: mod.default })),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-48 bg-muted flex items-center justify-center text-muted-foreground text-sm rounded-lg">
        Loading map...
      </div>
    ),
  }
);

export function TrackingMap({ currentLocation, deliveryAddress }: TrackingMapProps) {
  const [deliveryCoords, setDeliveryCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);

  useEffect(() => {
    if (!deliveryAddress) {
      setDeliveryCoords(null);
      return;
    }

    const geocodeAddress = async () => {
      setIsGeocoding(true);
      try {
        if (deliveryAddress.address_line1 || deliveryAddress.postal_code) {
          const structuredQuery = new URLSearchParams();
          
          if (deliveryAddress.address_line1 || deliveryAddress.address_line2) {
            const street = [deliveryAddress.address_line1, deliveryAddress.address_line2].filter(Boolean).join(" ");
            structuredQuery.append('street', street);
          }
          structuredQuery.append('city', deliveryAddress.city);
          structuredQuery.append('state', deliveryAddress.state);
          structuredQuery.append('country', deliveryAddress.country);
          if (deliveryAddress.postal_code) {
            structuredQuery.append('postalcode', deliveryAddress.postal_code);
          }
          
          console.log("Geocoding with structured query:", structuredQuery.toString());
          
          const structuredResponse = await fetch(
            `https://nominatim.openstreetmap.org/search?${structuredQuery.toString()}&format=json&limit=1&addressdetails=1`
          );
          const structuredData = await structuredResponse.json();
          
          if (structuredData && structuredData[0]) {
            const coords = {
              lat: parseFloat(structuredData[0].lat),
              lng: parseFloat(structuredData[0].lon),
            };
            setDeliveryCoords(coords);
            console.log("Geocoded (structured):", coords, structuredData[0].display_name);
            setIsGeocoding(false);
            return;
          }
        }

        const addressParts = [
          deliveryAddress.address_line1,
          deliveryAddress.address_line2,
          deliveryAddress.postal_code,
          deliveryAddress.city,
          deliveryAddress.state,
          deliveryAddress.country,
        ].filter(Boolean);

        const fullQuery = addressParts.join(", ");
        
        console.log("Geocoding with full address:", fullQuery);
        
        const fullResponse = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullQuery)}&limit=1&addressdetails=1`
        );
        const fullData = await fullResponse.json();

        if (fullData && fullData[0]) {
          const coords = {
            lat: parseFloat(fullData[0].lat),
            lng: parseFloat(fullData[0].lon),
          };
          setDeliveryCoords(coords);
          console.log("Geocoded (full address):", coords, fullData[0].display_name);
          setIsGeocoding(false);
          return;
        }

        if (deliveryAddress.postal_code) {
          const postalQuery = `${deliveryAddress.postal_code}, ${deliveryAddress.city}, ${deliveryAddress.country}`;
          console.log("Geocoding with postal code:", postalQuery);
          
          const postalResponse = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(postalQuery)}&limit=1`
          );
          const postalData = await postalResponse.json();
          
          if (postalData && postalData[0]) {
            const coords = {
              lat: parseFloat(postalData[0].lat),
              lng: parseFloat(postalData[0].lon),
            };
            setDeliveryCoords(coords);
            console.log("Geocoded (postal code):", coords, postalData[0].display_name);
            setIsGeocoding(false);
            return;
          }
        }

        console.log("Geocoding fallback: city only");
        const cityQuery = `${deliveryAddress.city}, ${deliveryAddress.state}, ${deliveryAddress.country}`;
        const cityResponse = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cityQuery)}&limit=1`
        );
        const cityData = await cityResponse.json();
        
        if (cityData && cityData[0]) {
          const coords = {
            lat: parseFloat(cityData[0].lat),
            lng: parseFloat(cityData[0].lon),
          };
          setDeliveryCoords(coords);
          console.log("Geocoded (city fallback):", coords, cityData[0].display_name);
        }
      } catch (error) {
        console.error("Geocoding failed:", error);
      } finally {
        setIsGeocoding(false);
      }
    };

    geocodeAddress();
  }, [deliveryAddress]);

  if (isGeocoding) {
    return (
      <div className="w-full h-48 bg-muted flex items-center justify-center text-muted-foreground text-sm rounded-lg">
        Loading map...
      </div>
    );
  }

  const hasCurrentLocation = currentLocation && currentLocation.lat && currentLocation.lng;
  const hasDeliveryLocation = deliveryCoords;

  if (!hasCurrentLocation && !hasDeliveryLocation) {
    return (
      <div className="w-full h-48 bg-muted flex items-center justify-center text-muted-foreground text-sm rounded-lg">
        No location data available
      </div>
    );
  }

  return (
    <MapComponent
      currentLocation={currentLocation}
      deliveryCoords={deliveryCoords}
      deliveryAddress={deliveryAddress}
    />
  );
}