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

const isDev = process.env.NODE_ENV !== "production";
const logDebug = (...args: unknown[]) => {
  if (isDev) console.log(...args);
};

export const AIRPORTS = [
  // North America - USA East
  { code: "JFK", name: "New York JFK", lat: 40.6413, lng: -73.7781, country: "USA", region: "NA_EAST", isHub: true },
  { code: "EWR", name: "Newark", lat: 40.6895, lng: -74.1745, country: "USA", region: "NA_EAST", isHub: false },
  { code: "ORD", name: "Chicago O'Hare", lat: 41.9742, lng: -87.9073, country: "USA", region: "NA_EAST", isHub: true },
  { code: "ATL", name: "Atlanta", lat: 33.6407, lng: -84.4277, country: "USA", region: "NA_EAST", isHub: true },
  { code: "MIA", name: "Miami", lat: 25.7959, lng: -80.2870, country: "USA", region: "NA_EAST", isHub: true },
  
  // North America - USA West
  { code: "LAX", name: "Los Angeles", lat: 33.9416, lng: -118.4085, country: "USA", region: "NA_WEST", isHub: true },
  { code: "SFO", name: "San Francisco", lat: 37.6213, lng: -122.3790, country: "USA", region: "NA_WEST", isHub: true },
  { code: "SEA", name: "Seattle-Tacoma", lat: 47.4502, lng: -122.3088, country: "USA", region: "NA_WEST", isHub: false },
  
  // Europe - Western
  { code: "LHR", name: "London Heathrow", lat: 51.4700, lng: -0.4543, country: "UK", region: "EUROPE_WEST", isHub: true },
  { code: "CDG", name: "Paris Charles de Gaulle", lat: 49.0097, lng: 2.5479, country: "France", region: "EUROPE_WEST", isHub: true },
  { code: "FRA", name: "Frankfurt", lat: 50.0379, lng: 8.5622, country: "Germany", region: "EUROPE_WEST", isHub: true },
  { code: "AMS", name: "Amsterdam Schiphol", lat: 52.3105, lng: 4.7683, country: "Netherlands", region: "EUROPE_WEST", isHub: true },
  { code: "MAD", name: "Madrid", lat: 40.4983, lng: -3.5676, country: "Spain", region: "EUROPE_WEST", isHub: false },
  { code: "BCN", name: "Barcelona", lat: 41.2974, lng: 2.0833, country: "Spain", region: "EUROPE_WEST", isHub: false },
  
  // Europe - Central/Eastern
  { code: "MUC", name: "Munich", lat: 48.3537, lng: 11.7750, country: "Germany", region: "EUROPE_CENTRAL", isHub: false },
  { code: "VIE", name: "Vienna", lat: 48.1103, lng: 16.5697, country: "Austria", region: "EUROPE_CENTRAL", isHub: false },
  { code: "PRG", name: "Prague", lat: 50.1008, lng: 14.2600, country: "Czech Republic", region: "EUROPE_CENTRAL", isHub: false },
  { code: "WAW", name: "Warsaw", lat: 52.1657, lng: 20.9671, country: "Poland", region: "EUROPE_CENTRAL", isHub: false },
  
  // Turkey & Middle East
  { code: "IST", name: "Istanbul", lat: 41.2753, lng: 28.7519, country: "Turkey", region: "TURKEY", isHub: true },
  { code: "SAW", name: "Istanbul Sabiha Gökçen", lat: 40.8986, lng: 29.3092, country: "Turkey", region: "TURKEY", isHub: false },
  { code: "ESB", name: "Ankara Esenboğa", lat: 40.1281, lng: 32.9951, country: "Turkey", region: "TURKEY", isHub: false },
  { code: "AYT", name: "Antalya", lat: 36.8987, lng: 30.8005, country: "Turkey", region: "TURKEY", isHub: false },
  { code: "DXB", name: "Dubai", lat: 25.2532, lng: 55.3657, country: "UAE", region: "MIDDLE_EAST", isHub: true },
  { code: "DOH", name: "Doha Hamad", lat: 25.2731, lng: 51.6080, country: "Qatar", region: "MIDDLE_EAST", isHub: true },
  { code: "AUH", name: "Abu Dhabi", lat: 24.4330, lng: 54.6511, country: "UAE", region: "MIDDLE_EAST", isHub: false },
  
  // Asia - East
  { code: "PVG", name: "Shanghai Pudong", lat: 31.1443, lng: 121.8083, country: "China", region: "ASIA_EAST", isHub: true },
  { code: "PEK", name: "Beijing Capital", lat: 40.0801, lng: 116.5846, country: "China", region: "ASIA_EAST", isHub: true },
  { code: "HKG", name: "Hong Kong", lat: 22.3080, lng: 113.9185, country: "Hong Kong", region: "ASIA_EAST", isHub: true },
  { code: "ICN", name: "Seoul Incheon", lat: 37.4602, lng: 126.4407, country: "South Korea", region: "ASIA_EAST", isHub: true },
  { code: "NRT", name: "Tokyo Narita", lat: 35.7720, lng: 140.3929, country: "Japan", region: "ASIA_EAST", isHub: true },
  { code: "KIX", name: "Osaka Kansai", lat: 34.4273, lng: 135.2440, country: "Japan", region: "ASIA_EAST", isHub: false },
  
  // Asia - Southeast
  { code: "SIN", name: "Singapore Changi", lat: 1.3644, lng: 103.9915, country: "Singapore", region: "ASIA_SOUTHEAST", isHub: true },
  { code: "BKK", name: "Bangkok Suvarnabhumi", lat: 13.6900, lng: 100.7501, country: "Thailand", region: "ASIA_SOUTHEAST", isHub: true },
  { code: "KUL", name: "Kuala Lumpur", lat: 2.7456, lng: 101.7099, country: "Malaysia", region: "ASIA_SOUTHEAST", isHub: false },
  { code: "CGK", name: "Jakarta", lat: -6.1275, lng: 106.6537, country: "Indonesia", region: "ASIA_SOUTHEAST", isHub: false },
  
  // Asia - South
  { code: "DEL", name: "Delhi", lat: 28.5562, lng: 77.1000, country: "India", region: "ASIA_SOUTH", isHub: true },
  { code: "BOM", name: "Mumbai", lat: 19.0896, lng: 72.8656, country: "India", region: "ASIA_SOUTH", isHub: true },
  
  // Russia
  { code: "SVO", name: "Moscow Sheremetyevo", lat: 55.9726, lng: 37.4146, country: "Russia", region: "RUSSIA", isHub: true },
  { code: "DME", name: "Moscow Domodedovo", lat: 55.4088, lng: 37.9063, country: "Russia", region: "RUSSIA", isHub: false },
  
  // Australia & Oceania
  { code: "SYD", name: "Sydney", lat: -33.9399, lng: 151.1753, country: "Australia", region: "OCEANIA", isHub: true },
  { code: "MEL", name: "Melbourne", lat: -37.6690, lng: 144.8410, country: "Australia", region: "OCEANIA", isHub: false },
  
  // South America
  { code: "GRU", name: "São Paulo", lat: -23.4356, lng: -46.4731, country: "Brazil", region: "SOUTH_AMERICA", isHub: true },
  { code: "EZE", name: "Buenos Aires", lat: -34.8222, lng: -58.5358, country: "Argentina", region: "SOUTH_AMERICA", isHub: true },
  
  // Africa
  { code: "JNB", name: "Johannesburg", lat: -26.1392, lng: 28.2460, country: "South Africa", region: "AFRICA", isHub: true },
  { code: "CAI", name: "Cairo", lat: 30.1219, lng: 31.4056, country: "Egypt", region: "AFRICA", isHub: true },
  { code: "ADD", name: "Addis Ababa", lat: 8.9806, lng: 38.7993, country: "Ethiopia", region: "AFRICA", isHub: false },
  
  // Canada
  { code: "YYZ", name: "Toronto Pearson", lat: 43.6777, lng: -79.6248, country: "Canada", region: "NA_EAST", isHub: true },
  { code: "YVR", name: "Vancouver", lat: 49.1967, lng: -123.1815, country: "Canada", region: "NA_WEST", isHub: false },
  
  // Mexico & Central America
  { code: "MEX", name: "Mexico City", lat: 19.4363, lng: -99.0721, country: "Mexico", region: "CENTRAL_AMERICA", isHub: true },
  { code: "PTY", name: "Panama City", lat: 9.0714, lng: -79.3834, country: "Panama", region: "CENTRAL_AMERICA", isHub: false },
];

export type Airport = typeof AIRPORTS[number];

// Define continental/regional groups
const REGIONAL_GROUPS = {
  EUROPE: ["EUROPE_WEST", "EUROPE_CENTRAL", "TURKEY"],
  NORTH_AMERICA: ["NA_EAST", "NA_WEST"],
  ASIA: ["ASIA_EAST", "ASIA_SOUTHEAST", "ASIA_SOUTH"],
};

/**
 * FIXED: Check Turkey FIRST before Europe regions
 * This is CRITICAL - order matters!
 */
export function getRegionFromCoords(lat: number, lng: number): string {
  // CHECK TURKEY FIRST (before Europe checks)
  if (lat > 36 && lat < 42 && lng > 26 && lng < 45) {
    return "TURKEY";
  }
  
  // North America
  if (lat > 15 && lat < 75) {
    if (lng > -130 && lng < -100) return "NA_WEST";
    if (lng > -100 && lng < -50) return "NA_EAST";
  }
  
  // Central/South America
  if (lat > -60 && lat < 15 && lng > -120 && lng < -30) return "CENTRAL_AMERICA";
  if (lat > -60 && lat < -10 && lng > -80 && lng < -30) return "SOUTH_AMERICA";
  
  // Europe (after Turkey check)
  if (lat > 35 && lat < 72) {
    if (lng > -10 && lng < 15) return "EUROPE_WEST";
    if (lng > 15 && lng < 30) return "EUROPE_CENTRAL";
  }
  
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

function areSameRegionalGroup(region1: string, region2: string): boolean {
  for (const group of Object.values(REGIONAL_GROUPS)) {
    if (group.includes(region1) && group.includes(region2)) {
      return true;
    }
  }
  return region1 === region2;
}

/**
 * FIXED: Proper hub selection
 * 1. First try to find HUB airports in the region
 * 2. If multiple hubs, pick the nearest one
 * 3. If no hubs, use nearest airport in region
 */
function findBestDepartureAirport(lat: number, lng: number, region: string): Airport {
  logDebug(`   🔍 Finding departure airport for region: ${region}`);
  
  // Get all hub airports in this region
  const regionalHubs = AIRPORTS.filter(a => a.region === region && a.isHub === true);
  
  logDebug(`   Found ${regionalHubs.length} hubs in ${region}: ${regionalHubs.map(h => h.code).join(', ')}`);
  
  if (regionalHubs.length > 0) {
    // Pick the nearest hub
    let bestHub = regionalHubs[0];
    let minDist = distanceKm(lat, lng, bestHub.lat, bestHub.lng);
    
    for (const hub of regionalHubs) {
      const dist = distanceKm(lat, lng, hub.lat, hub.lng);
      if (dist < minDist) {
        minDist = dist;
        bestHub = hub;
      }
    }
    
    logDebug(`   ✅ Selected hub: ${bestHub.code} (${bestHub.name}) - ${minDist.toFixed(0)}km away`);
    return bestHub;
  }
  
  // No hub in region, find nearest airport
  logDebug(`   ⚠️ No hub found in ${region}, using nearest airport`);
  const regionalAirports = AIRPORTS.filter(a => a.region === region);
  
  if (regionalAirports.length === 0) {
    logDebug(`   ❌ No airports in region ${region}, using global nearest`);
    let nearest = AIRPORTS[0];
    let minDist = Infinity;
    
    for (const airport of AIRPORTS) {
      const dist = distanceKm(lat, lng, airport.lat, airport.lng);
      if (dist < minDist) {
        minDist = dist;
        nearest = airport;
      }
    }
    return nearest;
  }
  
  let nearest = regionalAirports[0];
  let minDist = distanceKm(lat, lng, nearest.lat, nearest.lng);
  
  for (const airport of regionalAirports) {
    const dist = distanceKm(lat, lng, airport.lat, airport.lng);
    if (dist < minDist) {
      minDist = dist;
      nearest = airport;
    }
  }
  
  logDebug(`   ✅ Selected: ${nearest.code} (${nearest.name})`);
  return nearest;
}

function findBestArrivalAirport(lat: number, lng: number, region: string): Airport {
  logDebug(`   🔍 Finding arrival airport for region: ${region}`);
  
  const regionalHubs = AIRPORTS.filter(a => a.region === region && a.isHub === true);
  
  logDebug(`   Found ${regionalHubs.length} hubs in ${region}: ${regionalHubs.map(h => h.code).join(', ')}`);
  
  if (regionalHubs.length > 0) {
    let bestHub = regionalHubs[0];
    let minDist = distanceKm(lat, lng, bestHub.lat, bestHub.lng);
    
    for (const hub of regionalHubs) {
      const dist = distanceKm(lat, lng, hub.lat, hub.lng);
      if (dist < minDist) {
        minDist = dist;
        bestHub = hub;
      }
    }
    
    logDebug(`   ✅ Selected hub: ${bestHub.code} (${bestHub.name}) - ${minDist.toFixed(0)}km away`);
    return bestHub;
  }
  
  logDebug(`   ⚠️ No hub found in ${region}, using nearest airport`);
  const regionalAirports = AIRPORTS.filter(a => a.region === region);
  
  if (regionalAirports.length === 0) {
    logDebug(`   ❌ No airports in region ${region}, using global nearest`);
    let nearest = AIRPORTS[0];
    let minDist = Infinity;
    
    for (const airport of AIRPORTS) {
      const dist = distanceKm(lat, lng, airport.lat, airport.lng);
      if (dist < minDist) {
        minDist = dist;
        nearest = airport;
      }
    }
    return nearest;
  }
  
  let nearest = regionalAirports[0];
  let minDist = distanceKm(lat, lng, nearest.lat, nearest.lng);
  
  for (const airport of regionalAirports) {
    const dist = distanceKm(lat, lng, airport.lat, airport.lng);
    if (dist < minDist) {
      minDist = dist;
      nearest = airport;
    }
  }
  
  logDebug(`   ✅ Selected: ${nearest.code} (${nearest.name})`);
  return nearest;
}

/**
 * Get intermediate hub airports for EXTREMELY long flights
 * Only flights > 12,000km need refueling stops
 * Medium-long flights (8,000-12,000km) can fly direct with modern cargo aircraft
 */
function getIntermediateHubs(
  originAirport: Airport,
  destAirport: Airport,
  distance: number
): Airport[] {
  const intermediateHubs: Airport[] = [];
  
  // Modern cargo aircraft (B777F, B747-8F) can fly 9,000-11,000km
  // Only EXTREMELY long flights need stops
  if (distance < 12000) {
    return intermediateHubs;
  }
  
  logDebug(`   ⛽ Extremely long flight (${distance.toFixed(0)}km) - adding refueling stop`);
  
  // Define major intercontinental hub airports for refueling
  const globalHubs: { [key: string]: Airport } = {};
  AIRPORTS.forEach(airport => {
    globalHubs[airport.code] = airport;
  });
  
  const originRegion = originAirport.region;
  const destRegion = destAirport.region;
  
  // South America ↔ Asia (extremely long, needs 1-2 stops)
  if ((originRegion === "SOUTH_AMERICA" && destRegion.includes("ASIA")) ||
      (originRegion.includes("ASIA") && destRegion === "SOUTH_AMERICA")) {
    logDebug(`   🌎 South America-Asia: ${originAirport.code} → DXB → ${destAirport.code}`);
    if (globalHubs["DXB"]) intermediateHubs.push(globalHubs["DXB"]);
  }
  
  // South America ↔ Oceania
  else if ((originRegion === "SOUTH_AMERICA" && destRegion === "OCEANIA") ||
           (originRegion === "OCEANIA" && destRegion === "SOUTH_AMERICA")) {
    logDebug(`   🌎 South America-Oceania: ${originAirport.code} → SYD/LAX → ${destAirport.code}`);
    if (originRegion === "SOUTH_AMERICA") {
      if (globalHubs["LAX"]) intermediateHubs.push(globalHubs["LAX"]);
    }
  }
  
  // Oceania ↔ Europe (extremely long)
  else if ((originRegion === "OCEANIA" && (destRegion.includes("EUROPE") || destRegion === "TURKEY")) ||
           ((originRegion.includes("EUROPE") || originRegion === "TURKEY") && destRegion === "OCEANIA")) {
    logDebug(`   🌏 Oceania-Europe: ${originAirport.code} → SIN → ${destAirport.code}`);
    if (globalHubs["SIN"]) intermediateHubs.push(globalHubs["SIN"]);
  }
  
  // Africa ↔ Oceania
  else if ((originRegion === "AFRICA" && destRegion === "OCEANIA") ||
           (originRegion === "OCEANIA" && destRegion === "AFRICA")) {
    logDebug(`   🌏 Oceania-Africa: ${originAirport.code} → SIN → ${destAirport.code}`);
    if (globalHubs["SIN"]) intermediateHubs.push(globalHubs["SIN"]);
  }
  
  // Oceania ↔ North America (if East Coast)
  else if ((originRegion === "OCEANIA" && destRegion === "NA_EAST") ||
           (originRegion === "NA_EAST" && destRegion === "OCEANIA")) {
    logDebug(`   🌏 Oceania-USA East: ${originAirport.code} → LAX → ${destAirport.code}`);
    if (globalHubs["LAX"]) intermediateHubs.push(globalHubs["LAX"]);
  }
  
  return intermediateHubs;
}

export function getFlightRoute(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): Airport[] {
  const route: Airport[] = [];
  const tripDistance = distanceKm(startLat, startLng, endLat, endLng);
  
  const startRegion = getRegionFromCoords(startLat, startLng);
  const endRegion = getRegionFromCoords(endLat, endLng);
  
  logDebug(`\n🚚 ═══════════════════════════════════════════`);
  logDebug(`📦 ROUTING: ${tripDistance.toFixed(0)}km`);
  logDebug(`   Start: ${startRegion} (${startLat.toFixed(2)}, ${startLng.toFixed(2)})`);
  logDebug(`   End: ${endRegion} (${endLat.toFixed(2)}, ${endLng.toFixed(2)})`);
  logDebug(`🚚 ═══════════════════════════════════════════`);
  
  // RULE 1: Very short distances (< 300km)
  if (tripDistance < 300) {
    logDebug("✅ DECISION: SHORT DISTANCE → Land transport only");
    logDebug(`🚚 ═══════════════════════════════════════════\n`);
    return [];
  }
  
  // RULE 2: Same region → ALWAYS land
  if (startRegion === endRegion) {
    logDebug(`✅ DECISION: SAME REGION (${startRegion}) → Land transport only`);
    logDebug(`🚚 ═══════════════════════════════════════════\n`);
    return [];
  }
  
  // RULE 3: Within EUROPE group and < 1500km → Land
  if (areSameRegionalGroup(startRegion, endRegion)) {
    if (REGIONAL_GROUPS.EUROPE.includes(startRegion) && tripDistance < 1500) {
      logDebug(`✅ DECISION: WITHIN EUROPE (<1500km) → Land transport only`);
      logDebug(`🚚 ═══════════════════════════════════════════\n`);
      return [];
    }
    if (tripDistance < 1500) {
      logDebug(`✅ DECISION: REGIONAL (<1500km) → Land transport only`);
      logDebug(`🚚 ═══════════════════════════════════════════\n`);
      return [];
    }
  }
  
  // RULE 4: Need air freight - use HUB airports
  logDebug("✈️  DECISION: AIR FREIGHT REQUIRED");
  
  const departureAirport = findBestDepartureAirport(startLat, startLng, startRegion);
  const arrivalAirport = findBestArrivalAirport(endLat, endLng, endRegion);
  
  // Add departure airport
  route.push(departureAirport);
  
  // Check if we need intermediate stops for EXTREMELY long flights (>12,000km)
  const flightDistance = distanceKm(
    departureAirport.lat,
    departureAirport.lng,
    arrivalAirport.lat,
    arrivalAirport.lng
  );
  
  const intermediateHubs = getIntermediateHubs(departureAirport, arrivalAirport, flightDistance);
  
  // Add intermediate hubs
  intermediateHubs.forEach(hub => {
    if (hub.code !== departureAirport.code && hub.code !== arrivalAirport.code) {
      route.push(hub);
    }
  });
  
  // Add arrival airport if different from departure
  if (departureAirport.code !== arrivalAirport.code) {
    route.push(arrivalAirport);
  }
  
  logDebug(`\n   🛫 Flight Distance: ${flightDistance.toFixed(0)}km`);
  logDebug(`   🛫 Route: ${route.map(a => a.code).join(" → ")}`);
  logDebug(`   📍 Airports: ${route.map(a => a.name).join(" → ")}`);
  logDebug(`🚚 ═══════════════════════════════════════════\n`);
  
  return route;
}
