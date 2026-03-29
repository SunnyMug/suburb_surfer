"use client";

import { useState, useRef, useEffect } from "react";

interface SuburbData {
  name: string;
  summary: string;
  fun_facts: string[];
  local_attractions: string[];
  name_etymology: string;
  cuisine_types: string[];
  restaurant_recommendations: { name: string; description: string }[];
  key_events: { year: string; event: string }[];
  notable_people: { name: string; role: string }[];
  heritage_sites: string[];
  venuesAvailable: boolean;
}

type PanelView = "suburb" | "food" | "history";

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

export default function Home() {
  const [selectedCity, setSelectedCity] = useState<CityName>("Sydney");

  const [suburb, setSuburb] = useState<SuburbData | null>(null);
  const [loadingSuburb, setLoadingSuburb] = useState(false);
  const [errorSuburb, setErrorSuburb] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");

  const [loadingMoreFood, setLoadingMoreFood] = useState(false);
  const [errorMoreFood, setErrorMoreFood] = useState<string | null>(null);

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

  const mapUrl = suburb
    ? getSuburbMapUrl(suburb.name, selectedCity)
    : getDefaultMapUrl(selectedCity);

  function resetSectionData() {
    setErrorMoreFood(null);
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

  async function handleLoadMoreFood() {
    if (!suburb) return;
    setLoadingMoreFood(true);
    setErrorMoreFood(null);

    try {
      const existingNames = suburb.restaurant_recommendations.map(
        (r) => r.name,
      );
      const params = new URLSearchParams({
        suburb: suburb.name,
        city: selectedCity,
        count: "3",
        exclude: existingNames.join(","),
      });

      const res = await fetch(`/api/food?${params}`);
      const data: {
        restaurant_recommendations: { name: string; description: string }[];
        error?: string;
      } = await res.json();
      if (!res.ok || data.error)
        throw new Error(data.error ?? `Server error (${res.status})`);

      setSuburb((prev) =>
        prev
          ? {
              ...prev,
              restaurant_recommendations: [
                ...prev.restaurant_recommendations,
                ...data.restaurant_recommendations,
              ],
            }
          : prev,
      );
    } catch (err) {
      setErrorMoreFood(
        err instanceof Error
          ? err.message
          : "Couldn't load more spots. Try again!",
      );
    } finally {
      setLoadingMoreFood(false);
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

  return (
    <main className="flex h-full overflow-hidden">
      {/* Side panel — left side */}
      <aside className="w-100 shrink-0 h-full flex flex-col bg-sky-50 border-r border-sky-200 shadow-2xl">
        {/* Panel header */}
        <div className="bg-linear-to-br from-sky-200 to-indigo-200 px-6 pt-8 pb-6 shrink-0">
          <h1 className="leading-none">
            <span className="block text-4xl font-black tracking-tight bg-linear-to-r from-sky-600 to-indigo-600 bg-clip-text text-transparent">
              Suburb Surfer
            </span>
          </h1>
          <p className="text-slate-500 text-sm mt-2">
            Discover your next adventure across Australia's never-ending urban
            sprawl.
          </p>

          {/* City selector */}
          <select
            value={selectedCity}
            onChange={(e) => handleCityChange(e.target.value as CityName)}
            className="
              mt-4 w-full py-2 px-3 rounded-xl text-sm font-semibold
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
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
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

            {errorSuburb && (
              <div className="p-4 rounded-xl bg-rose-100 border border-rose-200 text-rose-700 text-sm leading-snug">
                {errorSuburb}
              </div>
            )}

            {suburb && !loadingSuburb && (
              <div className="space-y-5">
                <div className="text-center">
                  <h2 className="text-3xl font-extrabold text-slate-800 tracking-tight">
                    {suburb.name}
                  </h2>
                  <span className="mt-2 inline-block text-xs font-semibold text-indigo-600 bg-indigo-100 px-3 py-1 rounded-full">
                    {selectedCity}, {cityMeta.state}
                  </span>
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
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <div className="text-center">
              <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight">
                Food in {suburb.name}
              </h2>
              <span className="mt-1.5 inline-block text-xs font-semibold text-orange-600 bg-orange-100 px-3 py-1 rounded-full">
                Local eats
              </span>
            </div>

            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-rose-700 mb-3">
                Local Cuisine
              </h3>
              <div className="flex flex-wrap gap-2">
                {suburb.cuisine_types.map((cuisine, i) => (
                  <span
                    key={i}
                    className="text-sm font-medium text-rose-700 bg-rose-100 border border-rose-200 px-3 py-1 rounded-full"
                  >
                    {cuisine}
                  </span>
                ))}
              </div>
            </div>

            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-orange-700 mb-3">
                Where to Eat
              </h3>

              {suburb.venuesAvailable ? (
                <>
                  <ul className="space-y-4">
                    {suburb.restaurant_recommendations.map((r, i) => (
                      <li key={i} className="space-y-0.5">
                        <p className="text-sm font-semibold text-slate-800">
                          {r.name}
                        </p>
                        <p className="text-sm text-slate-600 leading-snug">
                          {r.description}
                        </p>
                      </li>
                    ))}
                  </ul>

                  {errorMoreFood && (
                    <div className="mt-4 p-3 rounded-lg bg-rose-100 border border-rose-200 text-rose-700 text-xs leading-snug">
                      {errorMoreFood}
                    </div>
                  )}

                  <button
                    onClick={handleLoadMoreFood}
                    disabled={loadingMoreFood}
                    className="
                      mt-5 w-full py-2.5 px-4
                      rounded-xl font-semibold text-sm text-orange-700
                      bg-orange-100 hover:bg-orange-200
                      border border-orange-200
                      transition-all duration-200 active:scale-95
                      disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer
                    "
                  >
                    {loadingMoreFood ? "Finding more spots…" : "Load More Recs"}
                  </button>
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 py-4 text-center">
                  <span className="text-2xl">🔌</span>
                  <p className="text-sm font-semibold text-orange-800">
                    Venue data unavailable
                  </p>
                  <p className="text-xs text-orange-700 leading-snug">
                    We couldn't reach the OpenStreetMap venue database right now.
                    Try searching again in a moment.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* HISTORY VIEW */}
        {!loadingSuburb && view === "history" && suburb && (
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
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
                  {suburb.heritage_sites.map((site, i) => (
                    <li
                      key={i}
                      className="flex gap-2.5 text-sm text-slate-700 leading-snug"
                    >
                      <span className="text-lime-600 shrink-0 mt-0.5">🏛️</span>
                      {site}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
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
                    : "bg-stone-200 text-stone-700";

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
        className="flex-1 h-full border-0"
        allowFullScreen
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        title="Suburb map"
      />
    </main>
  );
}
