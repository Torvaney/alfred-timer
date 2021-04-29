import collections
import sys
import time
import re
import typing
import itertools


class TimeUnit:
    """ A simple class for creating human-readable time units. """

    def __init__(self, units: int = 1, base_unit: int = 1, label='second'):
        self.units = units
        self.base_unit = base_unit
        self.label = label

    def __repr__(self):
        return f'TimeUnit(units={self.units}, base_unit={self.base_unit}s)'

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
            base_unit=self.to_seconds(),
            label=label
        )

    def to_seconds(self):
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


if __name__ == "__main__":
    # Parse arguments
    if len(sys.argv) > 2:
        title = '"' + ' '.join(sys.argv[2:]).capitalize() + '"'
    else:
        title = 'Timer'

    query = sys.argv[1]
    timer = parse_query(query)

    if timer:
        # Sleep for time
        time.sleep(timer.to_seconds())

        msg = f'{title} complete after {timer}'
        print(msg)
