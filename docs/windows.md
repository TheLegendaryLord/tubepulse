# TubePulse on Windows

Use Windows 10 or 11 x64, Google Chrome and Discord Desktop. The ZIP includes the companion runtime. Chrome starts the companion when the extension connects.

## Install

1. Download the Windows x64 ZIP and extract all files to a folder. To check the archive, run `Get-FileHash .\TubePulse-0.1.1-windows-x64.zip -Algorithm SHA256` and compare the hash with the accompanying `.sha256` file.
2. In the [Discord Developer Portal](https://discord.com/developers/applications), create a new application named **TubePulse**. Copy its **Application ID** from **General Information**. This ID is public. TubePulse uses only that ID.
3. Open PowerShell in the extracted folder. Run the following command and paste the Application ID at the prompt.

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1
   ```

4. When the script asks for the extension ID, leave it running. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `%LOCALAPPDATA%\TubePulse\extension`. Copy the ID on the TubePulse card into PowerShell. Use the extension folder printed by the script if the folder picker does not expand `%LOCALAPPDATA%`.
5. Reload the TubePulse card after setup registers the companion, then pin TubePulse using Chrome's Extensions menu. Open the popup, choose what to share and turn TubePulse on. Play a YouTube video and check the connection status.
6. In Discord Desktop, turn on activity sharing under **User Settings → Activity Privacy**. Check the activity on your Discord profile.

`-ExecutionPolicy Bypass` applies to that PowerShell process. Setup installs to the current user's local app data and registers exactly the extension origin you entered in the current user's Chrome Native Messaging registry key.

## Change settings or upgrade

Exit Chrome using **⋮ → Exit** before running a newer ZIP's `Install.ps1`. The installer reuses the existing IDs and extension path. Reopen Chrome and reload TubePulse on `chrome://extensions` after setup. To replace either ID, add `-DiscordApplicationId` or `-ExtensionId` with the new value when invoking the script. You can pass both flags for a noninteractive setup when you already know both IDs.

For optional Windows sign-in startup, pass `-LaunchChromeAtSignIn`. This creates a per-user startup entry for Chrome's background mode. TubePulse still follows the extension's own enabled state and starts when Chrome connects. To remove this startup entry, run the following in PowerShell from the extracted ZIP folder.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '.\Install.ps1 -LaunchChromeAtSignIn:$false'
```

## Troubleshooting

- **Companion disconnected.** Check the extension ID against `extensionId` in `%LOCALAPPDATA%\TubePulse\config.json`. Rerun setup with the correct ID and reload the extension. A managed Chrome policy may restrict unpacked extensions or native messaging. Check `chrome://policy` if this computer is managed.
- **Discord disconnected.** Open Discord Desktop and wait for the next reconnect attempt. Verify that the configured Application ID is the ID from your Developer Portal application. The Discord web app has no local IPC endpoint.
- **Connected without visible activity.** Enable Discord activity sharing and play a YouTube video. Check TubePulse's master switch and playback/privacy settings in the popup.
- **TubePulse is still running during setup.** Exit Chrome completely, including any background process. The companion stops with its native messaging connection.

## Uninstall

Remove TubePulse from `chrome://extensions` to erase the extension's local settings. Exit Chrome, open PowerShell outside the installed TubePulse directory and run the following command. This removes the companion, its configuration, its native host registration and its optional sign-in entry. The original downloaded ZIP and the Discord application you created can be deleted separately.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\TubePulse\Uninstall.ps1"
```

## Build the ZIP from source

Use the official Windows x64 portable ZIP distribution of [Node.js 24 LTS](https://nodejs.org/en/download), with its `LICENSE` next to `node.exe`. Put that directory first on `PATH`, then run the following commands in the repository root.

```powershell
npm.cmd ci
npm.cmd run package:windows
```

The archive and SHA-256 checksum appear in `artifacts`. The ZIP uses a fixed entry order and timestamps. Use the same Node.js patch release, dependency lockfile and Windows PowerShell version to reproduce a build. The companion is an unsigned Node.js single executable. Packaging can print a warning about the original Node signature when the embedded application is injected. [Node.js single-executable build procedure](https://nodejs.org/download/release/v24.22.2/docs/api/single-executable-applications.html)
