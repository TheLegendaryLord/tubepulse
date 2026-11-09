# Architecture

## The local path

1. A Manifest V3 content script observes the HTML5 player and navigation on the supported YouTube origins. It sends snapshots to the extension's service worker. It does not read Chrome history or inspect other sites.
2. The service worker validates the sender and snapshot, chooses an eligible tab and applies privacy settings. Only a projected activity or an explicit clear goes to the companion. Player data lives in memory and ages out. Chrome storage persists the preferences.
3. The service worker uses `runtime.connectNative()` to `com.tubepulse.host`. Chrome checks the installed extension's origin against an exact `allowed_origins` entry in a per-user host manifest. The host independently checks the caller argument against the configured extension ID. The shared Zod schema accepts only versioned activity snapshots and a fixed status response. It rejects arbitrary URLs. Buttons and thumbnails are constructed from a validated video ID.
4. The companion updates Discord Desktop through Windows `discord-ipc-*` named pipes. It uses the configured Discord Application ID and the `SET_ACTIVITY` RPC command. Discord publishes the activity subject to its own privacy settings.

## Why Native Messaging

A loopback bridge can support several browsers but would need a listening port, a pairing or credential exchange, authenticated requests and origin checks. Chrome Native Messaging gives us an extension origin allowlist, stdio framing and a browser-managed process lifetime. There is no listener for webpages or other network clients to discover. Setup must register the host and enroll the ID of the unpacked extension. Chrome can keep an MV3 worker alive while the native port is connected. [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [MV3 worker lifetime](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

The trust boundary is the local Windows account. Programs that already control that account can alter its Chrome profile, registry or files and interact with Discord directly. In Chrome, only enroll the ID of your own TubePulse installation. Avoid running competing TubePulse instances from multiple Chrome profiles at the same time.

## Playback, reconnect and cleanup

Playback events drive video, pause, seek and rate changes. Periodic refreshes protect against missed navigation events, stale tabs and disrupted connections. Tab removal, a disabled integration or the absence of an eligible player produces an explicit clear. The companion expires activity that is no longer refreshed, retries an unavailable Discord with bounded backoff, and coalesces redundant updates. It tries to clear Discord explicitly at browser shutdown when the IPC connection is available.

Timestamps are projected from player position and playback rate and converted to the RPC representation at the Discord boundary. Discord chooses the clock format. A paused video never carries a running timestamp. Tabs with ads are excluded using player signals. YouTube controls these DOM signals and can change them independently of TubePulse.

## Discord capabilities

Discord documents token-free Rich Presence for a registered application and a running Desktop client. The RPC command supports Watching and Listening. The activity schema documents timestamps, buttons and external image URLs. Buttons and images are client-dependent and a successful RPC response alone cannot verify how a viewer's client renders the activity. [Rich Presence without authentication](https://docs.discord.com/developers/discord-social-sdk/development-guides/setting-rich-presence#rich-presence-without-authentication), [Discord RPC](https://docs.discord.com/developers/topics/rpc#set-activity), [Activity schema](https://docs.discord.com/developers/events/gateway-events#activity-object)

The companion bundles a small implementation of the local IPC framing and Rich Presence command. It does not call the Discord REST API, request OAuth scopes or inspect the Discord user's profile. The included Windows runtime and npm build dependencies are used locally. TubePulse has no backend.
