"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

interface SuburbData {
  name: string;
  summary: string;
  fun_facts: string[];
  local_attractions: string[];
  name_etymology: string;
  cuisine_types: string[];
  restaurant_recommendations: { name: string; description: string; lat?: number; lng?: number }[];
  key_events: { year: string; event: string }[];
  notable_people: { name: string; role: string }[];
  heritage_sites: string[];
  demographics?: {
    data_year: string;
    data_source: string;
    population: string;
    top_ancestries: { name: string; percentage: number }[];
    top_languages: { name: string; percentage: number }[];
  } | null;
  venuesAvailable: boolean;
  image_url?: string;
  rawVenues?: { name: string; category: string; cuisine?: string; lat: number; lng: number }[];
}

type PanelView = "suburb" | "food" | "history" | "demographics";

const CITIES = [
  { name: "Sydney", state: "NSW" },
  { name: "Melbourne", state: "VIC" },
  { name: "Brisbane", state: "QLD" },
  { name: "Perth", state: "WA" },
  { name: "Adelaide", state: "SA" },
  { name: "Canberra", state: "ACT" },
  { name: "Hobart", state: "TAS" },
  { name: "Darwin", state: "NT" },
] as const;

type CityName = (typeof CITIES)[number]["name"];

const TABS: { id: PanelView; label: string; icon: string }[] = [
  { id: "suburb", label: "Overview", icon: "📋" },
  { id: "food", label: "Food", icon: "🍴" },
  { id: "history", label: "History", icon: "📜" },
  { id: "demographics", label: "Community", icon: "👥" },
];

const LOADING_MESSAGES: { after: number; text: string }[] = [
  { after: 0,     text: "Hitting the pavement…" },
  { after: 2500,  text: "Checking out the local scene…" },
  { after: 5000,  text: "Digging through the council records…" },
  { after: 8000,  text: "Negotiating with the restaurant database…" },
  { after: 11500, text: "The food directory seems to have gone for lunch." },
  { after: 17000, text: "Still here. This suburb really values its privacy." },
  { after: 24000, text: "Contemplating a tree change instead…" },
];

function getDefaultMapUrl(city: CityName): string {
  return `https://maps.google.com/maps?q=${encodeURIComponent(city)},+Australia&t=&z=12&ie=UTF8&iwloc=&output=embed`;
}

function getSuburbMapUrl(suburb: string, city: CityName): string {
  return `https://maps.google.com/maps?q=${encodeURIComponent(suburb)},+${encodeURIComponent(city)}&t=&z=14&ie=UTF8&iwloc=&output=embed`;
}

function getVenueMapUrl(lat: number, lng: number): string {
  return `https://maps.google.com/maps?q=${lat},${lng}&t=&z=18&ie=UTF8&iwloc=&output=embed`;
}

const COLORS_ANCESTRY = ['#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#f43f5e', '#84cc16', '#6366f1', '#d946ef', '#cbd5e1'];
const COLORS_LANGUAGE = ['#3b82f6', '#ef4444', '#8b5cf6', '#f97316', '#14b8a6', '#eab308', '#a855f7', '#0ea5e9', '#ec4899', '#cbd5e1'];

function prepareDemographicsData(data?: { name: string; percentage: number }[]) {
  if (!data || data.length === 0) return [];
  const total = data.reduce((acc, curr) => acc + curr.percentage, 0);
  const chartData = [...data];
  if (total < 100) {
    chartData.push({ name: 'Other', percentage: Number((100 - total).toFixed(1)) });
  }
  return chartData;
}

function DemographicsChart({ data, colors }: { data: { name: string; percentage: number }[], colors: string[] }) {
  if (!data || data.length === 0) return null;
  const chartData = data.map((d) => ({ name: d.name, value: d.percentage }));

  return (
    <div className="h-32 w-full">
      <ResponsiveContainer width="99%" height="100%" minWidth={0} minHeight={0}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={35}
            outerRadius={65}
            paddingAngle={2}
            dataKey="value"
            stroke="none"
          >
            {chartData.map((entry, index) => {
              const isOther = entry.name === 'Other';
              const color = isOther ? colors[colors.length - 1] : colors[index % (colors.length - 1)];
              return <Cell key={`cell-${index}`} fill={color} />;
            })}
          </Pie>
          <Tooltip 
            formatter={(value: any) => [`${value}%`, undefined]}
            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            itemStyle={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Home() {
  const [selectedCity, setSelectedCity] = useState<CityName>("Sydney");

  const [suburb, setSuburb] = useState<SuburbData | null>(null);
  const [loadingSuburb, setLoadingSuburb] = useState(false);
  const [errorSuburb, setErrorSuburb] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState<{ lat: number; lng: number } | null>(null);

  const [visibleFoodCount, setVisibleFoodCount] = useState(3);

  const [view, setView] = useState<PanelView>("suburb");
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES[0].text);

  // Prevents rapid re-submission — minimum 3 s between explore requests.
  const lastFetchRef = useRef<number>(0);

  // Cycle through loading messages while a fetch is in progress.
  useEffect(() => {
    if (!loadingSuburb) {
      setLoadingMessage(LOADING_MESSAGES[0].text);
      return;
    }
    const timers = LOADING_MESSAGES.slice(1).map(({ after, text }) =>
      setTimeout(() => setLoadingMessage(text), after)
    );
    return () => timers.forEach(clearTimeout);
  }, [loadingSuburb]);
  const FETCH_COOLDOWN_MS = 3000;

  const mapUrl = selectedVenue
    ? getVenueMapUrl(selectedVenue.lat, selectedVenue.lng)
    : suburb
      ? getSuburbMapUrl(suburb.name, selectedCity)
      : getDefaultMapUrl(selectedCity);

  function resetSectionData() {
    setVisibleFoodCount(3);
    setSelectedVenue(null);
  }

  function handleCityChange(city: CityName) {
    setSelectedCity(city);
    setSuburb(null);
    setErrorSuburb(null);
    setSearchInput("");
    setView("suburb");
    resetSectionData();
  }

  async function fetchSuburb(suburbName?: string) {
    const now = Date.now();
    if (now - lastFetchRef.current < FETCH_COOLDOWN_MS) return;
    lastFetchRef.current = now;

    setLoadingSuburb(true);
    setErrorSuburb(null);
    setView("suburb");
    setIsSearching(true);
    resetSectionData();

    const params = new URLSearchParams({ city: selectedCity });
    if (suburbName) params.set("suburb", suburbName);

    try {
      const res = await fetch(`/api/explore?${params}`);
      const data: SuburbData & { error?: string } = await res.json();
      if (!res.ok || data.error)
        throw new Error(data.error ?? `Server error (${res.status})`);

      setSuburb(data);
      setSearchInput("");
    } catch (err) {
      setErrorSuburb(
        err instanceof Error
          ? err.message
          : "Something went wrong. Give it another crack!",
      );
    } finally {
      setLoadingSuburb(false);
    }
  }

  function handleLoadMoreFood() {
    setVisibleFoodCount((prev) => prev + 3);
  }

  function handleVenueClick(v: { lat?: number; lng?: number }) {
    if (v.lat && v.lng) {
      setSelectedVenue({ lat: v.lat, lng: v.lng });
    }
  }

  function handleTabClick(tabId: PanelView) {
    setView(tabId);
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = searchInput.trim();
    if (trimmed) fetchSuburb(trimmed);
  }

  const cityMeta = CITIES.find((c) => c.name === selectedCity)!;

  const allVenues = useMemo(() => {
    if (!suburb) return [];
    const llmRecs = suburb.restaurant_recommendations;
    const llmNames = new Set(llmRecs.map(r => r.name.toLowerCase()));
    
    const extraRecs = (suburb.rawVenues || [])
      .filter(v => !llmNames.has(v.name.toLowerCase()))
      .map(v => {
        const cat = v.category.toLowerCase();
        const spot = cat === 'fast food' ? 'fast food spot' : cat;
        const description = v.cuisine 
          ? `A local ${spot} specializing in ${v.cuisine.replace(/_/g, ' ')}.`
          : `A popular local ${spot}.`;

        return {
          name: v.name,
          description,
          lat: v.lat,
          lng: v.lng
        };
      });
      
    return [...llmRecs, ...extraRecs];
  }, [suburb]);

  const ancestriesData = useMemo(() => prepareDemographicsData(suburb?.demographics?.top_ancestries), [suburb]);
  const languagesData = useMemo(() => prepareDemographicsData(suburb?.demographics?.top_languages), [suburb]);

  return (
    <main className="flex flex-col md:flex-row h-[100dvh] overflow-hidden">
      {/* Side panel — left side */}
      <aside className="w-full md:w-[460px] h-[55%] md:h-full shrink-0 flex flex-col bg-sky-50 border-b md:border-b-0 md:border-r border-sky-200 shadow-2xl z-10">
        {/* Panel header */}
        <div
          className={`bg-linear-to-br from-sky-200 to-indigo-200 px-4 md:px-5 ${isSearching ? "py-3 md:py-4" : "pt-5 pb-4 md:pt-6 md:pb-5"} shrink-0 transition-all duration-300`}
        >
          {!isSearching && (
            <>
              <h1 className="leading-none">
                <span className="block text-4xl font-black tracking-tight bg-linear-to-r from-sky-600 to-indigo-600 bg-clip-text text-transparent">
                  Suburb Surfer
                </span>
              </h1>
              <p className="text-slate-500 text-sm mt-2">
                Discover your next adventure across Australia's never-ending
                urban sprawl.
              </p>
            </>
          )}

          <div className={`space-y-3 ${!isSearching ? "mt-4" : ""}`}>
            {/* City selector */}
            <select
              value={selectedCity}
              onChange={(e) => handleCityChange(e.target.value as CityName)}
              className="
                w-full py-2 px-3 rounded-xl text-sm font-semibold
                text-slate-700 bg-white/70 border border-white/50
                focus:outline-none focus:ring-2 focus:ring-indigo-300
                cursor-pointer
              "
            >
              {CITIES.map((city) => (
                <option key={city.name} value={city.name}>
                  {city.name}, {city.state}
                </option>
              ))}
            </select>

            {isSearching && (
              <div className="flex gap-2">
                <button
                  onClick={() => fetchSuburb()}
                  disabled={loadingSuburb}
                  className="
                    px-4 rounded-xl font-semibold text-sm text-white
                    bg-indigo-500 hover:bg-indigo-600
                    transition-all duration-200 active:scale-95
                    disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer
                    flex items-center justify-center
                  "
                  title="Random Suburb"
                >
                  🎲
                </button>
                <form
                  onSubmit={handleSearchSubmit}
                  className="flex-1 flex gap-2"
                >
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Search suburbs…"
                    disabled={loadingSuburb}
                    className="
                      flex-1 py-2 px-4 rounded-xl text-sm text-slate-800
                      bg-white/80 border border-white/50
                      placeholder:text-slate-400
                      focus:outline-none focus:ring-2 focus:ring-indigo-300
                      disabled:opacity-50
                    "
                  />
                  <button
                    type="submit"
                    disabled={loadingSuburb || !searchInput.trim()}
                    className="
                      py-2 px-4 rounded-xl font-semibold text-sm text-white
                      bg-indigo-500 hover:bg-indigo-600
                      transition-all duration-200 active:scale-95
                      disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer
                    "
                  >
                    Go
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* LOADING STATE */}
        {loadingSuburb && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 gap-5">
            <div className="w-11 h-11 rounded-full border-4 border-indigo-200 border-t-indigo-500 animate-spin" />
            <p className="text-sm text-slate-500 text-center leading-snug max-w-[16rem]">
              {loadingMessage}
            </p>
          </div>
        )}

        {/* OVERVIEW VIEW*/}
        {!loadingSuburb && view === "suburb" && (
          <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">
            {!isSearching && (
              <>
                <button
                  onClick={() => fetchSuburb()}
                  disabled={loadingSuburb}
                  className="
                    w-full py-3.5 px-6
                    rounded-xl font-semibold text-base text-white
                    bg-indigo-500 hover:bg-indigo-600
                    shadow-md shadow-indigo-200
                    transition-all duration-200 active:scale-95
                    disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer
                  "
                >
                  Where should I go?
                </button>

                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-slate-200" />
                  <span className="text-xs text-slate-400 font-medium shrink-0">
                    or search
                  </span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>

                <form onSubmit={handleSearchSubmit} className="flex gap-2">
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="e.g. Newtown, Manly…"
                    disabled={loadingSuburb}
                    className="
                      flex-1 py-2.5 px-4 rounded-xl text-sm text-slate-800
                      bg-white border border-slate-200
                      placeholder:text-slate-400
                      focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent
                      disabled:opacity-50
                    "
                  />
                  <button
                    type="submit"
                    disabled={loadingSuburb || !searchInput.trim()}
                    className="
                      py-2.5 px-4 rounded-xl font-semibold text-sm text-white
                      bg-indigo-500 hover:bg-indigo-600
                      transition-all duration-200 active:scale-95
                      disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer
                    "
                  >
                    Go
                  </button>
                </form>
              </>
            )}

            {errorSuburb && (
              <div className="p-4 rounded-xl bg-rose-100 border border-rose-200 text-rose-700 text-sm leading-snug">
                {errorSuburb}
              </div>
            )}

            {suburb && !loadingSuburb && (
              <div className="space-y-5">
                <div className="flex flex-col gap-4">
                  {suburb.image_url && (
                    <img
                      src={suburb.image_url}
                      alt={suburb.name}
                      className="w-full aspect-video rounded-2xl object-cover shadow-md border-2 border-white"
                    />
                  )}
                  <div className="text-center">
                    <h2 className="text-3xl font-extrabold text-slate-800 tracking-tight">
                      {suburb.name}
                    </h2>
                    <span className="mt-2 inline-block text-xs font-semibold text-indigo-600 bg-indigo-100 px-3 py-1 rounded-full">
                      {selectedCity}, {cityMeta.state}
                    </span>
                  </div>
                </div>

                <p className="text-slate-600 text-base leading-relaxed">
                  {suburb.summary}
                </p>

                <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-violet-700 mb-2">
                    Name Origin
                  </h3>
                  <p className="text-sm text-slate-700 leading-relaxed">
                    {suburb.name_etymology}
                  </p>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-3">
                    Fun Facts
                  </h3>
                  <ul className="space-y-3">
                    {suburb.fun_facts.map((fact, i) => (
                      <li
                        key={i}
                        className="flex gap-2.5 text-sm text-slate-700 leading-snug"
                      >
                        <span className="text-amber-500 shrink-0 mt-0.5">
                          ✦
                        </span>
                        {fact}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-teal-700 mb-3">
                    Local Attractions
                  </h3>
                  <ul className="space-y-3">
                    {suburb.local_attractions.map((attraction, i) => (
                      <li
                        key={i}
                        className="flex gap-2.5 text-sm text-slate-700 leading-snug"
                      >
                        <span className="text-teal-500 shrink-0 mt-0.5">
                          📍
                        </span>
                        {attraction}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="h-2" />
              </div>
            )}
          </div>
        )}

        {/* FOOD VIEW */}
        {!loadingSuburb && view === "food" && suburb && (
          <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">
            <div className="text-center">
              <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight">
                Food in {suburb.name}
              </h2>
              <span className="mt-1.5 inline-block text-xs font-semibold text-orange-600 bg-orange-100 px-3 py-1 rounded-full">
                Local eats
              </span>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-3">
                Local Cuisine
              </h3>
              <div className="flex flex-wrap gap-2">
                {suburb.cuisine_types.map((cuisine, i) => {
                  const palettes = [
                    "bg-orange-100 text-orange-800 border-orange-200",
                    "bg-amber-100 text-amber-800 border-amber-200",
                    "bg-yellow-100 text-yellow-800 border-yellow-200",
                    "bg-lime-100 text-lime-800 border-lime-200",
                    "bg-teal-100 text-teal-800 border-teal-200",
                  ];
                  return (
                    <span
                      key={i}
                      className={`text-sm font-semibold border px-3 py-1 rounded-full ${palettes[i % palettes.length]}`}
                    >
                      {cuisine}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-orange-700 mb-3">
                Where to Eat
              </h3>

              {suburb.venuesAvailable ? (
                <>
                  <ul className="space-y-4">
                    {allVenues.slice(0, visibleFoodCount).map((r, i) => (
                      <li 
                        key={i} 
                        className={`space-y-0.5 p-2 -mx-2 rounded-lg transition-colors ${r.lat ? 'cursor-pointer hover:bg-orange-100' : ''}`}
                        onClick={() => handleVenueClick(r)}
                      >
                        <p className="text-sm font-semibold text-slate-800">
                          {r.name} {r.lat && <span className="text-xs text-orange-400 ml-1">📍</span>}
                        </p>
                        <p className="text-sm text-slate-600 leading-snug">
                          {r.description}
                        </p>
                      </li>
                    ))}
                  </ul>

                  {visibleFoodCount < allVenues.length && (
                    <button
                      onClick={handleLoadMoreFood}
                      className="
                        mt-5 w-full py-2.5 px-4
                        rounded-xl font-semibold text-sm text-orange-700
                        bg-orange-100 hover:bg-orange-200
                        border border-orange-200
                        transition-all duration-200 active:scale-95
                        cursor-pointer
                      "
                    >
                      Load More Recs
                    </button>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 py-4 text-center">
                  <span className="text-2xl">🍽️</span>
                  <p className="text-sm font-semibold text-orange-800">
                    Venue data unavailable
                  </p>
                  <p className="text-xs text-orange-700 leading-snug">
                    We had trouble finding venues for this suburb right now.
                    Give it another go in a moment.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* HISTORY VIEW */}
        {!loadingSuburb && view === "history" && suburb && (
          <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">
            <div className="text-center">
              <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight">
                History of {suburb.name}
              </h2>
              <span className="mt-1.5 inline-block text-xs font-semibold text-stone-600 bg-stone-200 px-3 py-1 rounded-full">
                Local history
              </span>
            </div>

            <div className="space-y-5">
              {/* Key events — timeline */}
              <div className="bg-stone-50 border border-stone-200 rounded-xl p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-stone-600 mb-4">
                  Key Events
                </h3>
                <ul className="space-y-3">
                  {suburb.key_events.map((e, i) => (
                    <li key={i} className="flex gap-3 items-start">
                      <span className="shrink-0 text-xs font-bold text-stone-500 bg-stone-200 px-2 py-0.5 rounded-md mt-0.5 tabular-nums">
                        {e.year}
                      </span>
                      <p className="text-sm text-slate-700 leading-snug">
                        {e.event}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Notable people */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-yellow-700 mb-3">
                  Notable People
                </h3>
                <ul className="space-y-3">
                  {suburb.notable_people.map((p, i) => (
                    <li key={i} className="space-y-0.5">
                      <p className="text-sm font-semibold text-slate-800">
                        {p.name}
                      </p>
                      <p className="text-sm text-slate-600 leading-snug">
                        {p.role}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Heritage sites */}
              <div className="bg-lime-50 border border-lime-200 rounded-xl p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-lime-700 mb-3">
                  Heritage Sites
                </h3>
                <ul className="space-y-2">
                  {suburb.heritage_sites.map((site, i) => {
                    const cleanName = site.split(/,\s*\d+| \(/)[0].trim();
                    return (
                      <li
                        key={i}
                        className="flex gap-2.5 text-sm text-slate-700 leading-snug"
                      >
                        <span className="text-lime-600 shrink-0 mt-0.5">🏛️</span>
                        {cleanName}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* DEMOGRAPHICS VIEW */}
        {!loadingSuburb && view === "demographics" && suburb && (
          <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">
            <div className="text-center">
              <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight">
                Community of {suburb.name}
              </h2>
              <span className="mt-1.5 inline-block text-xs font-semibold text-rose-600 bg-rose-100 px-3 py-1 rounded-full">
                Demographics
              </span>
            </div>

            {suburb.demographics ? (
              <div className="space-y-5">
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-center">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-rose-700 mb-1">
                    Population
                  </h3>
                  <p className="text-3xl font-black text-rose-600">
                    {suburb.demographics.population}
                  </p>
                </div>

                <div className="bg-fuchsia-50 border border-fuchsia-200 rounded-xl p-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-fuchsia-700 mb-3">
                    Top Ancestries
                  </h3>
                  <div className="flex items-center gap-3">
                    <div className="w-[45%] shrink-0">
                      <DemographicsChart data={ancestriesData} colors={COLORS_ANCESTRY} />
                    </div>
                    <ul className="flex-1 space-y-2.5">
                      {ancestriesData.map((a, i) => {
                        const isOther = a.name === 'Other';
                        const color = isOther ? COLORS_ANCESTRY[COLORS_ANCESTRY.length - 1] : COLORS_ANCESTRY[i % (COLORS_ANCESTRY.length - 1)];
                        return (
                          <li key={i} className={`flex justify-between items-start text-sm ${isOther ? 'opacity-80' : ''}`}>
                            <div className="flex items-start gap-2 pt-0.5">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1" style={{ backgroundColor: color }} />
                              <span className={`font-semibold text-slate-800 leading-tight ${isOther ? 'italic text-slate-600' : ''}`}>{a.name}</span>
                            </div>
                            <span className={`font-bold px-1.5 py-0.5 rounded-md ml-2 shrink-0 ${isOther ? 'text-slate-600 bg-slate-200/50' : 'text-fuchsia-700 bg-fuchsia-200/50'}`}>
                              {a.percentage}%
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-blue-700 mb-3">
                    Top Languages
                  </h3>
                  <div className="flex items-center gap-3">
                    <div className="w-[45%] shrink-0">
                      <DemographicsChart data={languagesData} colors={COLORS_LANGUAGE} />
                    </div>
                    <ul className="flex-1 space-y-2.5">
                      {languagesData.map((l, i) => {
                        const isOther = l.name === 'Other';
                        const color = isOther ? COLORS_LANGUAGE[COLORS_LANGUAGE.length - 1] : COLORS_LANGUAGE[i % (COLORS_LANGUAGE.length - 1)];
                        return (
                          <li key={i} className={`flex justify-between items-start text-sm ${isOther ? 'opacity-80' : ''}`}>
                            <div className="flex items-start gap-2 pt-0.5">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1" style={{ backgroundColor: color }} />
                              <span className={`font-semibold text-slate-800 leading-tight ${isOther ? 'italic text-slate-600' : ''}`}>{l.name}</span>
                            </div>
                            <span className={`font-bold px-1.5 py-0.5 rounded-md ml-2 shrink-0 ${isOther ? 'text-slate-600 bg-slate-200/50' : 'text-blue-700 bg-blue-200/50'}`}>
                              {l.percentage}%
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>

                <div className="pt-2 text-center">
                  <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">
                    Source: {suburb.demographics.data_source || "Census Data"} ({suburb.demographics.data_year || "2021"})
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <span className="text-2xl">🤷‍♂️</span>
                <p className="text-sm font-semibold text-rose-800">
                  No demographic data found
                </p>
                <p className="text-xs text-rose-700 leading-snug">
                  We couldn't find detailed census data for this suburb.
                </p>
              </div>
            )}
          </div>
        )}

        {/* SECTION TAB STRIP */}
        {suburb && !loadingSuburb && (
          <div className="shrink-0 px-4 py-3 bg-sky-50 border-t border-sky-200 flex gap-2">
            {TABS.map((tab) => {
              const isActive = view === tab.id;
                const activeClass =
                tab.id === "suburb"
                  ? "bg-indigo-100 text-indigo-700"
                  : tab.id === "food"
                    ? "bg-orange-100 text-orange-700"
                    : tab.id === "history"
                      ? "bg-stone-200 text-stone-700"
                      : "bg-rose-100 text-rose-700";

              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabClick(tab.id)}
                  className={`
                    flex-1 py-2.5 flex flex-col items-center gap-0.5
                    rounded-xl text-xs font-semibold
                    transition-all duration-150 cursor-pointer
                    ${isActive ? activeClass : "text-slate-500 hover:bg-slate-100"}
                  `}
                >
                  <span className="text-base leading-none">{tab.icon}</span>
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}
      </aside>

      {/* Full-screen interactive map */}
      <iframe
        src={mapUrl}
        className="flex-1 w-full h-full border-0"
        allowFullScreen
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        title="Suburb map"
      />
    </main>
  );
}
