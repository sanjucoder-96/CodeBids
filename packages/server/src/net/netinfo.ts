/**
 * LAN connection information (spec section 40).
 *
 * On event day the operator needs one thing on screen: the URL to read out to
 * forty students. This finds every non-internal IPv4 address the organizer
 * laptop is bound to and ranks the private ranges first, because that is the
 * address that will actually work on the event router.
 */

import { networkInterfaces } from 'node:os';

export interface NetworkAddress {
  address: string;
  iface: string;
  private: boolean;
  /** True for WSL / Hyper-V / Docker / VPN adapters that clients cannot reach. */
  virtual: boolean;
  url: string;
}

function isPrivate(address: string): boolean {
  return (
    address.startsWith('192.168.') ||
    address.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address)
  );
}

/**
 * Virtual adapters (WSL, Hyper-V, Docker, VirtualBox, VMware, VPN tunnels) also
 * report private IPv4 addresses, and on a developer laptop they are frequently
 * enumerated FIRST. Reading one of those out to forty students would send them
 * to an address nothing can reach, so they are explicitly ranked last.
 */
const VIRTUAL_IFACE = /wsl|hyper-?v|vethernet|virtualbox|vmware|docker|loopback|tailscale|zerotier|tap-|tun\d|utun|bridge\d/i;

export function isVirtualInterface(name: string): boolean {
  return VIRTUAL_IFACE.test(name);
}

/** Adapters that are almost always the real event connection. */
const PHYSICAL_IFACE = /wi-?fi|wlan|ethernet|eth\d|en\d|wl\w+|local area connection/i;

function score(iface: string, address: string): number {
  let value = 0;
  if (isPrivate(address)) value += 4;
  if (isVirtualInterface(iface)) value -= 8;
  else if (PHYSICAL_IFACE.test(iface)) value += 2;
  // 169.254.x.x is a link-local self-assigned address: the machine is not
  // actually on the router yet.
  if (address.startsWith('169.254.')) value -= 6;
  return value;
}

export function listAddresses(port: number): NetworkAddress[] {
  const found: (NetworkAddress & { score: number })[] = [];
  for (const [iface, addresses] of Object.entries(networkInterfaces())) {
    for (const info of addresses ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      found.push({
        address: info.address,
        iface,
        private: isPrivate(info.address),
        virtual: isVirtualInterface(iface),
        url: `http://${info.address}:${port}`,
        score: score(iface, info.address),
      });
    }
  }
  // Real physical private-LAN addresses first, virtual adapters last, then a
  // stable alphabetical order so the console output does not shuffle.
  return found
    .sort((a, b) => b.score - a.score || a.address.localeCompare(b.address))
    .map(({ score: _score, ...rest }) => rest);
}

export function primaryAddress(port: number): NetworkAddress | null {
  return listAddresses(port)[0] ?? null;
}

export interface ConnectionInfo {
  port: number;
  addresses: NetworkAddress[];
  participantUrl: string;
  organizerUrl: string;
  projectorUrl: string;
}

export function connectionInfo(port: number): ConnectionInfo {
  const addresses = listAddresses(port);
  const base = addresses[0]?.url ?? `http://localhost:${port}`;
  return {
    port,
    addresses,
    participantUrl: base,
    organizerUrl: `${base}/organizer`,
    projectorUrl: `${base}/projector`,
  };
}
