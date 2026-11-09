# TubePulse privacy policy

TubePulse uses your current YouTube playback to show the activity you choose to share through Discord Desktop. The TubePulse project has no backend, ads, analytics, or telemetry.

When you enable sharing, the Chrome extension reads playback on supported YouTube, YouTube Shorts, and YouTube Music pages. It processes the current video identifier, title, channel or artist, and playback state, position, speed, and duration. The extension uses these values to select an active player and prepare a Rich Presence update. Current playback information is held in memory and expires when the player disappears or the session ends. TubePulse does not read your Chrome browsing history, account credentials, or activity on other sites.

The extension sends the presence fields you choose to the Windows companion over Chrome Native Messaging. The companion passes them to Discord Desktop through a local named pipe. Discord can display the activity to other users according to your Discord settings. If you enable thumbnails, Discord can fetch the corresponding image from YouTube's image service. If you enable the video link, viewers can open the video on YouTube. Discord handles received activity under its own privacy policy. [Discord privacy policy](https://discord.com/privacy)

You can turn off sharing in the TubePulse popup or enable Privacy mode to send generic activity without a title, channel, video link, thumbnail, or playback timestamps. The extension stores your preferences in Chrome's local storage. The companion stores the Chrome extension ID and Discord Application ID on your device for setup. Removing the extension clears its preferences. The Windows uninstaller removes the companion and its configuration. [Windows uninstallation instructions](windows.md#uninstall)

TubePulse's use of information from Google APIs adheres to the Chrome Web Store User Data Policy, including its Limited Use requirements. [Chrome Web Store Limited Use policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use)

For questions about this policy, contact the TubePulse maintainers through the project repository. [TubePulse support](https://github.com/TheLegendaryLord/tubepulse/issues)
