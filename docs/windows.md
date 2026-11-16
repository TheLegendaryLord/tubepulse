# TubePulse on Windows

Use Windows 10 or 11 x64, Google Chrome and Discord Desktop. The standard ZIP includes the companion runtime. Choose Windows Lite if you already have Node.js 22 (22.13 or newer) or Node.js 24 installed. Chrome starts the companion when the extension connects.

## Install

1. Download a Windows ZIP and extract all files to a folder. To verify the download, run `Get-FileHash` with the archive path and compare the result with the accompanying `.sha256` file.
2. Double-click `Install.cmd` in the extracted folder. To launch setup from PowerShell, run the following command from that same folder.

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1
   ```

3. Leave setup open when it asks for the extension ID. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `%LOCALAPPDATA%\TubePulse\extension`. Copy the ID on the TubePulse card into the setup window. Use the full folder path printed by setup if needed.
4. Reload the TubePulse card after setup registers the companion, then pin TubePulse using Chrome's Extensions menu. Open the popup, choose what to share and turn TubePulse on. Play a YouTube video and check the connection status.
5. In Discord Desktop, turn on activity sharing under **User Settings → Activity Privacy**. Check the activity on your Discord profile.

`-ExecutionPolicy Bypass` applies to that PowerShell process. Setup installs to the current user's local app data and registers exactly the extension origin you entered in the current user's Chrome Native Messaging registry key. Fresh installs use TubePulse's public Discord Application ID. To use your own application, copy its ID from **General Information** in the Developer Portal and pass `-DiscordApplicationId YOUR_ID` to `Install.ps1`. [Discord Developer Portal](https://discord.com/developers/applications)

## Change settings or upgrade

Exit Chrome using **⋮ → Exit** before running a newer ZIP's `Install.cmd`. The installer reuses the existing IDs and extension path. Reopen Chrome and reload TubePulse on `chrome://extensions` after setup. To replace either ID, invoke `Install.ps1` directly with `-DiscordApplicationId` or `-ExtensionId`. Passing `-ExtensionId` supplies the only required input for a noninteractive fresh install.

You can switch between standard and Lite by running setup from the other ZIP. Lite looks up the existing Node.js executable during setup and saves its absolute path. Use `-NodePath 'C:\path\to\node.exe'` to select a specific Node.js executable. Rerun setup if Node.js moves.

For optional Windows sign-in startup, pass `-LaunchChromeAtSignIn`. This creates a per-user startup entry for Chrome's background mode. TubePulse still follows the extension's own enabled state and starts when Chrome connects. To remove this startup entry, run the following in PowerShell from the extracted ZIP folder.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '.\Install.ps1 -LaunchChromeAtSignIn:$false'
```

## Troubleshooting

- **Companion disconnected.** Check the extension ID against `extensionId` in `%LOCALAPPDATA%\TubePulse\config.json`. Rerun setup with the correct ID and reload the extension. A managed Chrome policy may restrict unpacked extensions or native messaging. Check `chrome://policy` if this computer is managed.
- **Discord disconnected.** Open Discord Desktop and wait for the next reconnect attempt. If you configured your own Application ID, verify it in the Developer Portal. Use Discord Desktop for local IPC.
- **Lite companion disconnected after moving Node.js.** Run setup again. If Node.js is installed outside `PATH`, pass `-NodePath` with its new absolute path to `Install.ps1`.
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
npm.cmd run package:windows:lite
```

The archives and SHA-256 checksums appear in `artifacts`. ZIP entries have fixed order and timestamps. The standard package uses an unsigned Node.js single executable. Packaging can print a warning about the original Node signature when the embedded application is injected. Lite builds its launcher using the .NET Framework C# compiler included with Windows. [Node.js single-executable build procedure](https://nodejs.org/download/release/v24.22.2/docs/api/single-executable-applications.html)
