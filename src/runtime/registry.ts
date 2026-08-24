// Where the repository is, for the two links the panel shows.
//
// Nothing here reaches the network. Browsing and installing go through the
// loader (`mods.inspectRemote`, `mods.checkUpdates`, `mods.update`), which
// re-validates every manifest it is handed, because files off the network are
// untrusted whichever button asked for them.
const REPO = 'AirOne-dev/BetterSlack';
const BRANCH = 'master';

export const repoUrl = `https://github.com/${REPO}`;
export const contributeUrl = `https://github.com/${REPO}/blob/${BRANCH}/CONTRIBUTING.md`;
