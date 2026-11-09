# TubePulse on the Chrome Web Store

TubePulse is a Manifest V3 Chrome extension for Windows 10 and 11 x64. It reads playback on YouTube and uses a separately installed Windows companion to update Rich Presence in Discord Desktop.

## Build the extension ZIP

From the repository root on Windows, run the following commands with Node.js and npm available.

```powershell
npm.cmd ci
npm.cmd run package:chrome
```

Upload `artifacts/TubePulse-<version>-chrome.zip`. The version comes from the extension manifest. `manifest.json` is at the root of the ZIP, alongside the scripts, popup, icons, and license notices. The companion is distributed separately in the Windows ZIP. Increase the manifest version for subsequent Store updates. [Google's extension packaging instructions](https://developer.chrome.com/docs/webstore/prepare)

## Prepare the listing

Register a Chrome Web Store developer account, accept the developer agreement, and pay Google's one-time registration fee. Google requires 2-Step Verification before publishing. Upload the extension ZIP as a new item in the developer dashboard. [Developer registration](https://developer.chrome.com/docs/webstore/register) · [Publishing guide](https://developer.chrome.com/docs/webstore/publish)

Use the 128×128 PNG from the extension for the store icon and include at least one 1280×800 screenshot of the extension in use. The description should state that it requires the Windows companion and Discord Desktop. [Store listing requirements](https://developer.chrome.com/docs/webstore/cws-dashboard-listing#graphic-assets)

Suggested listing description

> Share your current YouTube playback as Discord Rich Presence. Choose whether to show the video title, channel, progress, thumbnail, and link, or use Privacy mode to show generic activity. Supports YouTube videos, Shorts, and optional YouTube Music. Requires Windows 10 or 11 x64, Discord Desktop, and the free TubePulse companion available from the project's GitHub Releases page.

Use the public [TubePulse privacy policy](https://github.com/TheLegendaryLord/tubepulse/blob/main/docs/privacy.md) in the dashboard. Disclose the use of playback data from YouTube pages and the transfer of selected presence fields to Discord. The `storage` permission saves sharing preferences locally. The `nativeMessaging` permission connects to the TubePulse companion on the same device. Access to YouTube and YouTube Music lets the extension read the player for the requested presence feature. Chrome's policy covers locally processed data and exempts communication between an extension and a native program on the same computer from the encryption requirement. [Privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) · [User Data Policy FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

Include the companion download, setup instructions, and a playback test in the review notes. Install the extension in a fresh Chrome profile to verify that it explains what it shares before the user enables sharing. [Disclosure requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)

## Pair the Store extension with the companion

Once the Store assigns the extension an ID, use that ID for the Windows companion. The Store item URL and developer dashboard show it. A previously installed unpacked copy has a different ID. Remove the unpacked copy when switching to the Store edition, then exit Chrome before reinstalling the companion.

1. Install the TubePulse extension from the Chrome Web Store.
2. Download and extract the [Windows companion ZIP](https://github.com/TheLegendaryLord/tubepulse/releases) and open PowerShell in the extracted folder.
3. Substitute the Store extension's 32-character ID in the following command. Setup prompts for the Discord Application ID on a fresh installation.

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1 -ExtensionId '<extension-id>'
   ```

4. Open Chrome and Discord Desktop. Enable sharing in the TubePulse popup and play a YouTube video. The popup reports whether the companion connected and whether Discord Desktop accepted the update.

The installer registers exactly the Store extension's origin for Native Messaging. The companion checks that origin again when Chrome starts it. [Windows setup guide](windows.md) · [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
