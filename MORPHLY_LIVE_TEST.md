# Morphly live output test — September 8, 2026

One user-approved test was performed in the installed Windows CALL ME application at `http://localhost:5173`. The selected input was the physical HP HD Camera. The requested Morphly session limit was 30 seconds. No replacement session was created.

## Observations

| Check | Observed result |
| --- | --- |
| Updated desktop origin | Localhost build installed and running |
| Database migration | Rate-limit table and function visible in the app's database API |
| Camera capture | Live, enabled, unmuted 1280 × 720 video; decoded input frames increased continuously |
| Session creation | Exactly one token request; HTTP 201 at approximately 6.9 seconds after Start |
| WebRTC | ICE and peer connection reached connected at approximately 10.8 seconds |
| Outbound video | RTP video counters increased; observed streams reached 209,195 and 144,604 bytes sent |
| Incoming video | No inbound video RTP statistics appeared on the observed peer connections |
| Output element | No MediaStream video track, zero decoded frames, no HTML media error |
| SDK output element | No additional remote video element was present during the sampled interval |
| Morphly heartbeats | HTTP 200 |
| Stop | Stop invoked at approximately 28.0 seconds after Start; local video tracks absent by the 30-second sample |
| Stop confirmation | Morphly stop HTTP 200 at approximately 31.0 seconds; app cleanup HTTP 200 at approximately 33.2 seconds |
| Final UI | Idle; Start enabled and Stop disabled |

The final billing display did not report charged credits or billable seconds, so this test does not establish the final charge or settlement. No credentials, connection tokens, camera images, or raw network response bodies were saved in the diagnostic report.

## Interpretation

The camera captured video, session creation succeeded, and a WebRTC connection sent video. The app did not receive a remote output video track during the test. This is not evidence of a blocked `video.play()` call: there was no output track to play.

The failure is narrowed to the remote generation/subscription path. These client observations cannot distinguish Morphly failing to publish generated video from a hosted SDK subscription problem or an inbound media transport issue. The app's first-frame timeout detects the absence of output; extending it alone is not a confirmed fix. The test was stopped at the approved deadline rather than allowing additional paid retries.

The installed app also selected SplitCam by default after restart. The test explicitly selected HP HD Camera, so that default did not account for this test's missing remote output. Select the physical camera again before any further user-run test.

## Message to Morphly support

Our Electron application uses the current hosted Morphly SDK, a complete metered REST session response, and localhost origin. On September 8, 2026, one 30-second-limited session returned HTTP 201. Camera input was live at 1280 × 720, ICE and peer connection reached connected, and outbound video RTP bytes/frames increased. Heartbeats returned HTTP 200. No inbound video RTP stream or remote output video track was observed. Stop returned HTTP 200. Please check generation startup and remote publication/subscription for the workspace's corresponding session, including compatibility of the current hosted SDK's remote-stream callback. We have not changed or decoded any opaque credentials.

Use the Morphly dashboard's session record to identify this test when contacting support. Do not send permanent API keys or session credentials. This message has not been sent automatically.
