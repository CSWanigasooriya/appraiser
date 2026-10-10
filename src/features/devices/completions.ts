/**
 * Autocomplete for the device shell. Pure functions: the Terminal component
 * supplies history and package names and renders what comes back.
 */

/** A command tree node: subcommands/flags to offer next, or a package name slot. */
type Node = { [token: string]: Node } | 'package' | null

const PACKAGE: Node = 'package'
const leaves = (...names: string[]): Node => Object.fromEntries(names.map((n) => [n, null]))

const TREE: Record<string, Node> = {
  pm: {
    list: {
      packages: leaves('-3', '-s', '-f', '-d', '-e', '-u', '-i', '--user'),
      features: null,
      permissions: leaves('-g', '-f', '-d'),
      users: null,
      libraries: null,
      instrumentation: null,
    },
    path: PACKAGE,
    clear: PACKAGE,
    dump: PACKAGE,
    grant: PACKAGE,
    revoke: PACKAGE,
    enable: PACKAGE,
    disable: PACKAGE,
    'disable-user': PACKAGE,
    uninstall: PACKAGE,
    resolve: leaves(),
    install: null,
  },
  am: {
    start: leaves('-n', '-a', '-d', '-W', '-S', '--user'),
    'force-stop': PACKAGE,
    kill: PACKAGE,
    'kill-all': null,
    broadcast: leaves('-a', '-n', '--user'),
    instrument: leaves('-w', '-r', '-e'),
    'start-service': leaves('-n', '-a'),
    'stop-service': null,
    'set-debug-app': PACKAGE,
    'clear-debug-app': null,
  },
  dumpsys: {
    activity: leaves('activities', 'processes', 'services', 'broadcasts', 'top'),
    battery: null,
    batterystats: PACKAGE,
    package: PACKAGE,
    meminfo: PACKAGE,
    window: leaves('windows', 'displays', 'policy'),
    display: null,
    wifi: null,
    connectivity: null,
    notification: null,
    power: null,
    cpuinfo: null,
    gfxinfo: PACKAGE,
    usagestats: null,
    alarm: null,
    audio: null,
    telephony: null,
    input: null,
    procstats: null,
    diskstats: null,
  },
  getprop: leaves(
    'ro.build.version.release',
    'ro.build.version.sdk',
    'ro.product.model',
    'ro.product.manufacturer',
    'ro.product.brand',
    'ro.product.device',
    'ro.build.fingerprint',
    'ro.serialno',
    'ro.hardware',
    'ro.product.cpu.abi',
  ),
  setprop: null,
  settings: {
    get: leaves('global', 'secure', 'system'),
    put: leaves('global', 'secure', 'system'),
    list: leaves('global', 'secure', 'system'),
    delete: leaves('global', 'secure', 'system'),
  },
  input: {
    tap: null,
    swipe: null,
    text: null,
    keyevent: leaves(
      'KEYCODE_HOME',
      'KEYCODE_BACK',
      'KEYCODE_APP_SWITCH',
      'KEYCODE_POWER',
      'KEYCODE_WAKEUP',
      'KEYCODE_VOLUME_UP',
      'KEYCODE_VOLUME_DOWN',
      'KEYCODE_ENTER',
      'KEYCODE_MENU',
    ),
    roll: null,
    press: null,
  },
  wm: { size: leaves('reset'), density: leaves('reset'), overscan: null },
  svc: {
    wifi: leaves('enable', 'disable'),
    data: leaves('enable', 'disable'),
    bluetooth: leaves('enable', 'disable'),
    power: leaves('stayon'),
    nfc: leaves('enable', 'disable'),
  },
  cmd: {
    package: leaves('list', 'resolve-activity', 'path', 'dump'),
    notification: leaves('post', 'allow_listener'),
    wifi: leaves('status', 'list-networks', 'set-wifi-enabled'),
    activity: null,
    battery: leaves('unplug', 'reset', 'set'),
    appops: leaves('get', 'set', 'reset'),
    media_session: null,
    statusbar: leaves('expand-notifications', 'expand-settings', 'collapse'),
  },
  logcat: leaves('-d', '-c', '-v', '-s', '-b', '-t', '-e', '*:E', '*:W', '*:I'),
  screencap: leaves('-p'),
  screenrecord: leaves('--time-limit', '--size', '--bit-rate'),
  reboot: leaves('recovery', 'bootloader', 'sideload'),
  ip: { addr: null, route: null, link: null },
  ls: leaves('-l', '-la', '-a', '-R', '/sdcard', '/data/local/tmp', '/system'),
  cat: null,
  ps: leaves('-A', '-ef'),
  top: leaves('-n', '-m', '-b'),
  df: leaves('-h'),
  du: leaves('-h', '-s'),
  free: leaves('-m'),
  id: null,
  uname: leaves('-a'),
  date: null,
  uptime: null,
  whoami: null,
  netstat: leaves('-tulpn'),
  ping: leaves('-c'),
  pidof: PACKAGE,
  monkey: leaves('-p', '-v', '--throttle'),
  mkdir: leaves('-p'),
  rm: leaves('-r', '-f', '-rf'),
  cp: leaves('-r'),
  mv: null,
  chmod: null,
  find: null,
  grep: leaves('-i', '-r', '-n', '-v'),
  echo: null,
  getevent: leaves('-l', '-t'),
  sendevent: null,
  bugreport: null,
}

export type SuggestionKind = 'history' | 'command' | 'package'

export interface Suggestion {
  /** The whole command line to put in the input if this is accepted. */
  text: string
  /** What to show for it (the part being completed, or the full history line). */
  label: string
  kind: SuggestionKind
}

export interface Context {
  /** Previously run commands, most recent first. */
  history: string[]
  /** Package names on the phone (empty until loaded). */
  packages: string[]
}

const MAX_SUGGESTIONS = 8
const MAX_HISTORY = 3

/** Whether the cursor sits where a package name goes, e.g. `pm clear `. */
export function wantsPackages(input: string): boolean {
  return resolve(input).slot === 'package'
}

interface Resolved {
  /** The input before the token being completed (ends with a space, or is empty). */
  head: string
  /** The token being completed. */
  partial: string
  slot: Node | 'unknown'
}

/** Walks the command tree along the completed tokens to find what can come next. */
function resolve(input: string): Resolved {
  const lastSpace = input.search(/\S*$/)
  const head = input.slice(0, lastSpace)
  const partial = input.slice(lastSpace)
  const done = head.trim() === '' ? [] : head.trim().split(/\s+/)

  let node: Node | 'unknown' = TREE
  for (const token of done) {
    if (node === 'unknown') break
    if (node === PACKAGE) {
      node = 'unknown' // the package slot is consumed; nothing more to suggest
    } else if (node && typeof node === 'object' && Object.hasOwn(node, token)) {
      node = node[token]
    } else {
      node = 'unknown'
    }
  }
  return { head, partial, slot: node }
}

/** Suggestions for what is typed so far, best first. Empty input suggests nothing. */
export function suggest(input: string, ctx: Context): Suggestion[] {
  if (input.trim() === '') return []
  const out: Suggestion[] = []
  const seen = new Set<string>([input])
  const add = (s: Suggestion) => {
    if (!seen.has(s.text) && out.length < MAX_SUGGESTIONS) {
      seen.add(s.text)
      out.push(s)
    }
  }

  let history = 0
  for (const h of ctx.history) {
    if (history < MAX_HISTORY && h.startsWith(input)) {
      add({ text: h, label: h, kind: 'history' })
      history++
    }
  }

  const { head, partial, slot } = resolve(input)
  if (slot === PACKAGE) {
    const needle = partial.toLowerCase()
    const matches = ctx.packages.filter((p) => p.toLowerCase().includes(needle))
    // Prefix matches first, then anything containing the text.
    matches.sort((a, b) => Number(b.toLowerCase().startsWith(needle)) - Number(a.toLowerCase().startsWith(needle)))
    for (const p of matches) add({ text: head + p, label: p, kind: 'package' })
  } else if (slot && slot !== 'unknown') {
    for (const [name, child] of Object.entries(slot)) {
      if (name.startsWith(partial)) {
        add({ text: head + name + (child ? ' ' : ''), label: name, kind: 'command' })
      }
    }
  }
  return out
}
