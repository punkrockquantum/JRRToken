/**
 * Network physics shared by the scoring engine (js/model.js) and the latency readouts
 * (js/latency.js), so one table decides how far and how fast every product is.
 *
 * Published physics: light in single-mode glass covers about 204,000 km/s, so one way is
 * 4.9 µs per km (refractive index ~1.47; Corning SMF-28 datasheet). Everything else is a
 * labelled game assumption shaped by public measurements:
 * - Lit fibre (dark fibre, ServiceFabric, a cross connect beyond the campus) follows a
 *   cable route about 1.2× the great circle (typical long-haul route factors 1.1 to 1.5).
 * - Peering at an internet exchange hairpins through the exchange and the other network's
 *   edge: about 1.5× the great circle plus a few milliseconds of switching and queueing.
 * - The public internet is transit across several networks: about 2.4× the great circle
 *   (measured path inflation is commonly 1.5 to 3×) plus 25 ms of hops and queueing, with
 *   jitter and a little loss. At every distance it is at least twice ServiceFabric's round
 *   trip and at least 20 ms slower.
 * - ServiceFabric is Digital Realty's private software-defined interconnection: lit fibre
 *   to clouds, partners, other metros and Digital Internet, with a small forwarding
 *   overhead, almost no jitter and no loss. "Eyeball-adjacent" is a short private hand-off
 *   to the ISPs consumers use: still a shared edge, so a small hop and some jitter remain.
 * Ordering at any distance: cross ≤ fiber ≤ fabric = mcp ≤ eye ≤ peer < public.
 */
export const FIBRE_S_PER_KM = 4.9e-6

/** Route length over the great circle, round-trip overhead, jitter as a share of the round trip, packet loss. */
export const ROUTE = {
  /* A cross connect is a few hundred metres of patch fibre inside one building: about 5 µs round trip. */
  cross: { inflation: 1.0, overheadS: 0.000005, jitterFrac: 0, loss: 0 },
  fiber: { inflation: 1.2, overheadS: 0, jitterFrac: 0, loss: 0 },
  fabric: { inflation: 1.2, overheadS: 0.0003, jitterFrac: 0.02, loss: 0 },
  mcp: { inflation: 1.2, overheadS: 0.0003, jitterFrac: 0.02, loss: 0 },
  eye: { inflation: 1.2, overheadS: 0.003, jitterFrac: 0.05, loss: 0.001 },
  peer: { inflation: 1.5, overheadS: 0.008, jitterFrac: 0.12, loss: 0.002 },
  public: { inflation: 2.4, overheadS: 0.025, jitterFrac: 0.35, loss: 0.005 },
}

/** One-way delay over `km` of great circle on one product's route. */
export function oneWayS(km, routeId = "fiber") {
  const route = ROUTE[routeId] || ROUTE.fiber
  return Math.max(0, Number(km) || 0) * route.inflation * FIBRE_S_PER_KM
}

/** Round-trip delay over `km` of great circle on one product, overhead included. */
export function roundTripS(km, routeId = "fiber") {
  const route = ROUTE[routeId] || ROUTE.fiber
  return 2 * oneWayS(km, routeId) + route.overheadS
}
