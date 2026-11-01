// A simple timer for Alfred, using launchd.
//
// Each timer is a one-off launchd job. Its plist lives in the workflow's data
// folder and doubles as the timer's state (title, duration and end time). A
// single login agent restores any timers that were pending at logout.
//
// Usage: osascript -l JavaScript timer.js <command> [query]
//
//   filter <query>  Script Filter: offer to set a timer, and list active timers
//   create          Set a timer (reads timer_seconds and timer_title)
//   cancel          Cancel a timer (reads timer_id)
//   fire            Run by launchd when a timer is up (reads timer_id)
//   restore         Run at login to reload pending timers
//
// Arguments other than the query are passed as environment variables, which
// Alfred sets from the selected item's variables, and launchd from the plist.

ObjC.import('Foundation')
ObjC.import('unistd')

const BUNDLE_ID = 'io.github.torvaney.alfred-timer'
const RESTORE_LABEL = `${BUNDLE_ID}.restore`

const fileManager = $.NSFileManager.defaultManager

// Parsing and formatting

const UNITS = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
}

function parseQuery(query) {
  // A duration is one or more <number><unit> parts (e.g. "1h30m", "10 min").
  // Everything after the duration is the title.
  const part = /^\s*(\d+(?:\.\d+)?)\s*([a-z]+)/i
  let rest = query
  let seconds = 0
  let matched
  while ((matched = rest.match(part)) && UNITS[matched[2].toLowerCase()]) {
    seconds += Number(matched[1]) * UNITS[matched[2].toLowerCase()]
    rest = rest.slice(matched[0].length)
  }

  seconds = Math.round(seconds)
  if (seconds < 1) {
    return null
  }

  const title = rest.trim()
  return { seconds, title: title.charAt(0).toUpperCase() + title.slice(1) }
}

function formatDuration(seconds) {
  const plural = (n, label) => `${n} ${label}${n === 1 ? '' : 's'}`
  const parts = [
    [Math.floor(seconds / 3600), 'hour'],
    [Math.floor(seconds % 3600 / 60), 'minute'],
    [seconds % 60, 'second'],
  ]
  return parts.filter(([n]) => n > 0).map(([n, label]) => plural(n, label)).join(' ')
}

function formatRemaining(milliseconds) {
  const seconds = Math.ceil(milliseconds / 1000)
  const pad = n => String(n).padStart(2, '0')
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60]
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function formatClock(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function describe(timer) {
  return timer.title || formatDuration(timer.seconds)
}

// Files and processes

function env(name) {
  const value = $.NSProcessInfo.processInfo.environment.objectForKey(name)
  return value.isNil() ? undefined : value.js
}

function dataDir() {
  return env('alfred_workflow_data')
    || `${$.NSHomeDirectory().js}/Library/Application Support/Alfred/Workflow Data/${BUNDLE_ID}`
}

function timersDir() {
  return `${dataDir()}/timers`
}

function readFile(path) {
  const contents = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null)
  return contents.isNil() ? undefined : contents.js
}

function writeFile(path, contents) {
  $(contents).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null)
}

function removeFile(path) {
  fileManager.removeItemAtPathError(path, null)
}

function listDir(path) {
  const names = fileManager.contentsOfDirectoryAtPathError(path, null)
  return names.isNil() ? [] : names.js.map(name => name.js)
}

function makeDir(path) {
  fileManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(path, true, $(), null)
}

function toObjC(value) {
  // Explicit conversion, so that launchd gets <integer> and <true/> rather than <real>
  if (Number.isInteger(value)) return $.NSNumber.numberWithInteger(value)
  if (typeof value === 'boolean') return $.NSNumber.numberWithBool(value)
  if (Array.isArray(value)) return $(value.map(toObjC))
  if (typeof value === 'object') {
    const dict = $.NSMutableDictionary.dictionary
    Object.entries(value).forEach(([key, v]) => dict.setObjectForKey(toObjC(v), key))
    return dict
  }
  return $(value)
}

function readPlist(path) {
  return ObjC.deepUnwrap($.NSDictionary.dictionaryWithContentsOfFile(path))
}

function writePlist(path, plist) {
  toObjC(plist).writeToFileAtomically(path, true)
}

function exec(path, ...args) {
  const task = $.NSTask.alloc.init
  task.executableURL = $.NSURL.fileURLWithPath(path)
  task.arguments = $(args)
  task.standardOutput = $.NSFileHandle.fileHandleWithNullDevice
  task.standardError = $.NSFileHandle.fileHandleWithNullDevice
  if (!task.launchAndReturnError(null)) {
    return -1
  }
  task.waitUntilExit
  return task.terminationStatus
}

function launchctl(...args) {
  return exec('/bin/launchctl', ...args)
}

function domain() {
  return `gui/${$.getuid()}`
}

// Timers

function jobLabel(id) {
  return `${BUNDLE_ID}.timer.${id}`
}

function jobPath(id) {
  return `${timersDir()}/${jobLabel(id)}.plist`
}

function readTimer(path) {
  const plist = readPlist(path)
  if (!plist) {
    return null
  }

  const vars = plist.EnvironmentVariables
  return {
    id: vars.timer_id,
    title: vars.timer_title,
    seconds: Number(vars.timer_seconds),
    end: Number(vars.timer_end),
  }
}

function activeTimers() {
  return listDir(timersDir())
    .filter(name => name.endsWith('.plist'))
    .map(name => readTimer(`${timersDir()}/${name}`))
    .filter(timer => timer)
    .sort((a, b) => a.end - b.end)
}

function loadJob(timer, interval) {
  // See `man launchd.plist` for details
  writePlist(jobPath(timer.id), {
    Label: jobLabel(timer.id),
    ProgramArguments: ['/usr/bin/osascript', '-l', 'JavaScript', `${dataDir()}/timer.js`, 'fire'],
    EnvironmentVariables: {
      alfred_workflow_data: dataDir(),
      timer_id: timer.id,
      timer_title: timer.title,
      timer_seconds: String(timer.seconds),
      timer_end: String(timer.end),
    },
    StartInterval: interval,
    LaunchOnlyOnce: true,
  })
  return launchctl('bootstrap', domain(), jobPath(timer.id)) === 0
}

function unloadJob(id) {
  // Stops the job's process, so when a timer fires this must come last
  launchctl('bootout', `${domain()}/${jobLabel(id)}`)
}

function installScript() {
  // launchd runs a copy of this script from the data folder, since the workflow
  // itself may be in a folder that launchd jobs can't read (e.g. ~/Documents)
  const [, , , script] = $.NSProcessInfo.processInfo.arguments.js.map(arg => arg.js)
  const source = readFile(script.startsWith('/') ? script : `${fileManager.currentDirectoryPath.js}/${script}`)
  const target = `${dataDir()}/timer.js`
  if (readFile(target) !== source) {
    writeFile(target, source)
  }
}

function installRestoreAgent() {
  const path = `${$.NSHomeDirectory().js}/Library/LaunchAgents/${RESTORE_LABEL}.plist`
  const programArguments = ['/usr/bin/osascript', '-l', 'JavaScript', `${dataDir()}/timer.js`, 'restore']

  // Only write when changed, as macOS notifies the user about new login items
  const existing = readPlist(path)
  if (existing && JSON.stringify(existing.ProgramArguments) === JSON.stringify(programArguments)) {
    return
  }

  writePlist(path, {
    Label: RESTORE_LABEL,
    ProgramArguments: programArguments,
    EnvironmentVariables: { alfred_workflow_data: dataDir() },
    RunAtLoad: true,
  })
}

function notify(text) {
  Application('com.runningwithcrayons.Alfred').runTrigger('timer-notification', {
    inWorkflow: BUNDLE_ID,
    withArgument: text,
  })
}

// Commands

function filter(query) {
  const items = []

  if (query.trim()) {
    const parsed = parseQuery(query)
    if (parsed) {
      const duration = formatDuration(parsed.seconds)
      items.push({
        title: parsed.title ? `Set "${parsed.title}" for ${duration}` : `Set a timer for ${duration}`,
        subtitle: `Ends at ${formatClock(Date.now() + parsed.seconds * 1000)}`,
        arg: 'create',
        variables: { timer_seconds: String(parsed.seconds), timer_title: parsed.title },
      })
    } else {
      items.push({
        title: 'Invalid timer',
        subtitle: 'Try "10s", "5m tea" or "1h30m bake bread"',
        valid: false,
      })
    }
  }

  const now = Date.now()
  for (const timer of activeTimers()) {
    const finished = timer.end <= now
    items.push({
      title: `${describe(timer)} · ${finished ? 'finished' : `${formatRemaining(timer.end - now)} left`}`,
      subtitle: finished
        ? `Finished at ${formatClock(timer.end)} · ⏎ to clear`
        : `Ends at ${formatClock(timer.end)} · ⏎ to cancel`,
      arg: 'cancel',
      variables: { timer_id: timer.id },
    })
  }

  if (!items.length) {
    items.push({
      title: 'No active timers',
      subtitle: 'Type a duration to set a timer, e.g. "timer 5m tea"',
      valid: false,
    })
  }

  return JSON.stringify({ rerun: 1, items })
}

function create() {
  const seconds = Number(env('timer_seconds'))
  const timer = {
    id: $.NSUUID.UUID.UUIDString.js.toLowerCase(),
    title: env('timer_title') || '',
    seconds,
    end: Date.now() + seconds * 1000,
  }

  makeDir(timersDir())
  installScript()
  installRestoreAgent()

  const name = timer.title ? `"${timer.title}"` : 'a timer'
  if (!loadJob(timer, seconds)) {
    removeFile(jobPath(timer.id))
    return `Failed to set ${name}!`
  }
  return `Set ${name} for ${formatDuration(seconds)}`
}

function cancel() {
  const id = env('timer_id')
  const timer = readTimer(jobPath(id))
  removeFile(jobPath(id))
  unloadJob(id)
  return timer ? `Cancelled ${describe(timer)}` : 'Timer already finished'
}

function fire() {
  const id = env('timer_id')
  const timer = readTimer(jobPath(id))
  if (timer) {
    notify(describe(timer))
    removeFile(jobPath(id))
  }
  unloadJob(id)
}

function restore() {
  for (const timer of activeTimers()) {
    const remaining = Math.ceil((timer.end - Date.now()) / 1000)
    if (remaining > 0) {
      unloadJob(timer.id)
      loadJob(timer, remaining)
    } else {
      notify(`${describe(timer)} (finished at ${formatClock(timer.end)})`)
      removeFile(jobPath(timer.id))
    }
  }
}

function run(argv) {
  const [command, query = ''] = argv
  switch (command) {
    case 'filter': return filter(query)
    case 'create': return create()
    case 'cancel': return cancel()
    case 'fire': return fire()
    case 'restore': return restore()
  }
}
