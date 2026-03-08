# Session Desktop & Library

## Slop Fork!!

This is a fork of Session Desktop with an added build to produce a library to run the desktop headless. For use by the claws of the world. Used AI to help separate frontend from backend with minimal changes to the core desktop app portion. Most UI and app logic is already nicely decoupled but hit a few snags that took more changes to desktop app then I liked.

https://github.com/BonesGit/session-desktop-library  
npm package: @bonesgit/session-desktop-library

### Release Notes
- **v0.1.6** - fixed quoted replies
- **v0.1.5** - first build that works without pulling in all the UI dependencies.

### TODO
- Still to many changes to the core desktop app code. To much coupling between frontend and backend code that needed tweaking to just get something working. Needs better architecture so I can touch less desktop app code.

### Client Features

- Account management — generate mnemonic, create new account, restore from mnemonic, get Session ID
- 1:1 messaging — send text messages to any Session ID
- Receive messages — real-time async iterator stream (for await (const msg of client.messages()))
- Group chats (GroupV2) — create groups, send messages, add/remove members, leave groups
- Conversation history — list all conversations, fetch message history with pagination
- Attachments — send files/images with messages; download and decrypt received attachments
- Quoted replies — send messages quoting a prior message
- Linked device sync — group creation pushes config to user's own swarm so other devices see it
- Typing Indicator - Can set whether or not the user is typing, to show the typing indicator
- Contact management — accept contact requests, block/unblock contacts <span style="color:red">__(untested)__</span>
- Conversation updates — real-time async iterator stream for metadata changes <span style="color:red">__(untested)__</span>
- Profile — set display name <span style="color:red">__(untested)__</span>
- Disappearing messages — send with configurable expiry timer <span style="color:red">__(untested)__</span>

[SKILL.md](client/SKILL.md)  
[See API docs](client/SKILL.md#messaging)  
[SessionClient source](client/SessionClient.ts)  

### Desktop Project Updates

- New `build:lib` build target.
- New `dist-lib` output folder.
- New integration tests for the library.
- __Electron API__ - Prevents bundling Electron in library builds. See `ts/node/dbVacuumManager.ts`, `ts/node/sql.ts` and `ts/session/apis/seed_node_api/SeedNodeAPI.ts`
- __IPC / Attachment Path__ - Direct file access or parameter passing instead of IPC. Explicit paths instead of Electron app paths. `ts/types/MessageAttachment.ts`
- __Worker compatibility:__ Support for both Node.js worker_threads and browser Web Workers. See `ts/webworker/`
- Many more I can't list here - needs refactoring

## Summary

Session integrates directly with [Oxen Service Nodes](https://docs.oxen.io/about-the-oxen-blockchain/oxen-service-nodes), which are a set of distributed, decentralized and Sybil resistant nodes. Service Nodes act as servers which store messages offline, and a set of nodes which allow for onion routing functionality obfuscating users IP Addresses. For a full understanding of how Session works, read the [Session Whitepaper](https://getsession.org/whitepaper).

<br/>
<br/>
<img src="https://i.imgur.com/ydVhH00.png" alt="Screenshot of Session Desktop" />

## Want to Contribute? Found a Bug or Have a feature request?

Please search for any [existing issues](https://github.com/session-foundation/session-desktop/issues) that describe your bug or feature request to avoid duplicate submissions.

Submissions can be made by making a pull request to our development branch.If you don't know where to start contributing please read [Contributing.md](CONTRIBUTING.md) and refer to issues tagged with the [good-first-issue](https://github.com/session-foundation/session-desktop/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22) tag.

## Supported platforms

Check Session's system requirements and what platforms are supported [here](https://github.com/session-foundation/session-desktop/releases/latest#user-content-supported-platforms).

## Build instructions

Build instructions can be found in [Contributing.md](CONTRIBUTING.md).

## Translations

Want to help us translate Session into your language? You can do so at https://getsession.org/translate!

## Verifying signatures

**Step 1:**

Add Jason's GPG key. Jason Rhinelander, a member of the [Session Technology Foundation](https://session.foundation/) and is the current signer for all Session Desktop releases. His GPG key can be found on his GitHub and other sources.

```sh
wget https://github.com/jagerman.gpg
gpg --import jagerman.gpg
```

**Step 2:**

Get the signed hashes for this release. `SESSION_VERSION` needs to be updated for the release you want to verify.

```sh
export SESSION_VERSION=1.15.0
wget https://github.com/session-foundation/session-desktop/releases/download/v$SESSION_VERSION/signature.asc
```

**Step 3:**

Verify the signature of the hashes of the files.

```sh
gpg --verify signature.asc 2>&1 |grep "Good signature from"
```

The command above should print "`Good signature from "Jason Rhinelander...`". If it does, the hashes are valid but we still have to make the sure the signed hashes match the downloaded files.

**Step 4:**

Make sure the two commands below return the same hash for the file you are checking. If they do, file is valid.

<details>
<summary>Linux</summary>

```sh
sha256sum session-desktop-linux-amd64-$SESSION_VERSION.deb
grep .deb signature.asc
```

</details>

<details>
<summary>macOS</summary>

**Apple Silicon**

```sh
sha256sum releases/session-desktop-mac-arm64-$SESSION_VERSION.dmg
grep .dmg signature.asc
```

**Intel**

```sh
sha256sum releases/session-desktop-mac-x64-$SESSION_VERSION.dmg
grep .dmg signature.asc
```

</details>

<details>
<summary>Windows</summary>

**PowerShell**

```PowerShell
Get-FileHash -Algorithm SHA256 session-desktop-win-x64-$SESSION_VERSION.exe  # checksum is uppercase but should otherwise match
Select-String -Pattern ".exe" signature.asc
```

**Bash**

```sh
sha256sum session-desktop-win-x64-$SESSION_VERSION.exe
grep .exe signature.asc
```

</details>

## Debian repository

Please visit https://deb.oxen.io/

## License

Copyright 2011 Whisper Systems

Copyright 2013-2017 Open Whisper Systems

Copyright 2019-2024 The Oxen Project

Copyright 2024-2025 Session Technology Foundation

Licensed under the GPLv3: https://www.gnu.org/licenses/gpl-3.0.html

## Attributions

The IP-to-country mapping data used in this project is provided by [MaxMind GeoLite2](https://dev.maxmind.com/geoip/geolite2-free-geolocation-data).

This project uses the [Lucide Icon Font](https://lucide.dev/), which is licensed under the [ISC License](./third_party_licenses/LucideLicense.txt).
