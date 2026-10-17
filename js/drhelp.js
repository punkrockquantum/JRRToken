/**
 * HOW DIGITAL REALTY WOULD HAVE HELPED: four to six lines under the score, written from the
 * player's own build and the story's homes. Every number comes from the evaluation or from the
 * data tables: great-circle km between the places in js/data.js, lit-fibre round trips from
 * js/latency.js, rack caps and fit-outs from HALLS, metro power and liquid weeks from
 * METRO_OFFERS, rack power from PLATFORMS, lead parts and first-token times from the scored
 * build. Where the player chose poorly the line says what Digital Realty would have advised;
 * the closing line quotes only published facts. Pure: no DOM, no state.
 */
import { AUDIENCES, DATA_HOMES, HALLS, IN_METRO_KM, METRO_OFFERS, NETWORKS, SITES, USER_BASES, byId, hallRackCap } from "./data.js"
import { dataTrips, fibreRttS } from "./latency.js"
import { kmBetween, siteReach } from "./model.js"
import { COMBO, expertChoices, maxMetros, nerdChoices, simpleChoices } from "./presets.js"

export const DR_HELP_TITLE = "HOW DIGITAL REALTY WOULD HAVE HELPED"

/** Published facts only: the portfolio, the platform, the fabric and its MCP server. */
export const DR_FACTS = "Digital Realty runs 300+ data centers in 50+ metros on PlatformDIGITAL. ServiceFabric joins them privately to clouds, partners and other metros, and ServiceFabric MCP lets an AI agent configure it."

/** Where ORCA PT-3 is installed (published): Digital Realty's London Innovation Lab. */
const ORCA_METRO = "lon"

const WHO = { chat: "shoppers", rag: "staff", code: "developers", research: "analysts", drug: "scientists", robot: "robots" }
const CORPUS = { rag: "documents", research: "papers", code: "repos", drug: "candidate libraries", chat: "fine-tuning data", robot: "driving logs" }
const KINDS = { fabric: "ServiceFabric", mcp: "ServiceFabric MCP", cross: "Cross connect", fiber: "Dark fiber", public: "Public internet", peer: "Peering", eye: "Eyeball networks" }

const num = (value) => Math.round(value || 0).toLocaleString("en-GB")
const kmText = (km) => `${num(km)} km`
const msText = (seconds) => (seconds * 1000 < 1 ? "under 1 ms" : `${Math.round(seconds * 1000)} ms`)
/** Distance and lit-fibre round trip in one breath. */
const hop = (km) => `${kmText(km)} / ${msText(fibreRttS(km))}`
const weeks = (value) => `${Number.isInteger(value) ? value : Number(value).toFixed(1)} ${Number(value) === 1 ? "week" : "weeks"}`
const pct = (share) => `${Math.round(share * 100)}%`
const metroName = (id) => byId(SITES, id)?.metro || id
const list = (items) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0] || "")
const sentence = (value) => (value && !/[.!?]$/.test(value) ? `${value}.` : value)

/**
 * "60% London, 40% Frankfurt" or "all in Cambridge". Percentages are each place's share of
 * requests straight from USER_BASES, so every number on the card traces to the data. Stories
 * with customers list the customers here and the staff in `staffWords`.
 */
function usersWords(id) {
  const places = USER_BASES[id]?.places || []
  const pool = places.some((place) => place.kind === "customers") ? places.filter((place) => place.kind === "customers") : places
  if (pool.length === 1 && pool.length === places.length) return `all in ${pool[0].city}`
  return pool.map((place) => `${pct(place.share)} ${place.city}`).join(", ")
}

/** ", and your support team in Leeds sends the other 10%" when a story has staff beside its customers. */
function staffWords(id) {
  const places = USER_BASES[id]?.places || []
  if (!places.some((place) => place.kind === "customers")) return ""
  const staff = places.filter((place) => place.kind === "employees")
  if (!staff.length) return ""
  const name = (AUDIENCES[id]?.employees || "team").toLowerCase()
  const share = staff.reduce((sum, place) => sum + place.share, 0)
  return `, and your ${name} in ${list(staff.map((place) => place.city))} sends the other ${pct(share)}`
}

/** The player's metros as Digital Realty offers them, and the longest liquid fit-out among them. */
function offersFor(id, sites) {
  const offers = METRO_OFFERS[id] || []
  const mine = sites.map((site) => offers.find((offer) => offer.id === site.id)).filter(Boolean)
  return { offers, mine, liquidWeeks: Math.max(0, ...mine.map((offer) => offer.liquidWeeks || 0)) }
}

/** Where the people are against where the racks are, and where the model and data live. */
function placeLine(result, id) {
  const sites = result.sites || []
  const who = WHO[id] || "users"
  const names = sites.map((site) => site.metro)
  const reach = result.reach || siteReach(id, sites.map((site) => site.id))
  const home = DATA_HOMES[id]
  const trips = dataTrips(result.useCase)
  const dataKm = reach.dataNearKm || 0
  const near = reach.avgKm < 1 ? "in the same city" : `about ${hop(reach.avgKm)} away`
  let text = `Your ${who} are ${usersWords(id)}${staffWords(id)}: ${names.length > 1 ? `halls in ${list(names)} put them` : `a ${names[0]} hall puts them`} ${near}`
  if (home) {
    if (dataKm <= IN_METRO_KM) text += `; your ${home.what} sit in ${home.label}, the same metro, so the data path never leaves the building.`
    else if (trips > 0) text += `; your ${home.what} in ${home.label}, ${kmText(dataKm)} away, stay reachable over ServiceFabric at ${msText(fibreRttS(dataKm))} a retrieval.`
    else text += `; your ${home.what} copy once from ${home.label}, ${kmText(dataKm)} away.`
  } else text += "."
  const expert = expertChoices(id)
  const picked = sites.map((site) => site.id).sort().join(",")
  if (picked !== [...expert.metros].sort().join(",")) {
    const better = siteReach(id, expert.metros)
    const advice = []
    if (reach.avgKm > better.avgKm + 100) advice.push(better.avgKm < 1 ? `in the same cities as the ${who}` : `about ${hop(better.avgKm)} from the ${who}`)
    if (home && dataKm > IN_METRO_KM && better.dataNearKm <= IN_METRO_KM) advice.push("in the same metro as the data")
    if (advice.length) text += ` Digital Realty would have advised ${list(expert.metros.map(metroName))}: ${list(advice)}.`
  }
  const perSite = (reach.perSite || []).filter((entry) => entry.share > 0).map((entry) => `${entry.site.metro} serves ${pct(entry.share)} of the ${who} at ${hop(entry.km)}`)
  const dataBit = home ? `${home.city} is ${kmText(dataKm)} from the nearest hall${trips > 0 ? `, ${msText(fibreRttS(dataKm))} a round trip × ${trips} trips an answer` : ""}` : ""
  return { id: "place", text, detail: [...perSite, dataBit].filter(Boolean).join("; ") }
}

/** The racks against the hall: cooling, power room and fit-out, in the chosen metros. */
function capacityLine(result, id) {
  const platform = result.platform
  const hall = result.hall
  const sites = result.sites || []
  const where = list(sites.map((site) => site.metro))
  const racks = result.racks || 0
  const one = racks === 1
  const rackWords = `${racks}× ${platform.name} rack${one ? "" : "s"}`
  const each = one ? `${platform.rackKW} kW` : `${platform.rackKW} kW each`
  const hallName = hall.name.toLowerCase()
  const liquid = byId(HALLS, "B")
  const air = byId(HALLS, "A")
  const { offers, mine, liquidWeeks } = offersFor(id, sites)
  const hallPart = (result.leadParts || []).find((part) => part.id === "hall")
  const ready = offers.find((offer) => offer.liquidWeeks === 0 && !mine.includes(offer))
  let text
  if (platform.cooling === "liquid" && hall.cooling !== "liquid") {
    const fit = `${weeks(liquid.fitOutWeeks + liquidWeeks)} to fit out in ${where}`
    text = `Your ${rackWords} ${one ? "draws" : "draw"} ${each} and the ${hallName} in ${where} cools ${hall.maxRackKW} kW a rack, so ${one ? "it" : "they"} overheated. Digital Realty would have advised the direct-to-chip ${liquid.name.toLowerCase()}: up to ${liquid.maxRackKW} kW a rack, ${fit}${ready && liquidWeeks > 0 ? `, or ${metroName(ready.id)} where liquid capacity was ready` : ""}.`
  } else if (result.overPower) {
    const room = `${Number(result.powerMW).toFixed(2)} MW`
    text = `Your ${rackWords} drew ${num(result.siteKW)} kW against the ${num(result.powerCapKW)} kW power room in ${where}.`
    const minMult = Math.min(1, ...mine.map((offer) => offer.powerMult))
    const best = offers.reduce((top, offer) => (!top || offer.powerMult > top.powerMult ? offer : top), null)
    if (best && best.powerMult > minMult) text += ` Digital Realty would have advised ${metroName(best.id)}, where ${pct(best.powerMult)} of the scenario's power was on offer against ${pct(minMult)} in ${where}, or fewer racks.`
    else text += ` No metro on your short list offered more than ${pct(best?.powerMult || 1)} of the scenario's power: Digital Realty would have advised fewer racks for this ${room} room.`
  } else if (platform.cooling !== "liquid" && hall.cooling === "liquid") {
    /* The quickest air-family hall that takes this rack: open air for small racks, containment for HGX racks. */
    const airFit = HALLS.filter((item) => item.cooling === "air" && hallRackCap(item) >= platform.rackKW).sort((a, b) => a.fitOutWeeks - b.fitOutWeeks)[0] || air
    const airReady = airFit.fitOutWeeks ? `ready in ${weeks(airFit.fitOutWeeks)}` : "ready now"
    text = `Your ${rackWords} ${one ? "is" : "are"} air-cooled at ${each}: the ${airFit.name.toLowerCase()} at ${airFit.maxRackKW} kW a rack was ${airReady} in ${where}, instead of the ${hallName}'s fit-out of ${weeks(hallPart?.weeks ?? hall.fitOutWeeks)}.`
  } else {
    const fit = hall.fitOutWeeks ? `fitted out in ${weeks(hallPart?.weeks ?? hall.fitOutWeeks)}` : "built, powered and cooled before you arrived"
    text = `Your ${rackWords} at ${each} ${one ? "fits" : "fit"} the ${hallName} in ${where} at ${hall.maxRackKW} kW a rack, ${fit}.`
    if (hall.cooling === "liquid" && liquidWeeks > 0 && ready) text += ` ${metroName(ready.id)} had liquid capacity ready ${weeks(liquidWeeks)} sooner.`
  }
  const space = Number.isInteger(result.spaceUsed) ? result.spaceUsed : Number(result.spaceUsed || 0).toFixed(1)
  const detail = `IT ${num(result.itKW)} kW × PUE ${Number(result.pue || hall.pue).toFixed(2)} = ${num(result.facilityKW)} kW facility against ${Number(result.powerMW).toFixed(2)} MW; ${space} of ${hall.rackSpace} rack positions.`
  return { id: "capacity", text, detail }
}

/** The wire each leg rode, and the private path Digital Realty would have advised. */
function wiresLine(result, picked, id) {
  const useCase = result.useCase
  const who = WHO[id] || "users"
  const home = DATA_HOMES[id]
  const sites = result.sites || []
  const where = list(sites.map((site) => site.metro))
  const trips = dataTrips(useCase)
  const dataKm = result.dataNearKm || 0
  const batch = (useCase.legs || []).some((leg) => leg.slaExempt)
  const consumers = (useCase.legs || []).some((leg) => leg.role === "ingress" && leg.dest === "internet")
  const target = batch || !Number.isFinite(result.ttft) ? "" : ` First word in ${result.ttft.toFixed(2)} s against a ${useCase.ttft} s target.`
  const combo = COMBO[id]
  const comboWords = combo ? combo.parts.join("; ") : ""
  /* What Digital Realty would have advised instead of a shared path: one private product per leg. */
  const advised = () => {
    const bits = []
    const region = home?.kind === "cloud" ? `the ${home.city} cloud region` : home?.label || ""
    if (home && trips > 0) bits.push(dataKm > IN_METRO_KM ? `ServiceFabric to ${region} for the retrieval trips` : `a cross connect to the cloud on-ramp beside the data in ${home.city}`)
    else if (home && dataKm > IN_METRO_KM && !batch) bits.push(`ServiceFabric to ${region} for the one-time copy`)
    if (consumers) bits.push(`cross connects to the eyeball networks the ${who} arrive on`)
    if (id === "robot") bits.push(`a cross connect to each plant's carrier where it lands in the ${where} building, and ServiceFabric between the sites`)
    if (batch) bits.push("a private link for the lab's bulk data and a cross connect to ORCA in the hall")
    if (!bits.length) bits.push(`ServiceFabric for the ${who} and every other leg`)
    return `Digital Realty would have advised ${list(bits)}: no leg on the public internet.`
  }
  let text
  switch (picked.wires) {
    case "cheap":
      text = batch
        ? `The public internet carried the lab's bulk data to ${where} with no SLA to miss, but its bandwidth screened only ${pct(result.coverage || 0)} of the candidates. ${advised()}`
        : `The public internet carried your ${who} to ${where} with jitter and no SLA.${target} ${advised()}`
      break
    case "peer":
      text = batch
        ? `Peering at an exchange carried the lab's bulk data to ${where} on a shared path, screening ${pct(result.coverage || 0)} of the candidates. ${advised()}`
        : `Peering at an exchange shortened the ${who}' hop to ${where}, but the ${trips > 0 ? "retrievals" : "answers"} still rode a shared path.${target} ${advised()}`
      break
    case "private":
      text = batch
        ? `Dark fiber carried the lab's bulk data into ${where} and a cross connect joined your GPUs to ORCA in the hall: ${pct(result.coverage || 0)} of the candidates screened, nothing on the public internet.`
        : `Cross connects reached the partners inside the ${where} building and dark fiber lit your own routes; the ${who} arrived over ServiceFabric.${target}`
      break
    case "combo":
    case "mix":
      text = `Your COMBO used one product a leg: ${comboWords || "ServiceFabric, cross connects and dark fiber where each pays"}. No public internet on the path.${target}`
      break
    default:
      text = batch
        ? `ServiceFabric carried the lab's bulk data privately into ${where}: ${pct(result.coverage || 0)} of the candidates screened, nothing on the public internet.`
        : `ServiceFabric carried the ${who} privately into ${where}: no public internet on the path.${target}`
      if (combo) text += ` Mixing paid here, one product a leg: ${comboWords}.`
  }
  const legs = (result.legResults || []).filter((leg) => leg.kind && leg.kind !== "off")
  const detail = legs.map((leg) => `${leg.name}: ${KINDS[leg.kind] || byId(NETWORKS, leg.kind)?.name || leg.kind} ${msText(leg.rttS || 0)} × ${+Number(leg.trips ?? 1).toFixed(2)}`).join("; ")
  return { id: "wires", text, detail }
}

/** Go-live against the deadline: what gated it, and the pre-built capacity that shortens the wait. */
function timeLine(result, id) {
  const parts = result.leadParts || []
  const slowest = parts.reduce((top, part) => (!top || part.weeks > top.weeks ? part : top), null)
  const week = Math.ceil(result.liveWeeks || 0)
  const deadline = result.scenario?.deadlineWeeks || 0
  const sites = result.sites || []
  const where = list(sites.map((site) => site.metro))
  const { offers, mine, liquidWeeks } = offersFor(id, sites)
  const home = DATA_HOMES[id]
  const gate = slowest ? ` The slowest part was ${slowest.name} at ${weeks(slowest.weeks)}.` : ""
  let text = result.lateWeeks > 0
    ? `Live in week ${week}, ${weeks(Math.ceil(result.lateWeeks))} after the week ${deadline} deadline.${gate}`
    : `Live in week ${week} against a week ${deadline} deadline.${gate}`
  if (slowest?.id === "hall") {
    const ready = offers.find((offer) => offer.liquidWeeks === 0 && !mine.includes(offer))
    if (liquidWeeks > 0 && ready) text += ` Digital Realty would have advised ${metroName(ready.id)}, where liquid capacity was ready ${weeks(liquidWeeks)} sooner.`
    else if (result.platform?.cooling !== "liquid") text += ` Digital Realty would have advised the air hall for air-cooled racks: built and ready now.`
    else text += ` Pre-built liquid capacity in the metro is what shortens that wait.`
  } else if (slowest) {
    text += ` The ${result.hall?.name.toLowerCase() || "hall"} in ${where} was powered and cooled before the racks shipped, so nothing waited on the building.`
  }
  const copy = result.transfer
  if (copy && !copy.local && home) {
    const took = copy.hours < 1 ? "under an hour" : copy.hours < 48 ? `about ${num(copy.hours)} hours` : `about ${num(copy.hours / 24)} days`
    text += ` The one-time copy of ${num(copy.gb)} GB from ${home.city} took ${took} once the link was lit.`
  }
  return { id: "time", text, detail: parts.length ? `Lead parts: ${parts.map((part) => `${part.name} ${weeks(part.weeks)}`).join(", ")}.` : "" }
}

/** One story-specific line, or null: ORCA's home, a second metro, or data gravity. */
function storyLine(result, id) {
  const sites = result.sites || []
  const who = WHO[id] || "users"
  const where = list(sites.map((site) => site.metro))
  const home = DATA_HOMES[id]
  if (result.useCase?.orca) {
    const lab = byId(SITES, ORCA_METRO)
    if (sites.some((site) => site.id === ORCA_METRO)) return { id: "story", text: "ORCA PT-3 is installed at Digital Realty's London Innovation Lab, so the quantum helper sat in the same hall as your GPUs, a cross connect away.", detail: "" }
    const km = kmBetween(sites[0], lab)
    return { id: "story", text: `ORCA PT-3 is installed at Digital Realty's London Innovation Lab: from ${where} the quantum helper was a remote link, ${hop(km)} away. London would have kept it in the hall.`, detail: "" }
  }
  if (maxMetros(id) > 1 && sites.length === 1) {
    const other = expertChoices(id).metros.find((metro) => metro !== sites[0].id)
    const otherSite = byId(SITES, other)
    // The customers (or, for staff-only stories, the staff) who would gain the most trip-km
    // weighted by their share: a 70% factory beats a 10% engineering office.
    const places = USER_BASES[id]?.places || []
    const pool = places.some((place) => place.kind === "customers") ? places.filter((place) => place.kind === "customers") : places
    const far = otherSite
      ? pool.reduce((top, place) => {
          const gain = place.share * Math.max(0, kmBetween(place, sites[0]) - kmBetween(place, otherSite))
          return !top || gain > top.gain ? { place, gain } : top
        }, null)?.place
      : null
    if (otherSite && far) {
      const now = kmBetween(far, sites[0])
      const then = kmBetween(far, otherSite)
      if (then < now) return { id: "story", text: `A second hall in ${otherSite.metro} would have put the ${pct(far.share)} of ${who} in ${far.city} ${then < 1 ? "in their own city" : `${hop(then)} away`} instead of ${hop(now)}.`, detail: "" }
    }
    return null
  }
  if ((id === "rag" || id === "research") && home) {
    const dataKm = result.dataNearKm || 0
    const corpus = `${home.corpusTB} TB of ${CORPUS[id]}`
    const text = dataKm <= IN_METRO_KM
      ? `Data gravity: the ${corpus} stay in ${home.city}, and your ${where} hall reaches them over an in-building cross connect to the cloud on-ramp.`
      : `Data gravity: ${corpus} live in ${home.city}; from ${where} every retrieval crossed ${hop(dataKm)}. A ${home.city} hall would have reached them over an in-building cross connect.`
    return { id: "story", text, detail: "" }
  }
  return null
}

/**
 * The section for one scored build. `choices` are the player's picks (snapped onto the board the
 * player used); `nerd` appends the numbers. Returns four to six lines: place, capacity, wires,
 * time, an optional story line and the published facts.
 */
export function drHelp(result, choices = {}, { nerd = false } = {}) {
  const id = result?.useCase?.id
  if (!id || !result.ok || !result.platform || !result.hall || !result.sites?.length) {
    return { title: DR_HELP_TITLE, lines: [{ id: "facts", text: DR_FACTS, detail: "", show: DR_FACTS }] }
  }
  const picked = nerd ? nerdChoices(id, choices) : simpleChoices(id, choices)
  const lines = [placeLine(result, id), capacityLine(result, id), wiresLine(result, picked, id), timeLine(result, id), storyLine(result, id), { id: "facts", text: DR_FACTS, detail: "" }]
    .filter(Boolean)
    .map((line) => {
      const text = sentence(line.text)
      const detail = sentence(line.detail)
      return { ...line, text, detail, show: nerd ? [text, detail].filter(Boolean).join(" ") : text }
    })
  return { title: DR_HELP_TITLE, lines }
}
