export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
export const AIRPORTS = [
  // North America - USA East
  { code: "JFK", name: "New York JFK", lat: 40.6413, lng: -73.7781, country: "USA", region: "NA_EAST" },
  { code: "EWR", name: "Newark", lat: 40.6895, lng: -74.1745, country: "USA", region: "NA_EAST" },
  { code: "ORD", name: "Chicago O'Hare", lat: 41.9742, lng: -87.9073, country: "USA", region: "NA_EAST" },
  { code: "ATL", name: "Atlanta", lat: 33.6407, lng: -84.4277, country: "USA", region: "NA_EAST" },
  { code: "MIA", name: "Miami", lat: 25.7959, lng: -80.2870, country: "USA", region: "NA_EAST" },
  
  // North America - USA West
  { code: "LAX", name: "Los Angeles", lat: 33.9416, lng: -118.4085, country: "USA", region: "NA_WEST" },
  { code: "SFO", name: "San Francisco", lat: 37.6213, lng: -122.3790, country: "USA", region: "NA_WEST" },
  { code: "SEA", name: "Seattle-Tacoma", lat: 47.4502, lng: -122.3088, country: "USA", region: "NA_WEST" },
  
  // Europe - Western
  { code: "LHR", name: "London Heathrow", lat: 51.4700, lng: -0.4543, country: "UK", region: "EUROPE_WEST" },
  { code: "CDG", name: "Paris Charles de Gaulle", lat: 49.0097, lng: 2.5479, country: "France", region: "EUROPE_WEST" },
  { code: "FRA", name: "Frankfurt", lat: 50.0379, lng: 8.5622, country: "Germany", region: "EUROPE_WEST" },
  { code: "AMS", name: "Amsterdam Schiphol", lat: 52.3105, lng: 4.7683, country: "Netherlands", region: "EUROPE_WEST" },
  { code: "MAD", name: "Madrid", lat: 40.4983, lng: -3.5676, country: "Spain", region: "EUROPE_WEST" },
  { code: "BCN", name: "Barcelona", lat: 41.2974, lng: 2.0833, country: "Spain", region: "EUROPE_WEST" },
  
  // Europe - Central/Eastern
  { code: "MUC", name: "Munich", lat: 48.3537, lng: 11.7750, country: "Germany", region: "EUROPE_CENTRAL" },
  { code: "VIE", name: "Vienna", lat: 48.1103, lng: 16.5697, country: "Austria", region: "EUROPE_CENTRAL" },
  { code: "PRG", name: "Prague", lat: 50.1008, lng: 14.2600, country: "Czech Republic", region: "EUROPE_CENTRAL" },
  { code: "WAW", name: "Warsaw", lat: 52.1657, lng: 20.9671, country: "Poland", region: "EUROPE_CENTRAL" },
  
  // Turkey & Middle East
  { code: "IST", name: "Istanbul", lat: 41.2753, lng: 28.7519, country: "Turkey", region: "TURKEY" },
  { code: "SAW", name: "Istanbul Sabiha Gökçen", lat: 40.8986, lng: 29.3092, country: "Turkey", region: "TURKEY" },
  { code: "ESB", name: "Ankara Esenboğa", lat: 40.1281, lng: 32.9951, country: "Turkey", region: "TURKEY" },
  { code: "AYT", name: "Antalya", lat: 36.8987, lng: 30.8005, country: "Turkey", region: "TURKEY" },
  { code: "DXB", name: "Dubai", lat: 25.2532, lng: 55.3657, country: "UAE", region: "MIDDLE_EAST" },
  { code: "DOH", name: "Doha Hamad", lat: 25.2731, lng: 51.6080, country: "Qatar", region: "MIDDLE_EAST" },
  { code: "AUH", name: "Abu Dhabi", lat: 24.4330, lng: 54.6511, country: "UAE", region: "MIDDLE_EAST" },
  
  // Asia - East
  { code: "PVG", name: "Shanghai Pudong", lat: 31.1443, lng: 121.8083, country: "China", region: "ASIA_EAST" },
  { code: "PEK", name: "Beijing Capital", lat: 40.0801, lng: 116.5846, country: "China", region: "ASIA_EAST" },
  { code: "HKG", name: "Hong Kong", lat: 22.3080, lng: 113.9185, country: "Hong Kong", region: "ASIA_EAST" },
  { code: "ICN", name: "Seoul Incheon", lat: 37.4602, lng: 126.4407, country: "South Korea", region: "ASIA_EAST" },
  { code: "NRT", name: "Tokyo Narita", lat: 35.7720, lng: 140.3929, country: "Japan", region: "ASIA_EAST" },
  { code: "KIX", name: "Osaka Kansai", lat: 34.4273, lng: 135.2440, country: "Japan", region: "ASIA_EAST" },
  
  // Asia - Southeast
  { code: "SIN", name: "Singapore Changi", lat: 1.3644, lng: 103.9915, country: "Singapore", region: "ASIA_SOUTHEAST" },
  { code: "BKK", name: "Bangkok Suvarnabhumi", lat: 13.6900, lng: 100.7501, country: "Thailand", region: "ASIA_SOUTHEAST" },
  { code: "KUL", name: "Kuala Lumpur", lat: 2.7456, lng: 101.7099, country: "Malaysia", region: "ASIA_SOUTHEAST" },
  { code: "CGK", name: "Jakarta", lat: -6.1275, lng: 106.6537, country: "Indonesia", region: "ASIA_SOUTHEAST" },
  
  // Asia - South
  { code: "DEL", name: "Delhi", lat: 28.5562, lng: 77.1000, country: "India", region: "ASIA_SOUTH" },
  { code: "BOM", name: "Mumbai", lat: 19.0896, lng: 72.8656, country: "India", region: "ASIA_SOUTH" },
  
  // Russia
  { code: "SVO", name: "Moscow Sheremetyevo", lat: 55.9726, lng: 37.4146, country: "Russia", region: "RUSSIA" },
  { code: "DME", name: "Moscow Domodedovo", lat: 55.4088, lng: 37.9063, country: "Russia", region: "RUSSIA" },
  
  // Australia & Oceania
  { code: "SYD", name: "Sydney", lat: -33.9399, lng: 151.1753, country: "Australia", region: "OCEANIA" },
  { code: "MEL", name: "Melbourne", lat: -37.6690, lng: 144.8410, country: "Australia", region: "OCEANIA" },
  
  // South America
  { code: "GRU", name: "São Paulo", lat: -23.4356, lng: -46.4731, country: "Brazil", region: "SOUTH_AMERICA" },
  { code: "EZE", name: "Buenos Aires", lat: -34.8222, lng: -58.5358, country: "Argentina", region: "SOUTH_AMERICA" },
  
  // Africa
  { code: "JNB", name: "Johannesburg", lat: -26.1392, lng: 28.2460, country: "South Africa", region: "AFRICA" },
  { code: "CAI", name: "Cairo", lat: 30.1219, lng: 31.4056, country: "Egypt", region: "AFRICA" },
  { code: "ADD", name: "Addis Ababa", lat: 8.9806, lng: 38.7993, country: "Ethiopia", region: "AFRICA" },
  
  // Canada
  { code: "YYZ", name: "Toronto Pearson", lat: 43.6777, lng: -79.6248, country: "Canada", region: "NA_EAST" },
  { code: "YVR", name: "Vancouver", lat: 49.1967, lng: -123.1815, country: "Canada", region: "NA_WEST" },
  
  // Mexico & Central America
  { code: "MEX", name: "Mexico City", lat: 19.4363, lng: -99.0721, country: "Mexico", region: "CENTRAL_AMERICA" },
  { code: "PTY", name: "Panama City", lat: 9.0714, lng: -79.3834, country: "Panama", region: "CENTRAL_AMERICA" },
];

export type Airport = typeof AIRPORTS[number];

export function findNearestAirport(lat: number, lng: number, region?: string): Airport {
  let candidates: Airport[] = [...AIRPORTS];
  
  if (region) {
    const regionalCandidates = AIRPORTS.filter(a => a.region === region);
    if (regionalCandidates.length > 0) {
      candidates = regionalCandidates;
    }
  }
  
  let nearest: Airport = candidates[0];
  let minDist = Infinity;
  
  for (const airport of candidates) {
    const dist = distanceKm(airport.lat, airport.lng, lat, lng);
    if (dist < minDist) {
      minDist = dist;
      nearest = airport;
    }
  }
  
  return nearest;
}

export function getRegionFromCoords(lat: number, lng: number): string {
  // North America
  if (lat > 15 && lat < 75) {
    if (lng > -130 && lng < -100) return "NA_WEST";
    if (lng > -100 && lng < -50) return "NA_EAST";
  }
  
  // Central/South America
  if (lat > -60 && lat < 15 && lng > -120 && lng < -30) return "CENTRAL_AMERICA";
  if (lat > -60 && lat < -10 && lng > -80 && lng < -30) return "SOUTH_AMERICA";
  
  // Europe
  if (lat > 35 && lat < 72) {
    if (lng > -10 && lng < 15) return "EUROPE_WEST";
    if (lng > 15 && lng < 30) return "EUROPE_CENTRAL";
  }
  
  // Turkey
  if (lat > 36 && lat < 42 && lng > 26 && lng < 45) return "TURKEY";
  
  // Middle East
  if (lat > 12 && lat < 40 && lng > 35 && lng < 65) return "MIDDLE_EAST";
  
  // Russia
  if (lat > 50 && lat < 70 && lng > 30 && lng < 180) return "RUSSIA";
  
  // Asia
  if (lat > 20 && lat < 50 && lng > 100 && lng < 150) return "ASIA_EAST";
  if (lat > -10 && lat < 25 && lng > 95 && lng < 110) return "ASIA_SOUTHEAST";
  if (lat > 5 && lat < 40 && lng > 65 && lng < 95) return "ASIA_SOUTH";
  
  // Africa
  if (lat > -40 && lat < 40 && lng > -20 && lng < 55) return "AFRICA";
  
  // Oceania
  if (lat > -50 && lat < -10 && lng > 110 && lng < 180) return "OCEANIA";
  
  return "OTHER";
}

export function getFlightRoute(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): Airport[] {
  const route: Airport[] = [];
  const tripDistance = distanceKm(startLat, startLng, endLat, endLng);
  const LAND_THRESHOLD_KM = 300;

  if (tripDistance <= LAND_THRESHOLD_KM) {
    return route;
  }

  const originAirport = findNearestAirport(startLat, startLng);
  const destAirport = findNearestAirport(endLat, endLng);

  route.push(originAirport);

  if (originAirport.code !== destAirport.code) {
    route.push(destAirport);
  }

  return route;
}