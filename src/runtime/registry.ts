// Where the repository is, for the two links the panel shows.
//
// This file used to fetch the remote catalogue as well -- registry.json and a
// mod's source, straight from raw.githubusercontent. None of that is reachable
// any more: browsing and installing go through the loader (`mods.inspectRemote`,
// `mods.checkUpdates`, `mods.update`), which re-validates every manifest it is
// handed, because files off the network are untrusted whichever button asked
// for them. The fetching lived on here unused for long enough to look load-
// bearing, so it is worth saying plainly that it was not.

// The repository was renamed to match the project. GitHub redirects the old
// name, so an older copy of this still resolves.
const REPO = 'AirOne-dev/BetterSlack';
const BRANCH = 'master';

export const repoUrl = `https://github.com/${REPO}`;
export const contributeUrl = `https://github.com/${REPO}/blob/${BRANCH}/CONTRIBUTING.md`;
