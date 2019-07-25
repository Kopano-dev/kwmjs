# CHANGELOG

## Unreleased



## v0.18.0 (2019-06-13)

- v0.18.0
- Build with Node 10
- Ignore dist files
- Ignore linter warnings for now
- Bump to 2019
- Move linting from tslint to eslint and fix linter errors
- Update dependencies
- Fixup public exports for exported fields
- Fix tsconfig linter warnings
- Add deduplicate helper
- Deduplicate dependencies
- Bump js-yaml from 3.12.2 to 3.13.1


## v0.17.1 (2019-03-06)

- Bump version to 0.17.1


## v0.17.0 (2019-03-06)

- Add source-map-explorer for easy bundle checks
- Update tslint to latest
- Add docstrings to p2p public API
- Show text type message for websocket errors
- Pass along optional kind to SDP transforms
- Cleanup logging and handle stream remove/replace
- Catch previously unhandled websocket errors
- Use data channel for kwm specific p2p protocol
- Catch unhandled exception when joining a busy group


## v0.16.0 (2019-02-15)

- Trigger connected event after receiving hello
- Support kwm auth parameter
- Prepare data channel support


## v0.15.0 (2019-02-04)

- Use profile as part of peer record when found in call message


## v0.14.0 (2019-01-21)

- Use Plan B SDP by default (Chrome)
- Emit renegotiate when not initiator but getting called
- Move built-in dependencies so they do not get installed
- Update simple-peer and dependencies to 9.2.1


## v0.13.1 (2018-12-05)

- Refactor KWM connect authentication parameters


## v0.13.0 (2018-11-14)

- Add support to set user mode
- Support replace flag in webrtc channel data
- Add pcid to webrtc signal messages
- Run lint and docs in Jenkins
- Remove obsolete unmaintained janus plugin
- Update to latest stuff, fixing Node 10 build support
- Fixup linter warnings
- Fix Edge fetch usage
- Bump KWM API default version to v2
- Add support for kwm v2 API


## v0.12.1 (2018-11-07)

- Bump version to 0.12.1
- Restore lost WeakMap before removing a track


## v0.12.0 (2018-08-13)

- Add additional fields to peer record
- Add pc.new WebRTC peer event
- Add doReject WebRTC function
- Add proper RTM WebRTC reply error handling
- Add client pipeline support


## v0.11.1 (2018-07-31)

- Bring back state validation


## v0.11.0 (2018-07-30)

- Bump version to 0.11.0
- Cleanup and update docs
- Split up WebRTC implementation
- Update dev dependencies to their latest releases
- Export Typescript typings


## v0.10.0 (2018-07-23)

- Add hints how to debug pc problems
- Add hangup peerevent


## v0.9.0 (2018-07-03)

- Add webrtc payload version
- Add support to auto restore errored peer connections


## v0.8.0 (2018-06-20)

- Bump version to 0.8.0
- Implement group obsolete peer hangup
- Add support to refresh group after reconnect
- Add WebRTC group support (full mesh)
- Fix event name


## v0.7.0 (2018-05-30)

- Bump version to 0.7.0
- Add support to use TURN server if received


## v0.6.0 (2018-05-04)

- Bump version to 0.6.0
- Use .yarninstall
- kwm: Properly keep Promise chain on reconnect
- webrtc: Avoid setting an undefined stream
- webrtc: Add support for track events
- webrtc: Add support to transform SDP
- webrtc: Avoid renego on conn destroy
- webrtc: Remove unhandleable error in incoming call
- webrtc: Trigger negotiation after removeTrack
- webrtc: Add support for add and remove track
- webrtc: Add support to set SimplePeer options
- Build dev mode without version


## v0.5.0 (2018-04-16)

- Add Jenkinsfile
- Update simple-peer to 9.0.0
- Fixup make clean target
- Update all dev dependencies to their latest
- Add URLSearchParams API
- Build as umd project
- Add proper README


## v0.4.1 (2018-01-17)

- Add release build to source tree


## v0.4.0 (2018-01-17)

- Remove the v prefix from version numbers
- Make module importable
- Add ES5 build option


## v0.3.1 (2017-10-16)

- Add ES5 build option


## v0.3.0 (2017-10-04)

- Make kwmjs a seperate project
- Add LICENSE file
- Make variables overrideable
- Build kwmjs as ES6
- Add admin API and authentication
- Avoid sending messages to closing websocket connection
- Move most debug logging to debug level
- Add build version and date to kwm.js build
- Implement automatic rtm reconnect
- Prefix kwm.js with license and build 3rdparty license file
- Change project license to MIT license
- Fix trigger of close event on server side close
- Add support to mute/unmute local stream
- Export KWM class as root of javascript module
- Implement KWM javascript client library
