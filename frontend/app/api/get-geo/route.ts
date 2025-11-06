import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const country = req.headers.get("x-vercel-ip-country");
  const region = req.headers.get("x-vercel-ip-country-region");
  const city = req.headers.get("x-vercel-ip-city");
  const lat = req.headers.get("x-vercel-ip-latitude");
  const lng = req.headers.get("x-vercel-ip-longitude");

  return NextResponse.json({country: country || "Germany",
  region: region || "Berlin",
  city: city || "Berlin",
  lat: lat ? parseFloat(lat) : 52.52,
  lng: lng ? parseFloat(lng) : 13.405, });
}
