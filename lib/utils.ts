import { CityName } from "./types";

export function getDefaultMapUrl(city: CityName): string {
  return `https://maps.google.com/maps?q=${encodeURIComponent(city)},+Australia&t=&z=12&ie=UTF8&iwloc=&output=embed`;
}

export function getSuburbMapUrl(suburb: string, city: CityName): string {
  return `https://maps.google.com/maps?q=${encodeURIComponent(suburb)},+${encodeURIComponent(city)}&t=&z=14&ie=UTF8&iwloc=&output=embed`;
}

export function getVenueMapUrl(lat: number, lng: number): string {
  return `https://maps.google.com/maps?q=${lat},${lng}&t=&z=18&ie=UTF8&iwloc=&output=embed`;
}

export function prepareDemographicsData(data?: { name: string; percentage: number }[]) {
  if (!data || data.length === 0) return [];
  const total = data.reduce((acc, curr) => acc + curr.percentage, 0);
  const chartData = [...data];
  if (total < 100) {
    chartData.push({ name: 'Other', percentage: Number((100 - total).toFixed(1)) });
  }
  return chartData;
}
