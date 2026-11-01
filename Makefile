.PHONY: all
all: Timer.alfredworkflow

Timer.alfredworkflow: timer.js menubar info.plist icon.png
	rm -f $@ && zip $@ $^

menubar: menubar.swift
	swiftc -O -o $@ $<

.PHONY: test
test:
	osascript -l JavaScript test.js

.PHONY: clean
clean:
	rm -f Timer.alfredworkflow menubar

# Bump the workflow's version (major.minor.patch) in info.plist
.PHONY: bump-major bump-minor bump-patch
bump-major bump-minor bump-patch:
	@old=$$(plutil -extract version raw info.plist); \
	new=$$(echo "$$old" | awk -F. -v part=$(@:bump-%=%) '{ \
		major = $$1 + 0; minor = $$2 + 0; patch = $$3 + 0; \
		if (part == "major") { major++; minor = 0; patch = 0 } \
		else if (part == "minor") { minor++; patch = 0 } \
		else { patch++ } \
		print major "." minor "." patch }'); \
	plutil -replace version -string "$$new" info.plist && echo "$$old → $$new"
