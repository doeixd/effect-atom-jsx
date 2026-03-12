import type { SingleFlightTransportService } from "./Route.js";

let installedTransport: SingleFlightTransportService | null = null;

export function installSingleFlightTransport(service: SingleFlightTransportService | null): () => void {
  const previous = installedTransport;
  installedTransport = service;
  return () => {
    installedTransport = previous;
  };
}

export function getInstalledSingleFlightTransport(): SingleFlightTransportService | null {
  return installedTransport;
}
