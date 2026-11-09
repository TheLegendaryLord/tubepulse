# Validation checklist

Automated checks exercise playback and tab selection logic, settings and privacy projection, native message validation, and companion behavior with a controlled IPC peer. CI runs the checks and builds a Windows x64 ZIP. A mock peer proves transport and state transitions. Confirm actual Discord rendering separately.

## Windows and Chrome smoke test

1. Install the ZIP under a non-admin Windows account using a current Chrome and the Discord Desktop client. Load the extension from the installed folder and enroll its actual ID.
2. Play a regular public video. Verify the popup reflects playback and both connections. Verify a second account sees the expected Discord activity, title, channel and button. Check that the thumbnail resolves.
3. Seek and change playback speed. Compare the clock in Discord to the player. Pause with paused activity enabled, then test the timeout and the disabled setting. Resume.
4. Navigate to a different video by clicking within YouTube. Check an autoplay playlist transition and a Short. Test YouTube Music with its toggle both off and on. During an ad, verify that the ad's title and link never replace the selected video.
5. Open two eligible tabs, switch focus, and pause or close the selected tab. Close all playback tabs. Check that Discord updates or clears as appropriate.
6. Start playback with Discord closed, then launch Discord. Restart Discord while a video is playing. Confirm the activity returns. Close Chrome and check that the activity disappears.
7. While playing, enable privacy mode and check that the viewer loses the identifying details, thumbnail, link and clock. Turn the master switch off and verify the activity clears.
8. Remove the extension and run the uninstaller. Confirm that the program files and per-user registration are removed.

Before creating a GitHub release, record what was tested with the actual apps, list any limitations, and verify the ZIP checksum and installation path. A Windows CI build can be used for development validation while client rendering checks are pending.
