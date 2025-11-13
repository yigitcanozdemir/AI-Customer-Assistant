import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const DEFAULT_LOCATION = {
  country: "Germany",
  region: "Berlin",
  city: "Berlin",
  lat: 52.52,
  lng: 13.405,
};

type PhotonFeature = {
  properties?: Record<string, string>;
};

const pickPhotonValue = (
  props: Record<string, string> | undefined,
  keys: string[]
) => {
  if (!props) return undefined;
  for (const key of keys) {
    if (props[key]) {
      return props[key];
    }
  }
  return undefined;
};

export async function GET(req: NextRequest) {
  const latHeader = req.headers.get("x-vercel-ip-latitude");
  const lngHeader = req.headers.get("x-vercel-ip-longitude");

  const lat = latHeader ? Number.parseFloat(latHeader) : DEFAULT_LOCATION.lat;
  const lng = lngHeader ? Number.parseFloat(lngHeader) : DEFAULT_LOCATION.lng;

  let country =
    req.headers.get("x-vercel-ip-country") || DEFAULT_LOCATION.country;
  let region =
    req.headers.get("x-vercel-ip-country-region") || DEFAULT_LOCATION.region;
  let city = req.headers.get("x-vercel-ip-city") || DEFAULT_LOCATION.city;

  const hasGeoHeaders = Boolean(
    latHeader &&
      lngHeader &&
      Number.isFinite(Number.parseFloat(latHeader)) &&
      Number.isFinite(Number.parseFloat(lngHeader))
  );

  if (hasGeoHeaders) {
    try {
      const photonResponse = await fetch(
        `https://photon.komoot.io/reverse?lat=${encodeURIComponent(
          lat
        )}&lon=${encodeURIComponent(lng)}&lang=en`,
        {
          headers: {
            "User-Agent": "ai-customer-assistant/1.0 (+https://vercel.com)",
          },
        }
      );

      if (photonResponse.ok) {
        const data = (await photonResponse.json()) as {
          features?: PhotonFeature[];
        };
        const featureProps = data.features?.[0]?.properties;

        const resolvedCity = pickPhotonValue(featureProps, [
          "city",
          "town",
          "village",
          "county",
          "name",
        ]);
        const resolvedRegion = pickPhotonValue(featureProps, [
          "state",
          "region",
          "county",
          "state_district",
        ]);
        const resolvedCountry =
          featureProps?.country ||
          featureProps?.countrycode?.toUpperCase() ||
          country;

        city = resolvedCity || city;
        region = resolvedRegion || region;
        country = resolvedCountry || country;
      }
    } catch (error) {
      console.error("Photon reverse geocoding failed:", error);
    }
  }

  return NextResponse.json({
    country,
    region,
    city,
    lat,
    lng,
  });
}
