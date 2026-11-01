.PHONY: all
all: Timer.alfredworkflow

Timer.alfredworkflow: timer.js info.plist icon.png
	rm -f $@ && zip $@ $^

.PHONY: test
test:
	osascript -l JavaScript test.js

.PHONY: clean
clean:
	rm -f Timer.alfredworkflow
