# Send notification
osascript -e \
    "tell application id \"com.runningwithcrayons.Alfred\" to run trigger \"timer-notification\" in workflow \"io.github.torvaney.alfred-timer\" with argument \"$1\"";

# Cleanup script by deleting the plist file and unloading the job
rm $3;
launchctl bootout gui/$UID/$2;
