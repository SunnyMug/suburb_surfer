import { describe, it, expect, vi, afterEach } from "vitest";
import { OVERPASS_ENDPOINTS, queryOverpassInParallel } from "../app/api/_lib/overpass";

const WORKING_ENDPOINT = "https://overpass.openstreetmap.fr/api/interpreter";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("queryOverpassInParallel", () => {
  it("returns data from the one mirror that responds when the others fail", async () => {
    const payload = { elements: [{ type: "node", id: 1 }] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (endpoint: string) => {
        if (endpoint === WORKING_ENDPOINT) {
          return new Response(JSON.stringify(payload), { status: 200 });
        }
        if (endpoint.includes("mail.ru")) {
          return new Response("<html>504 Gateway Time-out</html>", { status: 504 });
        }
        return new Response("<?xml version=\"1.0\"?><osm><remark>runtime error</remark></osm>", { status: 200 });
      })
    );

    await expect(queryOverpassInParallel("[out:json];")).resolves.toEqual(payload);
  });

  it("returns null and logs each mirror's failure reason when every mirror fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("busy", { status: 429 }))
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(queryOverpassInParallel("[out:json];")).resolves.toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain("all Overpass mirrors failed");
    for (const endpoint of OVERPASS_ENDPOINTS) {
      expect(message).toContain(`${new URL(endpoint).host}: status 429`);
    }
  });

  it("returns null when no mirror responds before the timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_endpoint: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          })
      )
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(queryOverpassInParallel("[out:json];", 50)).resolves.toBeNull();
  });
});
