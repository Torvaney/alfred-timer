// Tests for parsing and formatting in timer.js
//
// Usage: osascript -l JavaScript test.js

ObjC.import('Foundation')

const PARSE_CASES = [
  // Units
  ['10s', { seconds: 10, title: '' }],
  ['5m', { seconds: 300, title: '' }],
  ['2h', { seconds: 7200, title: '' }],
  ['1sec', { seconds: 1, title: '' }],
  ['1second', { seconds: 1, title: '' }],
  ['30secs', { seconds: 30, title: '' }],
  ['1min', { seconds: 60, title: '' }],
  ['1minute', { seconds: 60, title: '' }],
  ['5mins', { seconds: 300, title: '' }],
  ['1hr', { seconds: 3600, title: '' }],
  ['2hrs', { seconds: 7200, title: '' }],
  ['1hour', { seconds: 3600, title: '' }],
  ['5M', { seconds: 300, title: '' }],
  ['2Hours', { seconds: 7200, title: '' }],

  // Spacing
  ['10 min', { seconds: 600, title: '' }],
  ['  5m   tea  ', { seconds: 300, title: 'Tea' }],

  // Compound and fractional durations
  ['3m30s', { seconds: 210, title: '' }],
  ['1h30m', { seconds: 5400, title: '' }],
  ['1h 30m 15s', { seconds: 5415, title: '' }],
  ['1.5h', { seconds: 5400, title: '' }],
  ['0.5m', { seconds: 30, title: '' }],

  // Titles
  ['5m tea', { seconds: 300, title: 'Tea' }],
  ['1h30m bake bread', { seconds: 5400, title: 'Bake bread' }],
  ['10 min call Bob re PR', { seconds: 600, title: 'Call Bob re PR' }],
  ['2 hours 2pm meeting', { seconds: 7200, title: '2pm meeting' }],
  ['5m say "hi" & *', { seconds: 300, title: 'Say "hi" & *' }],

  // Invalid
  ['', null],
  ['tea', null],
  ['5', null],
  ['5 tea', null],
  ['5mtea', null],
  ['0s', null],
  ['0.4s', null],
  ['-5m', null],
]

const DURATION_CASES = [
  [1, '1 second'],
  [10, '10 seconds'],
  [60, '1 minute'],
  [210, '3 minutes 30 seconds'],
  [3600, '1 hour'],
  [3661, '1 hour 1 minute 1 second'],
  [5400, '1 hour 30 minutes'],
  [7200, '2 hours'],
]

const REMAINING_CASES = [
  [1, '0:01'],
  [1500, '0:02'],
  [59000, '0:59'],
  [61000, '1:01'],
  [3600000, '1:00:00'],
  [3723000, '1:02:03'],
]

function run() {
  // timer.js has no module system, so load its functions into this scope
  eval($.NSString.stringWithContentsOfFileEncodingError('timer.js', $.NSUTF8StringEncoding, null).js)

  const suites = [
    ['parseQuery', parseQuery, PARSE_CASES],
    ['formatDuration', formatDuration, DURATION_CASES],
    ['formatRemaining', formatRemaining, REMAINING_CASES],
  ]

  let passed = 0
  const failures = []
  for (const [name, fn, cases] of suites) {
    for (const [input, expected] of cases) {
      const actual = fn(input)
      if (JSON.stringify(actual) === JSON.stringify(expected)) {
        passed++
      } else {
        failures.push(`${name}(${JSON.stringify(input)}): expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
      }
    }
  }

  if (failures.length) {
    throw new Error(`${failures.length} failed, ${passed} passed\n${failures.join('\n')}`)
  }
  return `${passed} passed`
}
