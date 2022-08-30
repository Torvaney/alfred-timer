import subprocess
import collections
import sys
import re
import itertools
import uuid
import pathlib
import plistlib


class TimeUnit:
    """ A simple class for creating human-readable time units. """

    def __init__(self, units: int = 1, base_unit: int = 1, label='second'):
        self.units = units
        self.base_unit = base_unit
        self.label = label

    def __repr__(self):
        plural = 's' if self.units == 1 else ''
        return f'TimeUnit(units={self.units}, base_unit={self.base_unit}{plural})'

    def __str__(self):
        pluralise = self.units != 1
        return f'{self.units} {self.label}{"s" if pluralise else ""}'

    def __call__(self, units: int = 1, label=None):
        return TimeUnit(
            units=units,
            base_unit=self.base_unit,
            label=label or self.label
        )

    def alias(self, label):
        return TimeUnit(
            units=1,
            base_unit=self.seconds,
            label=label
        )

    @property
    def seconds(self):
        return self.base_unit*self.units


class MultiDict(collections.UserDict):
    """ A constructor for dicts with redundant keys. """
    def __init__(self, *args):
        d = dict(itertools.chain(*[zip(ks, itertools.repeat(v)) for ks, v in args]))
        super().__init__(d)


Seconds = TimeUnit()
Minutes = Seconds(60).alias('minute')
Hours = Minutes(60).alias('hour')

units_lookup = MultiDict(
    ({'s', 'sec', 'secs', 'seconds'}, Seconds),
    ({'m', 'min', 'mins', 'minutes'}, Minutes),
    ({'h', 'hour', 'hours'}, Hours),
)


def parse_query(query, units=units_lookup):
    """ Parse a query string into a TimeUnit. """
    matched = re.match('(?P<value>[0-9]{1,})(?P<unit>[A-z]{1,})', query)
    if not matched:
        return None

    value = int(matched.group('value'))
    unit = units.get(matched.group('unit'))
    if not unit:
        return None

    return unit(value)


def plist_filepath(label):
    return pathlib.Path.home()/'Library'/'LaunchAgents'/f'{label}.plist'


def write_plist(path, plist):
    with open(path, 'wb') as f:
        plistlib.dump(plist, f)


def create_plist(timer, title):
    """
    Creates and saves a plist file for a given time and title.
    Returns the path to the saved file.
    """

    timer_id = uuid.uuid4()
    label = f'io.github.torvaney.alfred-timer.{timer_id}'
    filepath = plist_filepath(label)
    title_cleaned = title or ''

    # See `man launchd.plist` for details
    plist = {
        'Label': label,
        'ProgramArguments': [
            # A sub-program that
            # * Sends a notification that the timer is complete
            #   (possibly with an option to repeat?)
            # * Unloads and removes job from launchd, deletes plist
            '/bin/zsh',
            'notify.sh',
            title_cleaned,
            label,
            str(filepath),
        ],
        'StartInterval': timer.seconds,
        'WorkingDirectory': str(pathlib.Path(__file__).parent.absolute()),
        'LaunchOnlyOnce': True,
    }

    write_plist(path=filepath, plist=plist)
    return filepath


def launchctl(subcommand, *args):
    return subprocess.call(['launchctl', subcommand, *args])


if __name__ == "__main__":
    # Parse arguments
    if len(sys.argv) > 2:
        title = ' '.join(sys.argv[2:]).capitalize()
    else:
        title = None

    query = sys.argv[1]
    timer = parse_query(query)

    if timer:
        # Create and save plist, and load job with launchctl
        plist_path = create_plist(timer, title)
        launchctl('load', plist_path)

        title_fmt = f'"{title}"' if title else 'a timer'
        print(f'Successfully set {title_fmt} for {timer}', file=sys.stdout)
        sys.exit(0)

    print(f'Failed to set {title}!', file=sys.stdout)
    sys.exit(1)
