// SlackMod loader.
//
// Starts Slack with a debugging port, attaches over CDP and injects the runtime
// into every Slack client target. Everything the renderer cannot do for itself
// (touch the filesystem, run code the page CSP would refuse) is served from
// here over a Runtime binding.

import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CdpConnection, CdpSession, sleep, waitForClientTarget, type TargetInfo } from './cdp.js';
import { Catalog, parseManifest } from './catalog.js';
import { downloadFile } from './download.js';
import { findSlack, launchSlack, SlackNotFoundError, stopSlack } from './slack.js';
// Shared with the runtime so a theme's @import behaves the same in Slack's
// other windows as it does in the client.
import { inlineCssImports } from '../runtime/themes.js';
import {
  ensureUserRoot,
  mergeSettings,
  readSettings,
  setModEnabled,
  setModInstalled,
  USER_MODS_ROOT,
} from './store.js';
import {
  BINDING_NAME,
  RECEIVER_NAME,
  type Envelope,
  type Event as PushEvent,
  type LoaderInfo,
  type ModRecord,
  type ModFiles,
  type Request,
  type Settings,
} from '../shared/protocol.js';

/** SLACKMOD_VERBOSE=1 forwards everything the page logs, not only its errors. */
const verbose = process.env.SLACKMOD_VERBOSE === '1';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const BUILTIN_MODS_ROOT = path.join(REPO_ROOT, 'mods');
const RUNTIME_BUNDLE = path.join(HERE, 'runtime.js');
const VERSION = '2.0.0';

interface Args {
  verbose: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { verbose: false };
  for (const a of argv) {
    if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a === '--help' || a === '-h') {
      console.log(
        `slackmod ${VERSION}\n\n` +
          `  --verbose   log every message crossing the bridge\n\n` +
          `SlackMod starts Slack itself and talks to it over a private CDP pipe.\n` +
          `There is no debugging port, so no other process can reach the connection.\n`,
      );
      process.exit(0);
    }
  }
  return args;
}

interface Attachment {
  session: CdpSession;
  /** Identifier returned by Page.addScriptToEvaluateOnNewDocument, if any. */
  scriptId?: string;
  /** In-flight repair, so two load events cannot inject twice. */
  healing?: Promise<void>;
}

class Loader {
  private catalog: Catalog;
  private attachments = new Map<string, Attachment>();
  /**
   * Slack's other windows -- the huddle preview, mostly. They are separate
   * renderers, so nothing injected into the client reaches them, and they
   * would otherwise sit there in Slack's default colours in the middle of a
   * themed app. They get the stylesheet only: no runtime, no panel, no plugins.
   */
  private auxiliary = new Map<string, CdpSession>();
  private runtimeSource = '';
  private info!: LoaderInfo;

  constructor(
    private readonly connection: CdpConnection,
    private readonly slackPath: string,
    private readonly verbose: boolean,
  ) {
    this.catalog = new Catalog(BUILTIN_MODS_ROOT, USER_MODS_ROOT);
  }

  async start(): Promise<void> {
    this.runtimeSource = await fs.readFile(RUNTIME_BUNDLE, 'utf8');
    await ensureUserRoot();
    await this.catalog.refresh();
    for (const problem of this.catalog.errors) console.warn(`[slackmod] skipped mod - ${problem}`);

    this.info = {
      version: VERSION,
      sessionId: `${process.pid}-${Date.now().toString(36)}`,
      modsRoot: BUILTIN_MODS_ROOT,
      userModsRoot: USER_MODS_ROOT,
      slackPath: this.slackPath,
      transport: 'CDP pipe (no network port)',
    };

    const mods = this.catalog.list();
    console.log(
      `[slackmod] ${mods.filter((m) => m.type === 'theme').length} theme(s), ` +
        `${mods.filter((m) => m.type === 'plugin').length} plugin(s) available`,
    );

    this.catalog.watch(async (changedIds) => {
      const settings = await readSettings();
      if (!settings.hotReload) return;
      for (const id of changedIds) {
        const files = await this.catalog.readSource(id).catch(() => null);
        if (files === null) continue;
        console.log(`[slackmod] reloading "${id}"`);
        this.broadcast({ type: 'mod.changed', id, files });
      }
      this.broadcast({ type: 'catalog.changed', mods: this.catalog.list() });
    });

    await this.attachLoop();
  }

  /** Keep every Slack client target injected, including ones opened later. */
  private async attachLoop(): Promise<void> {
    for (;;) {
      if (this.connection.isClosed) {
        console.log('[slackmod] Slack closed, exiting');
        return;
      }
      let targets: TargetInfo[] = [];
      try {
        targets = await this.connection.targets();
      } catch {
        console.log('[slackmod] Slack closed, exiting');
        return;
      }
      const pages = targets.filter((t) => t.type === 'page');
      const clients = pages.filter((t) => /app\.slack\.com/.test(t.url));
      for (const target of clients) {
        if (!this.attachments.has(target.targetId)) await this.attach(target);
      }
      // Everything else Slack opens. They start as about:blank and are filled
      // in afterwards, so the styles go in on every load rather than once.
      for (const target of pages) {
        if (clients.includes(target) || this.auxiliary.has(target.targetId)) continue;
        await this.attachAuxiliary(target);
      }
      await sleep(1500);
    }
  }

  private async attach(target: TargetInfo): Promise<void> {
    let session: CdpSession;
    try {
      session = await this.connection.attach(target.targetId);
    } catch (err) {
      console.warn(`[slackmod] could not attach to ${target.targetId}: ${(err as Error).message}`);
      return;
    }
    const attachment: Attachment = { session };
    this.attachments.set(target.targetId, attachment);
    session.on('__closed', () => this.attachments.delete(target.targetId));

    await session.send('Runtime.enable');
    await session.send('Page.enable');
    await session.send('Runtime.addBinding', { name: BINDING_NAME });

    session.on('Runtime.bindingCalled', (params: { name: string; payload: string }) => {
      if (params.name !== BINDING_NAME) return;
      void this.handleMessage(session, params.payload);
    });

    /*
     * The page's own errors, in the terminal.
     *
     * Without this the only way to see why a mod failed is to open DevTools
     * inside Slack, which is precisely what is hard when the failure is at
     * boot. Uncaught exceptions always print; console noise does not, because
     * Slack's own client is chatty -- SLACKMOD_VERBOSE=1 lifts that.
     */
    session.on('Runtime.exceptionThrown', (params: {
      exceptionDetails?: { exception?: { description?: string }; text?: string };
    }) => {
      const details = params.exceptionDetails;
      console.error(`[slackmod] page error: ${details?.exception?.description ?? details?.text ?? '?'}`);
    });

    session.on('Runtime.consoleAPICalled', (params: {
      type: string;
      args?: Array<{ value?: unknown; description?: string }>;
    }) => {
      if (params.type !== 'error' && params.type !== 'warning' && !verbose) return;
      const text = (params.args ?? [])
        .map((arg) => String(arg.value ?? arg.description ?? ''))
        .join(' ');
      if (!verbose && !text.includes('slackmod')) return;
      console.log(`[slackmod] page ${params.type}: ${text}`);
    });

    // A document-start script is what keeps themes from flashing, but it is not
    // something to rely on alone: a reload driven by another DevTools client
    // drops it, and Slack navigates on its own. Re-check after every load and
    // put the runtime back if it is missing.
    session.on('Page.loadEventFired', () => void this.ensureInjected(attachment));
    session.on('Page.frameStoppedLoading', () => void this.ensureInjected(attachment));

    await this.refreshBootScript(attachment);
    await this.inject(attachment);

    console.log(`[slackmod] injected into ${target.title || target.url}`);

  }

  /** Give one of Slack's other windows the active theme, and nothing else. */
  private async attachAuxiliary(target: TargetInfo): Promise<void> {
    let session: CdpSession;
    try {
      session = await this.connection.attach(target.targetId);
    } catch {
      return; // it may have closed already; it is only a huddle window
    }
    this.auxiliary.set(target.targetId, session);
    session.on('__closed', () => this.auxiliary.delete(target.targetId));

    await session.send('Runtime.enable').catch(() => undefined);
    await session.send('Page.enable').catch(() => undefined);
    const paint = () => void this.paintAuxiliary(session);
    session.on('Page.loadEventFired', paint);
    session.on('Page.frameStoppedLoading', paint);
    paint();
    console.log(`[slackmod] theming ${target.title || 'an auxiliary window'}`);
  }

  private async paintAuxiliary(session: CdpSession): Promise<void> {
    /*
     * Two windows must never be painted from here.
     *
     * A window a mod opened for itself says so, and is left alone: a theme
     * builder repainted by the theme being edited becomes unreadable exactly
     * when you need to read it.
     *
     * And the client itself. Slack's main window exists as about:blank for a
     * moment before it navigates, so the attach loop can catch it on the way up
     * and file it as auxiliary; without this it would then carry the theme
     * twice, once raw from here and once from the runtime.
     */
    const skip = await session
      .evaluate<boolean>(
        '!!document.documentElement.hasAttribute("data-slackmod-window")' +
          ' || !!document.querySelector(".p-client_container")' +
          ' || !!window.__slackmod',
      )
      .catch(() => true); // unreadable: leave it alone rather than guess
    if (skip) return;

    const css = await this.buildThemeCss();
    // Re-applied wholesale each time, keyed by one element, so a reload or a
    // second call cannot leave two stylesheets fighting.
    const script = `(() => {
      const id = 'slackmod-aux-theme';
      let node = document.getElementById(id);
      if (!node) {
        node = document.createElement('style');
        node.id = id;
        (document.head || document.documentElement).append(node);
      }
      node.textContent = ${JSON.stringify(css)};
    })()`;
    await session.evaluate(script, false).catch(() => undefined);
  }

  /** Every enabled theme, then the user's own CSS, in the order they apply. */
  private async buildThemeCss(): Promise<string> {
    const settings = await readSettings();
    const parts: string[] = [];
    for (const id of settings.enabled) {
      const record = this.catalog.get(id);
      if (record?.type !== 'theme') continue;
      const files = await this.catalog.readSource(id).catch(() => null);
      if (files) parts.push(inlineCssImports(files, record.entry));
    }
    if (settings.customCss.trim()) parts.push(settings.customCss);
    return parts.join('\n\n');
  }

  /** Re-register the document-start script so it carries current settings. */
  private async refreshBootScript(attachment: Attachment): Promise<void> {
    const bootstrap = await this.buildBootstrap();
    if (attachment.scriptId) {
      await attachment.session
        .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: attachment.scriptId })
        .catch(() => undefined);
    }
    const res = await attachment.session
      .send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', { source: bootstrap })
      .catch(() => undefined);
    attachment.scriptId = res?.identifier;
  }

  private async inject(attachment: Attachment): Promise<void> {
    const bootstrap = await this.buildBootstrap();
    await attachment.session.evaluate(bootstrap).catch((err: Error) => {
      console.warn(`[slackmod] injection into the live document failed: ${err.message}`);
    });
  }

  private ensureInjected(attachment: Attachment): Promise<void> {
    // Page.loadEventFired and Page.frameStoppedLoading both fire for one
    // navigation; without this guard they race and inject twice.
    if (attachment.healing) return attachment.healing;
    const work = (async () => {
      if (attachment.session.isClosed) return;
      // Compare session ids, not mere presence: a runtime left behind by a
      // previous loader run is still on the page with a dead bridge and a stale
      // copy of the settings, and would happily overwrite them.
      const current = await attachment.session
        .evaluate<string | null>('window.__slackmod ? window.__slackmod.sessionId : null', false)
        .catch(() => this.info.sessionId); // on error, do nothing rather than double-inject
      if (current === this.info.sessionId) return;
      console.log(
        current === null
          ? '[slackmod] runtime went missing after a navigation, re-injecting'
          : '[slackmod] replacing a runtime left over from a previous session',
      );
      await this.inject(attachment);
    })().finally(() => {
      attachment.healing = undefined;
    });
    attachment.healing = work;
    return work;
  }

  /**
   * The bootstrap carries settings and the source of every enabled mod, so
   * themes are applied on the first paint instead of after a round trip.
   */
  private async buildBootstrap(): Promise<string> {
    const settings = await readSettings();
    const mods = this.catalog.list();
    const sources: Record<string, ModFiles> = {};
    for (const id of settings.enabled) {
      const files = await this.catalog.readSource(id).catch((err) => {
        console.warn(`[slackmod] enabled mod "${id}" is unreadable: ${err.message}`);
        return null;
      });
      if (files !== null) sources[id] = files;
    }
    const boot = { version: VERSION, settings, mods, sources, info: this.info };
    return `window.__SLACKMOD_BOOT__ = ${JSON.stringify(boot)};\n${this.runtimeSource}`;
  }

  private async handleMessage(session: CdpSession, raw: string): Promise<void> {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(raw) as Envelope;
    } catch {
      console.warn('[slackmod] dropped an unparseable message from the renderer');
      return;
    }
    const request = envelope.payload as Request;
    if (this.verbose) console.log(`[slackmod] <- ${request.type}`);

    let result: unknown;
    let error: string | undefined;
    try {
      result = await this.dispatch(request);
    } catch (err) {
      error = (err as Error).message;
      console.warn(`[slackmod] ${request.type} failed: ${error}`);
    }
    if (envelope.rid === undefined) return;
    await this.post(session, { rid: envelope.rid, payload: { result, error } });
  }

  private async dispatch(request: Request): Promise<unknown> {
    switch (request.type) {
      case 'catalog':
        return this.catalog.list();

      case 'settings.get':
        return readSettings();

      case 'settings.set': {
        const saved = await mergeSettings(request.settings);
        // The document-start script embeds a snapshot of the settings; without
        // this, the next reload would come back with whatever was enabled when
        // the loader first attached.
        await this.refreshAllBootScripts();
        return saved;
      }

      case 'mod.setInstalled': {
        const saved = await setModInstalled(request.id, request.installed);
        await this.refreshAllBootScripts();
        this.broadcast({ type: 'settings.changed', settings: saved });
        return saved;
      }

      case 'mod.enable': {
        const saved = await setModEnabled(request.id, request.enabled);
        await this.refreshAllBootScripts();
        // Other windows are holding their own copy of the list; tell them.
        this.broadcast({ type: 'settings.changed', settings: saved });
        return saved;
      }

      case 'mod.source':
        return this.catalog.readSource(request.id);

      case 'mod.install':
        return this.install(request.id, request.manifest, request.files);

      case 'mod.uninstall':
        return this.uninstall(request.id);

      case 'loader.info':
        return this.info;

      case 'file.download': {
        const result = await downloadFile(request.url, request.filename);
        console.log(`[slackmod] saved ${result.path} (${Math.round(result.bytes / 1024)} kB)`);
        return result;
      }

      case 'log':
        console[request.level](`[slackmod:renderer] ${request.message}`);
        return null;

      default: {
        const never: never = request;
        throw new Error(`unknown request ${JSON.stringify(never)}`);
      }
    }
  }

  private async install(id: string, manifest: unknown, files: ModFiles): Promise<ModRecord[]> {
    // Re-validate here: the renderer fetched this from the network, so the
    // manifest is untrusted input no matter how it looked on the other side.
    const type = (manifest as { type?: unknown }).type === 'plugin' ? 'plugin' : 'theme';
    const parsed = parseManifest(JSON.stringify(manifest), `<install:${id}>`, type);
    if (parsed.id !== id) throw new Error(`manifest id "${parsed.id}" does not match "${id}"`);

    const dir = path.join(USER_MODS_ROOT, `${parsed.type}s`, parsed.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'mod.json'), JSON.stringify(parsed, null, 2), 'utf8');
    for (const [rel, contents] of Object.entries(files)) {
      // Re-checked here rather than trusted: this writes to disk from a message
      // the renderer sent, so a "../" in a key must not escape the folder.
      if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) {
        throw new Error(`refusing to write outside the mod folder: ${rel}`);
      }
      const target = path.join(dir, rel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, contents, 'utf8');
    }
    console.log(`[slackmod] installed "${parsed.id}" into ${dir}`);
    return this.catalog.refresh();
  }

  private async uninstall(id: string): Promise<ModRecord[]> {
    const record = this.catalog.get(id);
    if (!record) throw new Error(`unknown mod "${id}"`);
    if (record.origin === 'builtin') {
      throw new Error(`"${id}" ships with the repository; disable it instead of uninstalling`);
    }
    await fs.rm(path.join(USER_MODS_ROOT, record.path), { recursive: true, force: true });
    const settings = await readSettings();
    await mergeSettings({ enabled: settings.enabled.filter((x) => x !== id) });
    console.log(`[slackmod] uninstalled "${id}"`);
    return this.catalog.refresh();
  }

  private async post(session: CdpSession, envelope: Envelope): Promise<void> {
    const json = JSON.stringify(envelope);
    await session
      .evaluate(`window.${RECEIVER_NAME} && window.${RECEIVER_NAME}(${JSON.stringify(json)})`, false)
      .catch(() => undefined);
  }

  private broadcast(event: PushEvent): void {
    for (const { session } of this.attachments.values()) {
      void this.post(session, { payload: event });
    }
  }

  private async refreshAllBootScripts(): Promise<void> {
    await Promise.all([...this.attachments.values()].map((a) => this.refreshBootScript(a)));
    // A theme switched on or off has to reach the other windows too.
    await Promise.all([...this.auxiliary.values()].map((s) => this.paintAuxiliary(s)));
  }

  dispose(): void {
    this.catalog.dispose();
    for (const { session } of this.attachments.values()) session.close();
    for (const session of this.auxiliary.values()) session.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let slackPath: string;
  try {
    slackPath = findSlack();
  } catch (err) {
    if (err instanceof SlackNotFoundError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  // The pipe descriptors only exist if we spawn Slack ourselves, so an already
  // running instance has to be restarted. That is also what keeps the loader
  // from ever needing a debugging port.
  console.log('[slackmod] starting Slack...');
  await stopSlack();
  const child = launchSlack({ slackPath });

  let connection: CdpConnection;
  try {
    connection = CdpConnection.fromChild(child);
    await waitForClientTarget(connection, 90_000);
  } catch (err) {
    console.error(`[slackmod] ${(err as Error).message}`);
    child.kill();
    process.exit(1);
  }

  const loader = new Loader(connection, slackPath, args.verbose);
  const shutdown = () => {
    console.log('\n[slackmod] detaching (Slack keeps running; mods stay until you reload it)');
    loader.dispose();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await loader.start();
  loader.dispose();
}

main().catch((err) => {
  console.error('[slackmod] fatal:', err);
  process.exit(1);
});
