// The remote catalog: mods that live in the GitHub repository but are not on
// this machine yet.
//
// Everything here goes through a pull request and a human review before it can
// appear, which is the whole security model for now: there is no sandbox around
// a plugin, so the review *is* the boundary. Keep that in mind before widening
// this to arbitrary URLs.

import type { ModManifest, ModRecord } from '../shared/protocol.js';

const REPO = 'AirOne-dev/SlackMod';
const BRANCH = 'master';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

export interface RegistryEntry extends ModManifest {
  /** Path relative to mods/, e.g. "themes/midnight". */
  path: string;
}

export interface Registry {
  generatedAt: string;
  mods: RegistryEntry[];
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

export async function fetchRegistry(): Promise<Registry> {
  const raw = await getText(`${RAW_BASE}/mods/registry.json`);
  const parsed = JSON.parse(raw) as Registry;
  if (!Array.isArray(parsed.mods)) throw new Error('registry.json has no "mods" array');
  return parsed;
}

export async function fetchModSource(entry: RegistryEntry): Promise<string> {
  return getText(`${RAW_BASE}/mods/${entry.path}/${entry.entry}`);
}

export function toRecord(entry: RegistryEntry): ModRecord {
  return { ...entry, origin: 'installed', path: entry.path };
}

export const repoUrl = `https://github.com/${REPO}`;
export const contributeUrl = `https://github.com/${REPO}/blob/${BRANCH}/CONTRIBUTING.md`;
