# Diction Masters — offline app for Windows and Linux

The computer app that installs **with every lesson on the computer** (like
Microsoft Office) and works with **no internet**. A learner or school types an
**activation code** once (the internet is needed just then); after that every
lesson opens offline. When the computer is online, it quietly downloads new
and changed lessons from the website.

This project is separate from the website. The website only has a small
add-on for it: `apps/desktop_edition` in the Django project (codes, licences,
and the lessons export). See `DESKTOP_EDITION_GUIDE.md` there.

```
 website (Django)                                   this app
 ─────────────────────────────────────              ───────────────────────────────
 export_desktop_content  ─ every lesson page, ──►   installer: content/ inside
                           picture, recording,      (sealed, opens only with a code)
                           video, answer key
 /admin/ Activation codes ─ DM-XXXX-XXXX-XXXX ──►   activation screen (once, online)
 /desktop-app/check, latest ◄── when online ───     new lessons, code still valid?
```

## What works offline

Everything a learner of their level sees on the website, looking the same:
EchoSpell (cards, passages, dialogues, activities), the 44 Academy, Tricks to
Sound Fluent, Learning Modules, Reading Club, Assembly Recitals,
Conversational Dialogue, Quick Words, the Reference Library and the Phonemic
Chart. Recordings and videos play from the computer. Read-along highlighting works.

- **Activities are marked on the computer** with the website's own rules,
  and the result shows on the activity page.
- **Progress stays on the computer**: activities tried and passed, "My week"
  on the home page, and voice recordings (Help → Open my recordings folder).
- The learner's **name** shows on the lessons. A code with several levels lets
  them **choose their level** (and change it from the button at the top right).
- Things that need the website (AI tutor, Clash, Scan & Listen, search,
  payments, sending work to a teacher) show a friendly
  "This needs the internet" page with a button to open it on the website.

## The one file to edit: `app.config.json`

| Setting | What it is |
|---|---|
| `version` | Raise it when you publish a new app. New **lessons** don't need a new app. |
| `siteUrl` | The website it activates against and downloads lessons from. |
| `publicKey` | Filled in for you by `npm run content:fetch`. |
| `syncHours` | How often it checks for new lessons while online. |
| `blockScreenCapture` | Screenshots and screen recording show black (Windows). |

## Publishing the installers (on GitHub, no Windows PC needed)

One-time setup, on the **website** (see its `DESKTOP_EDITION_GUIDE.md`):
make the keys (`manage.py desktop_keys`), set `DESKTOP_BUILD_TOKEN`, and build
the first lessons release.

One-time setup, in **this repository**: Settings → Secrets and variables → Actions:

- secret **`DM_BUILD_TOKEN`**: the same value as the website's `DESKTOP_BUILD_TOKEN`.
- variable **`DM_SKIP_VIDEOS`** = `1` *only if* the lessons are bigger than
  about 1.8 GB (Windows installers can't pass 2 GB). Then each computer
  downloads its own level's videos after it's activated.

Then: **Actions → Build installers → Run workflow** (it also runs on every push
to `main`). In about 15 minutes the Releases page (tag `offline`) has:

| Computer | File |
|---|---|
| Windows 10 and 11 | `DictionMasters-Offline-Setup.exe` |
| Windows 7, 8, 8.1 (32/64-bit) | `DictionMasters-Offline-Setup-Windows7-8.exe` |
| Ubuntu, Debian, Mint, Zorin | `DictionMasters-Offline-linux-amd64.deb` |
| Other Linux | `DictionMasters-Offline-linux-x86_64.AppImage` |

Re-run it whenever you want **new installers** to carry the newest lessons.
Computers already installed don't need it: they download new lessons themselves.

**Unsigned Windows installers** show "Windows protected your PC" → *More info*
→ *Run anyway*. A code-signing certificate removes it: add secrets
`WIN_CSC_LINK` (the .pfx as base64) and `WIN_CSC_KEY_PASSWORD`.

**Copying to many computers:** the installer can be copied on a flash drive
and installed anywhere; without a code it opens nothing, and each code only
works on as many computers as it has seats.

## Try it on your own computer

You need Node.js 22.

```bash
npm install
# lessons from your own Django (in the Django project):
#   python manage.py export_desktop_content --to /tmp/lessons
npm run content:local -- /tmp/lessons
# or from a website:  DM_BUILD_TOKEN=... npm run content:fetch
DM_SITE_URL=http://127.0.0.1:8000 npm start
```

Make a code on the website (`manage.py make_activation_codes --holder Test`) and type it in.

- `npm test`: marking, licences, sealed files, the lesson server.
- `test/e2e.js`: the whole app against a running website (activate, lessons,
  a recording, an activity, offline pages, new lessons): see the top of the file.
- `npm run dist:linux`, `npm run dist:win`, `npm run dist:win7`: installers locally.

## How it fits together (`src/`)

| File | What it does |
|---|---|
| `main/main.js` | The window, menus, activation, and the app's own `dm://app/` addresses. |
| `main/server.js` | Answers every page and file from the lessons on disk; marks activities; keeps progress. |
| `main/content.js` | Finds and unseals lessons (installed, plus downloaded updates). |
| `main/marking.js` | The website's marking rules (`apps/echospell/marking.py`). Change both together. |
| `main/licence.js` | Checks the signed licence offline: this computer, its levels, its end date. |
| `main/sync.js` | Checks in and downloads only the lessons that changed. |
| `main/progress.js` | What the learner did, in the app's data folder. |
| `ui/edition.css`, `ui/edition.js` | Added to every lesson page: hides online-only buttons, the top-right panel, results, today's date. |
| `ui/activate.html` | The activation screen. |

Where things are kept on a computer: the lessons in the install folder
(`resources/content`); the learner's progress, recordings, licence and
downloaded lessons in `%APPDATA%\Diction Masters` (Windows) or
`~/.config/Diction Masters` (Linux). Uninstalling keeps progress.

## Troubleshooting

| Problem | Fix |
|---|---|
| "That code wasn't found" | Check the letters; codes never use 0, O, 1, I, L, 5, S, 2 or Z. |
| "already in use on 1 computer" | In `/admin/` → Activation codes → the code, tick *Revoked* on the old computer, or raise *Seats*. |
| "Couldn't reach the website" when activating | The computer needs the internet just for activation. School proxies are used automatically. |
| A lesson says "hasn't finished downloading" | Connect to the internet; it fills in by itself, or press *Check for new lessons*. |
| Linux AppImage won't start | `sudo apt install libfuse2`, or use the `.deb`. |
| A page looks wrong only in the app | Help → Troubleshooting: developer tools. |
