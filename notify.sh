# Send notification
osascript -e \
    "tell application id \"com.runningwithcrayons.Alfred\" to run trigger \"timer-notification\" in workflow \"io.github.torvaney.alfred-timer\" with argument \"$1\"";

# Cleanup script by unloading the job and deleting the plist file
launchd bootout gui/$UID/$2;
rm $3;
