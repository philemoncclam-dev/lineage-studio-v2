// Connector registry. Adding a Fabric/Purview connector later means writing its
// own parse() and adding one entry here — the reconcile engine and Sync UI stay
// unchanged.
import type { Connector } from "./types";
import { dbtConnector } from "./dbtConnector";
import { fabricConnector } from "./fabricConnector";

export const CONNECTORS: Record<string, Connector> = {
  [dbtConnector.id]: dbtConnector,
  [fabricConnector.id]: fabricConnector,
};

export const CONNECTOR_LIST = Object.values(CONNECTORS);
