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

export function TrackingMap({
  currentLocation,
  deliveryAddress,
}: TrackingMapProps) {
  const [deliveryCoords, setDeliveryCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);

  useEffect(() => {
    if (!deliveryAddress) {
      setDeliveryCoords(null);
      return;
    }

    const geocodeAddress = async () => {
      setIsGeocoding(true);
      let bestResult: { lat: number; lng: number } | null = null;

      try {
        if (deliveryAddress.address_line1) {
          try {
            const photonQuery = [
              deliveryAddress.address_line1,
              deliveryAddress.address_line2,
              deliveryAddress.city,
              deliveryAddress.state,
              deliveryAddress.postal_code,
              deliveryAddress.country,
            ]
              .filter(Boolean)
              .join(", ");

            console.log("🔍 Trying Photon API:", photonQuery);

            const photonResponse = await fetch(
              `https://photon.komoot.io/api/?q=${encodeURIComponent(
                photonQuery
              )}&limit=1`
            );
            const photonData = await photonResponse.json();

            if (photonData.features && photonData.features[0]) {
              const coords = photonData.features[0].geometry.coordinates;
              bestResult = { lat: coords[1], lng: coords[0] };
              console.log(
                "✅ Photon API success:",
                bestResult,
                photonData.features[0].properties.name
              );
              setDeliveryCoords(bestResult);
              setIsGeocoding(false);
              return;
            }
          } catch {
            console.log("⚠️ Photon API failed, trying Nominatim");
          }
        }

        if (deliveryAddress.address_line1 || deliveryAddress.postal_code) {
          const params = new URLSearchParams();

          if (deliveryAddress.address_line1) {
            params.append("street", deliveryAddress.address_line1);
          }
          if (deliveryAddress.city) {
            params.append("city", deliveryAddress.city);
          }
          if (deliveryAddress.state) {
            params.append("state", deliveryAddress.state);
          }
          if (deliveryAddress.postal_code) {
            params.append("postalcode", deliveryAddress.postal_code);
          }
          if (deliveryAddress.country) {
            params.append("country", deliveryAddress.country);
          }
          params.append("format", "json");
          params.append("limit", "1");
          params.append("addressdetails", "1");

          console.log("🔍 Trying Nominatim structured query");

          const structuredResponse = await fetch(
            `https://nominatim.openstreetmap.org/search?${params.toString()}`
          );
          const structuredData = await structuredResponse.json();

          if (structuredData && structuredData[0]) {
            bestResult = {
              lat: Number.parseFloat(structuredData[0].lat),
              lng: Number.parseFloat(structuredData[0].lon),
            };
            console.log(
              "✅ Nominatim structured success:",
              bestResult,
              structuredData[0].display_name
            );
            setDeliveryCoords(bestResult);
            setIsGeocoding(false);
            return;
          }
        }

        if (deliveryAddress.postal_code) {
          const postalQuery = `${deliveryAddress.postal_code}, ${deliveryAddress.country}`;
          console.log("🔍 Trying postal code only:", postalQuery);

          const postalResponse = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
              postalQuery
            )}&limit=1&addressdetails=1`
          );
          const postalData = await postalResponse.json();

          if (postalData && postalData[0]) {
            bestResult = {
              lat: Number.parseFloat(postalData[0].lat),
              lng: Number.parseFloat(postalData[0].lon),
            };
            console.log(
              "✅ Postal code success:",
              bestResult,
              postalData[0].display_name
            );
            setDeliveryCoords(bestResult);
            setIsGeocoding(false);
            return;
          }
        }

        const fullAddress = [
          deliveryAddress.address_line1,
          deliveryAddress.address_line2,
          deliveryAddress.city,
          deliveryAddress.state,
          deliveryAddress.postal_code,
          deliveryAddress.country,
        ]
          .filter(Boolean)
          .join(", ");

        console.log("🔍 Trying full address free-form:", fullAddress);

        const freeFormResponse = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
            fullAddress
          )}&limit=1&addressdetails=1`
        );
        const freeFormData = await freeFormResponse.json();

        if (freeFormData && freeFormData[0]) {
          bestResult = {
            lat: Number.parseFloat(freeFormData[0].lat),
            lng: Number.parseFloat(freeFormData[0].lon),
          };
          console.log(
            "✅ Free-form success:",
            bestResult,
            freeFormData[0].display_name
          );
          setDeliveryCoords(bestResult);
          setIsGeocoding(false);
          return;
        }

        const cityQuery = `${deliveryAddress.city}, ${deliveryAddress.state}, ${deliveryAddress.country}`;
        console.log("🔍 Fallback to city:", cityQuery);

        const cityResponse = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
            cityQuery
          )}&limit=1`
        );
        const cityData = await cityResponse.json();

        if (cityData && cityData[0]) {
          bestResult = {
            lat: Number.parseFloat(cityData[0].lat),
            lng: Number.parseFloat(cityData[0].lon),
          };
          console.log("⚠️ Using city fallback:", bestResult);
          setDeliveryCoords(bestResult);
        }
      } catch (error) {
        console.error("❌ All geocoding strategies failed:", error);
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

  const hasCurrentLocation =
    currentLocation && currentLocation.lat && currentLocation.lng;
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
