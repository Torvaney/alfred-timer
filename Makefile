.PHONY: all
all: Timer.alfredworkflow

Timer.alfredworkflow: timer.py notify.sh info.plist icon.png
	zip Timer.alfredworkflow timer.py notify.sh info.plist icon.png

.PHONY: clean
clean:
	rm -f Timer.alfredworkflow
