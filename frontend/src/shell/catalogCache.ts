// Shared module-level cache for the Fabric catalog (/fabric/catalog).
//
// Crawling the tenant is expensive, and two consumers want the same index: the
// command palette (search) and the Fabric overview dashboard (counts). Caching
// the *promise* means a second consumer mounting mid-flight joins the in-flight
// request rather than starting a second crawl.
//
// A failed load is never cached, so the next consumer retries.
import { fetchFabricCatalog, type FabricCatalogEntry } from '../api'

let cache: Promise<FabricCatalogEntry[]> | null = null
let loadedAt: number | null = null

/** The catalog, from cache when warm. `force` re-crawls (the dashboard's Sync). */
export function loadCatalog(force = false): Promise<FabricCatalogEntry[]> {
  if (force) cache = null
  if (!cache) {
    cache = fetchFabricCatalog()
      .then((entries) => {
        loadedAt = Date.now()
        return entries
      })
      .catch((e) => {
        cache = null
        throw e
      })
  }
  return cache
}

/** Epoch ms of the last successful load, or null if never loaded. */
export function catalogLoadedAt(): number | null {
  return loadedAt
}
